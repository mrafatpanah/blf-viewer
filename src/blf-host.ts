// ── Host-side data processing ─────────────────────────────────────────────────
// Pure functions — no VS Code or webview dependencies.
// Imported by blfViewProvider.ts.

import { CANMessage } from './blf-parser';
import { DbcDatabase, decodeSignal } from './dbc-parser';
import { FilterState, SortState, WireMessage, WireSignal } from './blf-types';

// ── Filter ────────────────────────────────────────────────────────────────────

export function applyFilter(messages: CANMessage[], f: FilterState): CANMessage[] {
  const criteria = compileFilterCriteria(f);

  // Fast path: nothing active
  if (!criteria.active) { return messages; }

  return messages.filter(m => matchesFilterCriteria(m, criteria));
}

export function findFirstMatchingIndex(messages: CANMessage[], search: FilterState, fromIndex = 0): number {
  const criteria = compileFilterCriteria(search);
  if (!criteria.active) { return -1; }

  for (let i = fromIndex; i < messages.length; i++) {
    if (matchesFilterCriteria(messages[i], criteria)) { return i; }
  }
  return -1;
}

export function findLastMatchingIndex(messages: CANMessage[], search: FilterState, beforeIndex: number): number {
  const criteria = compileFilterCriteria(search);
  if (!criteria.active) { return -1; }

  for (let i = Math.min(beforeIndex - 1, messages.length - 1); i >= 0; i--) {
    if (matchesFilterCriteria(messages[i], criteria)) { return i; }
  }
  return -1;
}

export function countMatches(messages: CANMessage[], search: FilterState): number {
  const criteria = compileFilterCriteria(search);
  if (!criteria.active) { return 0; }
  return messages.reduce((n, m) => n + (matchesFilterCriteria(m, criteria) ? 1 : 0), 0);
}

type Seg = { idPart: string; chNum: number | null };

interface CompiledFilterCriteria {
  parsedSegs: Seg[];
  idLower: string;
  dataLower: string;
  rawData: string;
  dir: string;
  msgType: string;
  channel: string;
  active: boolean;
}

function compileFilterCriteria(f: FilterState): CompiledFilterCriteria {
  const idLower = f.id.toLowerCase().trim();
  const rawData = (f.data ?? '').trim();
  const dataLower = normalizeDataFilter(f.data);
  const { dir, msgType, channel } = f;

  // Pre-parse ID segments, supporting optional @channel suffix per segment.
  // Malformed segments (empty id, non-integer channel, or missing either part) are dropped.
  const parsedSegs: Seg[] = idLower
    ? idLower
        .split(',')
        .map(seg => seg.trim())
        .filter(seg => seg !== '')
        .map((seg): Seg | null => {
          const at = seg.indexOf('@');
          if (at === -1) { return { idPart: seg, chNum: null }; }
          const idPart = seg.slice(0, at).trim();
          const chPart = seg.slice(at + 1).trim();
          if (!idPart || !/^\d+$/.test(chPart)) { return null; } // malformed → drop
          return { idPart, chNum: parseInt(chPart, 10) };
        })
        .filter((s): s is Seg => s !== null)
    : [];

  return {
    parsedSegs,
    idLower,
    dataLower,
    rawData,
    dir,
    msgType,
    channel,
    // idLower covers stray-comma input (parsedSegs empty but id field non-empty)
    // rawData covers fully-invalid hex input (normalizes to empty string)
    active: Boolean(idLower || rawData || dir || msgType || channel),
  };
}

