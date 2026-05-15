// DBC (Database CAN) file parser and signal decoder.
// Pure TypeScript, no runtime dependencies.

export interface DbcSignal {
  name:        string;
  startBit:    number;
  bitLength:   number;
  byteOrder:   'intel' | 'motorola';  // @1 = intel, @0 = motorola
  signed:      boolean;               // '-' = signed, '+' = unsigned
  factor:      number;
  offset:      number;
  unit:        string;
  comment?:    string;
  valueTable?: Map<number, string>;   // from VAL_ entries
}

export interface DbcMessage {
  id:         number;    // 29-bit arbitration ID (masked, same space as blf-parser)
  isExtended: boolean;
  name:       string;
  dlc:        number;
  signals:    DbcSignal[];
  comment?:   string;
}

export interface DbcDatabase {
  fileName: string;
  messages: Map<number, DbcMessage>;  // keyed by 29-bit arb ID
}

// ── Parser ────────────────────────────────────────────────────────────────────

// SG_ line regex (tolerant of optional mux indicator between name and colon)
const SG_RE = /^\s+SG_\s+(\w+)\s*(?:M|m\d+)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]+),([^)]+)\)\s*\[([^|]*)\|([^\]]*)\]\s*"([^"]*)"\s*(.*)/;

export function parseDbcFile(text: string, fileName: string): DbcDatabase {
  const db: DbcDatabase = { fileName, messages: new Map() };
  const lines = text.split(/\r?\n/);

  // ── Pass 1: messages and signals ──────────────────────────────────────────
  let currentMsg: DbcMessage | null = null;

  function flushMsg() {
    if (currentMsg) {
      db.messages.set(currentMsg.id, currentMsg);
      currentMsg = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // BO_ <rawId> <name>: <dlc> <tx>
    const boMatch = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)/);
    if (boMatch) {
      flushMsg();
      const rawId  = parseInt(boMatch[1], 10);
      const id29   = rawId & 0x1FFFFFFF;
      const isExt  = (rawId & 0x80000000) !== 0;
      currentMsg = {
        id: id29,
        isExtended: isExt,
        name: boMatch[2],
        dlc:  parseInt(boMatch[3], 10),
        signals: [],
      };
      continue;
    }

    // SG_ signal line (must be indented, i.e. inside a BO_ block)
    if (currentMsg) {
      const sgMatch = line.match(SG_RE);
      if (sgMatch) {
        const [, name, startBitS, lengthS, byteOrderS, signedS,
                factorS, offsetS, , , unit] = sgMatch;
        const sig: DbcSignal = {
          name,
          startBit:  parseInt(startBitS,  10),
          bitLength: parseInt(lengthS,    10),
          byteOrder: byteOrderS === '1' ? 'intel' : 'motorola',
          signed:    signedS === '-',
          factor:    parseFloat(factorS)  || 1,
          offset:    parseFloat(offsetS)  || 0,
          unit:      unit.trim(),
        };
        currentMsg.signals.push(sig);
        continue;
      }
    }

    // Non-indented, non-BO_ line ends the current message block
    if (line.length > 0 && line[0] !== ' ' && line[0] !== '\t') {
      flushMsg();
    }
  }
  flushMsg();

  // ── Pass 2: comments (CM_) and value tables (VAL_) ────────────────────────
  let i = 0;

  function readQuotedString(startLine: number, startCol: number): { value: string; endLine: number } {
    // Accumulate characters starting after the opening quote at startCol
    // until we find an unescaped closing quote followed (optionally) by ;
    let result = '';
    let li = startLine;
    let col = startCol;
    while (li < lines.length) {
      const l = lines[li];
      while (col < l.length) {
        if (l[col] === '"') {
          return { value: result, endLine: li };
        }
        result += l[col];
        col++;
      }
      result += '\n';
      li++;
      col = 0;
    }
    return { value: result, endLine: li };
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // CM_ BO_ <id> "...";
    const cmBoMatch = line.match(/^CM_\s+BO_\s+(\d+)\s+"(.*)/);
    if (cmBoMatch) {
      const id29 = parseInt(cmBoMatch[1], 10) & 0x1FFFFFFF;
      const msg  = db.messages.get(id29);
      // The opening quote was consumed; find text after it on the same line
      const openQuoteCol = lines[i].indexOf('"', lines[i].indexOf('BO_'));
      if (openQuoteCol !== -1) {
        const { value, endLine } = readQuotedString(i, openQuoteCol + 1);
        if (msg) { msg.comment = value.replace(/\\n/g, '\n').trim(); }
        i = endLine;
      }
      i++;
      continue;
    }

    // CM_ SG_ <id> <name> "...";
    const cmSgMatch = line.match(/^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"(.*)/);
    if (cmSgMatch) {
      const id29    = parseInt(cmSgMatch[1], 10) & 0x1FFFFFFF;
      const sigName = cmSgMatch[2];
      const msg     = db.messages.get(id29);
      const openQuoteCol = lines[i].indexOf('"', lines[i].indexOf(sigName) + sigName.length);
      if (openQuoteCol !== -1) {
        const { value, endLine } = readQuotedString(i, openQuoteCol + 1);
        if (msg) {
          const sig = msg.signals.find(s => s.name === sigName);
          if (sig) { sig.comment = value.replace(/\\n/g, '\n').trim(); }
        }
        i = endLine;
      }
      i++;
      continue;
    }

    // VAL_ <id> <name> 0 "Off" 1 "On" ... ;
    const valMatch = line.match(/^VAL_\s+(\d+)\s+(\w+)\s+(.*)/);
    if (valMatch) {
      const id29    = parseInt(valMatch[1], 10) & 0x1FFFFFFF;
      const sigName = valMatch[2];
      const rest    = valMatch[3];
      const msg     = db.messages.get(id29);
      const sig     = msg?.signals.find(s => s.name === sigName);
      if (sig) {
        sig.valueTable = parseValueTable(rest);
      }
      i++;
      continue;
    }

    i++;
  }

  return db;
}

// Parse: 0 "Off" 1 "On" 2 "Error" ;
function parseValueTable(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const re  = /(-?\d+)\s+"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.set(parseInt(m[1], 10), m[2]);
  }
  return map;
}

