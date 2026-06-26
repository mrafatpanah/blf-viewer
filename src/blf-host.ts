// ── Host-side data processing ─────────────────────────────────────────────────
// Pure functions — no VS Code or webview dependencies.
// Imported by blfViewProvider.ts.

import { CANMessage } from './blf-parser';
import { DbcDatabase, decodeSignal } from './dbc-parser';
import { FilterState, SortState, WireMessage, WireSignal } from './blf-types';
import { CddDatabase } from './cdd-parser';

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

  if (dbc && !m.isUds && !m.isOtp) {
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

  // Handle data byte formatting
  let dataStr = '';
  if (m.isOtp && m.formattedData !== undefined) {
    dataStr = m.formattedData;
  } else {
    dataStr = Buffer.from(m.data).toString('hex').match(/.{1,2}/g)?.join(' ').toUpperCase() ?? '';
  }

  // Determine wire type
  let wireType: WireMessage['type'] = m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD';
  if (m.isUds && m.udsType) {
    wireType = m.udsType;
  } else if (m.isOtp && m.otpType) {
    wireType = m.otpType as any;
  }

  return {
    i:     idx,
    t:     m.relativeTimestamp.toFixed(7),
    utc:   isFinite(m.absoluteTimestamp) ? new Date(m.absoluteTimestamp * 1000).toISOString() : '',
    id:    m.isExtendedId
             ? '0x' + m.arbitrationId.toString(16).padStart(8, '0').toUpperCase()
             : m.arbitrationId.toString(16).padStart(3, '0').toUpperCase(),
    rawId: m.arbitrationId,
    type:  wireType,
    dir:   m.isRx ? 'RX' : 'TX',
    ch:    m.channel,
    dlc:   m.dlc,
    data:  dataStr,
    flags: flagsList.join(' '),
    ext:   m.isExtendedId,
    rtr:   m.isRemoteFrame,
    brs:   m.bitrateSwitch       ?? false,
    esi:   m.errorStateIndicator ?? false,
    err:   m.isErrorFrame        ?? false,
    msgName: m.isUds ? m.name : (m.isOtp ? m.name : msgName),
    signals: m.isUds ? undefined : signals,
    // Diagnostics properties
    diagId:  m.diagId,
    src:     m.src,
    dst:     m.dst,
    conn:    m.conn,
    service: m.service,
    isUds:   m.isUds
  };
}

// ── UDS Diagnostics Reconstructor ─────────────────────────────────────────────

const UDS_NRCS: { [nrc: number]: string } = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceededNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x78: 'requestCorrectlyReceived-ResponsePending'
};

// Per channel+direction ISO-TP reassembly stream.
interface TpStream {
  buffer:     Buffer;
  targetLen:  number;
  active:     boolean;
  expectedSN: number; // next expected Consecutive Frame sequence number (0–15, wraps)
}

// Result of classifying one CAN frame against ISO 15765-2.
export interface FrameInfo {
  otpType:      string;        // 'SF' | 'FF' | 'CF' | 'FC.*' | 'TP' | ''
  completedUds?: CANMessage;   // present when a full UDS message reassembled on this frame
  pciLen:       number;        // count of PCI bytes at frame start
  payloadLen:   number;        // count of real UDS payload bytes carried by THIS frame
  snError?:     boolean;       // CF arrived with unexpected sequence number / no active FF
}

export class UdsReconstructor {
  private reqCanId: number;
  private resCanId: number;
  // Reassembly streams keyed by `${channel}:${dir}` so concurrent buses / directions don't collide.
  private streams = new Map<string, TpStream>();

  constructor(reqCanId: number, resCanId: number) {
    this.reqCanId = reqCanId;
    this.resCanId = resCanId;
  }

  private streamFor(channel: number, dir: 'req' | 'res'): TpStream {
    const key = channel + ':' + dir;
    let s = this.streams.get(key);
    if (!s) {
      s = { buffer: Buffer.alloc(0), targetLen: 0, active: false, expectedSN: 1 };
      this.streams.set(key, s);
    }
    return s;
  }

