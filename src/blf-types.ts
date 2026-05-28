// ── Shared types between host (extension) and webview ────────────────────────
// Import this in blfViewProvider.ts and reference in the webview JS as plain objects.

export interface FilterState {
  id:      string;   // hex string, case-insensitive substring match
  data:    string;   // hex byte sequence, case-insensitive payload match
  dir:     string;   // '' | 'RX' | 'TX'
  msgType: string;   // '' | 'STD' | 'FD' | 'ERR'
  channel: string;   // '' | '0' | '1' | ...
}

export interface SortState {
  col: 'i' | 't' | 'utc' | 'id' | 'type' | 'dir' | 'ch' | 'dlc';
  dir: 'asc' | 'desc';
}

// Messages sent from webview → host
export type WebviewMessage =
  | { type: 'requestPage'; startIndex: number; count: number; filter: FilterState; sort: SortState; }
  | { type: 'searchFirst'; filter: FilterState; sort: SortState; search: FilterState; }
  | { type: 'openDbcFile' }
  | { type: 'clearDbc' };

// Decoded signal value from a DBC database
export interface WireSignal {
  name:        string;
  rawHex:      string;    // e.g. "0x2710" — pre-formatted on host
  physical:    number;
  physStr:     string;    // e.g. "2710.0 rpm" — pre-formatted on host
  unit:        string;
  valueLabel?: string;    // from VAL_ table, e.g. "Drive"
  comment?:    string;
}

// Lean wire format — only what the webview renders per row
export interface WireMessage {
  i:        number;           // position in the filtered+sorted result set
  t:        string;           // formatted relative timestamp
  utc:      string;           // formatted absolute UTC timestamp
  id:       string;           // formatted arb ID string  e.g. "0x1A2B3C4D"
  rawId:    number;           // raw integer arb ID (for sorting / filter by same ID)
  type:     'STD' | 'FD' | 'ERR';
  dir:      'RX' | 'TX';
  ch:       number;
  dlc:      number;
  data:     string;           // "AA BB CC DD"
  flags:    string;           // "EXT RTR BRS ESI" — space-separated active flags
  ext:      boolean;
  rtr:      boolean;
  brs:      boolean;
  esi:      boolean;
  err:      boolean;
  msgName?: string;           // DBC message name, undefined when no DBC or no match
  signals?: WireSignal[];     // undefined = no DBC loaded; [] = DBC match with no signals
}

// Messages sent from host → webview
export type HostMessage =
  | {
      type:          'init';
      fileName:      string;
      header:        { startTimestamp: number; stopTimestamp: number } | null;
      totalCount:    number;
      rxCount:       number;
      txCount:       number;
      fdCount:       number;
      errCount:      number;
      uniqueIds:     number;
      channels:      number[];
      errors:        string[];
    }
  | {
      type:          'page';
      startIndex:    number;
      totalFiltered: number;
      rows:          WireMessage[];
    }
  | {
      type:    'searchResult';
      index:   number;
      row?:    WireMessage;
      message?: string;
    }
  | {
      type:    'error';
      message: string;
    }
  | {
      type:         'dbcLoaded';
      fileName:     string;
      messageCount: number;
    }
  | {
      type: 'dbcCleared';
    };