function normalizeDataFilter(value: string | undefined): string {
  return (value ?? '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function matchesFilterCriteria(m: CANMessage, criteria: CompiledFilterCriteria): boolean {
  const { parsedSegs, idLower, dataLower, rawData, dir, msgType, channel } = criteria;

  // Direction filter
  if (dir && (m.isRx ? 'RX' : 'TX') !== dir) { return false; }

  // Type filter
  if (msgType) {
    const t = m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD';
    if (t !== msgType) { return false; }
  }

  // Data filter — fail-closed if input is non-empty but fully invalid hex (e.g. "GG" → "")
  if (rawData && !dataLower) { return false; }
  if (dataLower && !m.data.toString('hex').toLowerCase().includes(dataLower)) {
    return false;
  }

  // ID + channel filter (supports id@channel segments)
  if (parsedSegs.length > 0) {
    const raw    = m.arbitrationId.toString(16).toLowerCase();
    const padStd = raw.padStart(3, '0');
    const padExt = raw.padStart(8, '0');

    const matchesAny = parsedSegs.some(({ idPart, chNum }) => {
      // @-qualified segment: use its own channel, bypass global dropdown
      const chOk = chNum !== null
        ? m.channel === chNum
        : (channel === '' || String(m.channel) === channel);
      if (!chOk) { return false; }

      return (
        raw.includes(idPart)    ||
        padStd.includes(idPart) ||
        padExt.includes(idPart) ||
        ('0x' + raw).includes(idPart) ||
        ('0x' + padExt).includes(idPart)
      );
    });

    if (!matchesAny) { return false; }
  } else if (idLower) {
    // ID was typed but all segments were malformed (e.g. stray comma) — match nothing
    return false;
  } else {
    // No ID filter: global channel filter only
    if (channel !== '' && String(m.channel) !== channel) { return false; }
  }

  return true;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

export function applySort(messages: CANMessage[], s: SortState): CANMessage[] {
  // Default column 'i' = parse order (the natural array order)
  if (!s || !s.col || s.col === 'i') {
    // Reverse needs a copy so we never mutate the master array
    return s?.dir === 'desc' ? messages.slice().reverse() : messages;
  }

  const sign = s.dir === 'asc' ? 1 : -1;

  // Always copy first — never mutate the master messages array
  return messages.slice().sort((a, b) => {
    let cmp = 0;
    switch (s.col) {
      case 't':
        cmp = a.relativeTimestamp - b.relativeTimestamp; break;

      case 'utc':
        cmp = a.absoluteTimestamp - b.absoluteTimestamp; break;

      // Webview column key is 'id' (matches DEFAULT_COLS[].key)
      case 'id':
        cmp = a.arbitrationId - b.arbitrationId; break;

      case 'type': {
        const ta = a.isErrorFrame ? 'ERR' : a.isFd ? 'FD' : 'STD';
        const tb = b.isErrorFrame ? 'ERR' : b.isFd ? 'FD' : 'STD';
        cmp = ta.localeCompare(tb); break;
      }

      case 'dir':
        // RX=0, TX=1 → ascending puts RX first
        cmp = (a.isRx ? 0 : 1) - (b.isRx ? 0 : 1); break;

      case 'ch':
        cmp = a.channel - b.channel; break;

      case 'dlc':
        cmp = a.dlc - b.dlc; break;

      default:
        cmp = 0;
    }
    return sign * cmp;
  });
}

// ── Wire format converter ─────────────────────────────────────────────────────

export function toWire(m: CANMessage, idx: number, dbc?: DbcDatabase | null): WireMessage {
  const flagsList: string[] = [];
  if (m.isExtendedId) { flagsList.push('EXT'); }
  if (m.isRemoteFrame) { flagsList.push('RTR'); }
  if (m.bitrateSwitch) { flagsList.push('BRS'); }
  if (m.errorStateIndicator) { flagsList.push('ESI'); }

  let msgName: string | undefined;
  let signals: WireSignal[] | undefined;

  if (dbc) {
    const dbcMsg = dbc.messages.get(m.arbitrationId);
    if (dbcMsg) {
      msgName = dbcMsg.name;
      signals = dbcMsg.signals.map(sig => {
        const { raw, physical, valueLabel } = decodeSignal(m.data, sig);
        const dp = sig.factor > 0 && sig.factor < 1
          ? Math.min(6, Math.ceil(-Math.log10(sig.factor)))
          : 0;
        const physStr   = physical.toFixed(dp) + (sig.unit ? ' ' + sig.unit : '');
        const hexDigits = Math.max(2, Math.ceil(sig.bitLength / 4));
        // For signed signals, convert the negative value back to its unsigned bit pattern
        // scoped to bitLength (not 32-bit, which >>> 0 would produce).
        const rawBits = raw < 0 ? raw + 2 ** sig.bitLength : raw;
        const rawHex  = '0x' + rawBits.toString(16).toUpperCase().padStart(hexDigits, '0');
        return {
          name: sig.name, rawHex, physical, physStr,
          unit: sig.unit, valueLabel, comment: sig.comment,
        };
      });
    }
  }

  return {
    i:     idx,
    t:     m.relativeTimestamp.toFixed(7),
    utc:   isFinite(m.absoluteTimestamp) ? new Date(m.absoluteTimestamp * 1000).toISOString() : '',
    id:    m.isExtendedId
             ? '0x' + m.arbitrationId.toString(16).padStart(8, '0').toUpperCase()
             : m.arbitrationId.toString(16).padStart(3, '0').toUpperCase(),
    rawId: m.arbitrationId,
    type:  m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD',
    dir:   m.isRx ? 'RX' : 'TX',
    ch:    m.channel,
    dlc:   m.dlc,
    data:  Buffer.from(m.data).toString('hex').match(/.{1,2}/g)?.join(' ').toUpperCase() ?? '',
    flags: flagsList.join(' '),
    ext:   m.isExtendedId,
    rtr:   m.isRemoteFrame,
    brs:   m.bitrateSwitch       ?? false,
    esi:   m.errorStateIndicator ?? false,
    err:   m.isErrorFrame        ?? false,
    msgName,
    signals,
  };
}