  processMessage(m: CANMessage): FrameInfo {
    const isReq = m.arbitrationId === this.reqCanId;
    const isRes = m.arbitrationId === this.resCanId;

    if (!isReq && !isRes) { return { otpType: '', pciLen: 0, payloadLen: 0 }; }

    const data = Buffer.from(m.data);
    if (data.length === 0) { return { otpType: '', pciLen: 0, payloadLen: 0 }; }

    const dir: 'req' | 'res' = isReq ? 'req' : 'res';
    const stream  = this.streamFor(m.channel, dir);
    const pciType = (data[0] >> 4) & 0x0F;

    const complete = (payload: Buffer, udsType: 'req' | 'pos' | 'neg'): CANMessage => ({
      relativeTimestamp: m.relativeTimestamp,
      absoluteTimestamp: m.absoluteTimestamp,
      arbitrationId:     m.arbitrationId,
      isExtendedId:      m.isExtendedId,
      isRemoteFrame:     m.isRemoteFrame,
      isRx:              m.isRx,
      dlc:               payload.length,
      data:              payload,
      channel:           m.channel,
      isUds:             true,
      udsType
    });

    if (pciType === 0) { // Single Frame — interrupts any pending multi-frame on this stream
      stream.active = false;
      let len    = data[0] & 0x0F;
      let pciLen = 1;
      if (len === 0 && data.length > 2) { // CAN-FD SF escape: real length in byte 1
        len    = data[1];
        pciLen = 2;
      }
      const payload = data.slice(pciLen, pciLen + len);
      const udsType = isReq ? 'req' : (payload[0] === 0x7F ? 'neg' : 'pos');
      return { otpType: 'SF', completedUds: complete(payload, udsType), pciLen, payloadLen: payload.length };
    }

    if (pciType === 1) { // First Frame
      let len    = ((data[0] & 0x0F) << 8) | data[1];
      let pciLen = 2;
      if (len === 0 && data.length >= 6) { // FF_DL escape: 32-bit length in bytes 2..5
        len    = data.readUInt32BE(2);
        pciLen = 6;
      }
      const payload = data.slice(pciLen);
      stream.buffer     = payload;
      stream.targetLen  = len;
      stream.active     = true;
      stream.expectedSN = 1;
      return { otpType: 'FF', pciLen, payloadLen: payload.length };
    }

    if (pciType === 2) { // Consecutive Frame
      const sn = data[0] & 0x0F;
      if (!stream.active) {
        // Orphan CF: FF lost or log started mid-transfer — cannot reassemble.
        return { otpType: 'CF', pciLen: 1, payloadLen: Math.max(0, data.length - 1), snError: true };
      }
      if (sn !== stream.expectedSN) {
        // Sequence break: abort reassembly rather than silently concatenate garbage.
        stream.active    = false;
        stream.buffer    = Buffer.alloc(0);
        stream.targetLen = 0;
        return { otpType: 'CF', pciLen: 1, payloadLen: Math.max(0, data.length - 1), snError: true };
      }
      const remaining = stream.targetLen - stream.buffer.length;
      const realLen   = Math.max(0, Math.min(data.length - 1, remaining));
      stream.buffer     = Buffer.concat([stream.buffer, data.slice(1)]);
      stream.expectedSN = (stream.expectedSN + 1) & 0x0F;
      if (stream.buffer.length >= stream.targetLen) {
        const payload = stream.buffer.slice(0, stream.targetLen);
        stream.active    = false;
        stream.buffer    = Buffer.alloc(0);
        stream.targetLen = 0;
        const udsType: 'req' | 'pos' | 'neg' = isReq ? 'req' : (payload[0] === 0x7F ? 'neg' : 'pos');
        return { otpType: 'CF', completedUds: complete(payload, udsType), pciLen: 1, payloadLen: realLen };
      }
      return { otpType: 'CF', pciLen: 1, payloadLen: realLen };
    }

    if (pciType === 3) { // Flow Control
      const fs = data[0] & 0x0F;
      let otpType = 'FC.CTS';
      if (fs === 1) { otpType = 'FC.WT'; }
      else if (fs === 2) { otpType = 'FC.OVFLW'; }
      return { otpType, pciLen: Math.min(3, data.length), payloadLen: 0 };
    }

    return { otpType: 'TP', pciLen: 0, payloadLen: 0 };
  }
}