// ── Signal decoder ────────────────────────────────────────────────────────────

export function decodeSignal(
  data: Buffer,
  signal: DbcSignal
): { raw: number; physical: number; valueLabel?: string } {
  const raw = signal.byteOrder === 'intel'
    ? extractIntel(data,    signal.startBit, signal.bitLength, signal.signed)
    : extractMotorola(data, signal.startBit, signal.bitLength, signal.signed);

  const physical   = raw * signal.factor + signal.offset;
  const valueLabel = signal.valueTable?.get(raw);
  return { raw, physical, valueLabel };
}

// Intel (little-endian, @1): startBit is the LSB position.
// Bit n → byte n>>3, bit-in-byte n&7 (0=LSB).
function extractIntel(data: Buffer, startBit: number, length: number, signed: boolean): number {
  let raw = 0n;
  for (let i = 0; i < length; i++) {
    const bitPos  = startBit + i;
    const byteIdx = bitPos >> 3;
    const bitIdx  = bitPos & 7;
    if (byteIdx < data.length) {
      raw |= BigInt((data[byteIdx] >> bitIdx) & 1) << BigInt(i);
    }
  }
  if (signed && length > 0) {
    const sign = 1n << BigInt(length - 1);
    if (raw & sign) { raw -= (1n << BigInt(length)); }
  }
  return Number(raw);
}

// Motorola (big-endian, @0): startBit is the MSB position in DBC bit numbering.
// DBC bit n → byte n>>3, bit-in-byte n&7 (0=LSB, 7=MSB).
// Traversal from MSB: decrement within byte; when at byte-LSB (n&7===0), jump
// to the MSB of the next byte (+15 in DBC bit numbering).
function extractMotorola(data: Buffer, startBit: number, length: number, signed: boolean): number {
  let raw = 0n;
  let cur = startBit;
  for (let i = 0; i < length; i++) {
    const byteIdx   = cur >> 3;
    const bitInByte = cur & 7;
    if (byteIdx >= 0 && byteIdx < data.length) {
      const bit = (data[byteIdx] >> bitInByte) & 1;
      raw |= BigInt(bit) << BigInt(length - 1 - i);  // place MSB first
    }
    cur = (cur & 7) === 0 ? cur + 15 : cur - 1;
  }
  if (signed && length > 0) {
    const sign = 1n << BigInt(length - 1);
    if (raw & sign) { raw -= (1n << BigInt(length)); }
  }
  return Number(raw);
}
