// ── Host-side data processing ─────────────────────────────────────────────────
// Pure functions — no VS Code or webview dependencies.
// Imported by blfViewProvider.ts.

import { CANMessage } from './blf-parser';
import { FilterState, SortState, WireMessage } from './blf-types';

// ── Filter ────────────────────────────────────────────────────────────────────

export function applyFilter(messages: CANMessage[], f: FilterState): CANMessage[] {
  const idLower = f.id.toLowerCase().trim();
  const { dir, msgType, channel } = f;

  // Fast path: nothing active
  if (!idLower && !dir && !msgType && !channel) return messages;

  return messages.filter(m => {
    // Direction filter
    if (dir && (m.isRx ? 'RX' : 'TX') !== dir) return false;

    // Type filter
    if (msgType) {
      const t = m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD';
      if (t !== msgType) return false;
    }

    // Channel filter — stored as 0-based integer string
    if (channel !== '' && String(m.channel) !== channel) return false;

    // ID filter — match against every form the UI can display:
    //   raw hex ("52"), padded-3 STD ("052"), padded-8 EXT ("00000052"),
    //   and both with "0x" prefix.
    if (idLower) {
      const raw    = m.arbitrationId.toString(16).toLowerCase();
      const padStd = raw.padStart(3, '0');
      const padExt = raw.padStart(8, '0');
      if (
        !raw.includes(idLower)             &&
        !padStd.includes(idLower)          &&
        !padExt.includes(idLower)          &&
        !('0x' + raw).includes(idLower)    &&
        !('0x' + padExt).includes(idLower)
      ) return false;
    }

    return true;
  });
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

export function toWire(m: CANMessage, idx: number): WireMessage {
  const flagsList: string[] = [];
  if (m.isExtendedId)        flagsList.push('EXT');
  if (m.isRemoteFrame)       flagsList.push('RTR');
  if (m.bitrateSwitch)       flagsList.push('BRS');
  if (m.errorStateIndicator) flagsList.push('ESI');

  return {
    i:     idx,
    t:     m.relativeTimestamp.toFixed(7),
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
  };
}