// 2-digit uppercase hex of a single byte.
function hex2(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

// Space-separated uppercase hex of a buffer ("AA BB CC").
function toHexBytes(buf: Buffer): string {
  return buf.toString('hex').toUpperCase().match(/.{1,2}/g)?.join(' ') || '';
}

// CAN arbitration ID as uppercase hex (min 3 chars, e.g. "782").
function canIdHex(id: number): string {
  return id.toString(16).toUpperCase().padStart(3, '0');
}

// Render a raw TP frame with PCI in [..], real payload bare, padding in [..].
function formatTpFrame(data: Buffer, pciLen: number, payloadLen: number, otpType: string): string {
  const buf = Buffer.from(data);
  if (!otpType || pciLen <= 0) { return toHexBytes(buf); }
  const pci     = toHexBytes(buf.slice(0, pciLen));
  const payload = toHexBytes(buf.slice(pciLen, pciLen + payloadLen));
  const pad     = toHexBytes(buf.slice(pciLen + payloadLen));
  return `[${pci}]` + (payload ? ' ' + payload : '') + (pad ? ' [' + pad + ']' : '');
}

// Annotate a reassembled UDS message with name / service / diagId from the CDD (or fallbacks).
function annotateUds(uds: CANMessage, cddDb?: CddDatabase | null): void {
  const payload = uds.data;
  let name = '';
  let service = '';
  let diagId = '';

  if (uds.udsType === 'neg') {
    const rejectedSid = payload[1];
    const nrc         = payload[2];
    const nrcName     = UDS_NRCS[nrc] || `NRC_0x${nrc.toString(16).toUpperCase()}`;
    diagId = `7F ${hex2(rejectedSid)} ${hex2(nrc)}`;

    let matchedService = '';
    if (cddDb) {
      const sidKey = hex2(rejectedSid);
      for (const [key, value] of cddDb.services.entries()) {
        if (key.startsWith(sidKey)) {
          matchedService = value.service;
          break;
        }
      }
    }
    service = matchedService || `SID_0x${rejectedSid.toString(16).toUpperCase()}`;
    name    = `${service}::neg(${nrcName})`;
  } else {
    const key3 = toHexBytes(payload.slice(0, 3));
    const key2 = toHexBytes(payload.slice(0, 2));
    const key1 = toHexBytes(payload.slice(0, 1));

    const found = cddDb ? (cddDb.services.get(key3) || cddDb.services.get(key2) || cddDb.services.get(key1)) : null;
    if (found) {
      name    = found.name;
      service = found.service;
      if (found.paramType === 'did') { diagId = key3; }
      else if (found.paramType === 'sub') { diagId = key2; }
      else { diagId = key1; }
    } else {
      diagId  = key2 || key1;
      name    = `UDS_SID_0x${payload[0].toString(16).toUpperCase()}::${uds.udsType}`;
      service = `SID_0x${payload[0].toString(16).toUpperCase()}`;
    }
  }

  uds.name    = name;
  uds.service = service;
  uds.diagId  = diagId;
}

export function reconstructUdsMessages(
  messages: CANMessage[],
  reqCanId: number,
  resCanId: number,
  cddDb?: CddDatabase | null
): CANMessage[] {
  const reconstructor = new UdsReconstructor(reqCanId, resCanId);
  const result: CANMessage[] = [];
  let connCounter = 1;
  const activeConnMap = new Map<number, number>(); // channel → current connection index

  const reqHex = canIdHex(reqCanId);
  const resHex = canIdHex(resCanId);

  for (const m of messages) {
    const isDiag = m.arbitrationId === reqCanId || m.arbitrationId === resCanId;
    if (!isDiag) {
      result.push(m);
      continue;
    }

    const { otpType, completedUds, pciLen, payloadLen } = reconstructor.processMessage(m);
    const formattedData = formatTpFrame(m.data, pciLen, payloadLen, otpType);

    // Connection index, tracked per channel.
    let conn = activeConnMap.get(m.channel);
    if (conn === undefined) {
      conn = connCounter++;
      activeConnMap.set(m.channel, conn);
    }

    result.push({ ...m, isOtp: true, otpType, formattedData, conn, name: '<OTP>' });

    if (completedUds) {
      completedUds.conn = conn;
      activeConnMap.set(m.channel, connCounter++); // next frame on this channel starts a new connection

      annotateUds(completedUds, cddDb);
      // src = sender's CAN ID, dst = receiver's CAN ID (derived, not hardcoded).
      completedUds.src = completedUds.isRx ? resHex : reqHex;
      completedUds.dst = completedUds.isRx ? reqHex : resHex;

      result.push(completedUds);
    }
  }

  return result;
}
