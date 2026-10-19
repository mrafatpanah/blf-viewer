# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile      # type-check + lint + esbuild (dev build with sourcemaps)
npm run package      # type-check + lint + esbuild --production (minified, for .vsix)
npm run watch        # parallel: esbuild watch + tsc --noEmit watch
npm run check-types  # tsc --noEmit only
npm run lint         # eslint src/
npm run test         # vscode-test (integration tests require VS Code host)
vsce package         # produce the installable .vsix
```

The single entry point is `src/extension.ts`; esbuild bundles everything into `dist/extension.js` (CJS, `vscode` externalized). No webpack, no separate webview bundle — the webview HTML/CSS/JS is a template string inside `blf-webview.ts`.

## Architecture

### Module responsibilities

| File | Role |
|---|---|
| `extension.ts` | Registers the custom editor provider (`blf.viewer`) and the `blf.openFile` command. Thin entry point. |
| `blfViewProvider.ts` | VS Code `CustomReadonlyEditorProvider`. Owns all parsed data in the extension host. On open: paints the webview shell immediately, then parses the file, then sends an `init` message. On every `requestPage` from the webview: calls `applyFilter → applySort → slice → toWire` and posts a `page` message back. |
| `blf-parser.ts` | `BLFReader` class — reads the entire BLF file synchronously (`fs.readFileSync`), decompresses LOG_CONTAINER objects with `zlib.inflate` (falls back to `inflateRaw`), and returns a flat `CANMessage[]`. No streaming. |
| `blf-host.ts` | Pure functions: `applyFilter`, `applySort`, `toWire`, plus the `UdsReconstructor` class and `reconstructUdsMessages()` (stateful ISO 15765-2 / CAN-TP reassembly). No VS Code or webview deps. Operates on the `CANMessage[]` held by the provider. |
| `cdd-parser.ts` | `parseCddFile()` — regex-based parser for Vector CANdela Studio (`.cdd`) diagnostic database XML. Extracts the Request/Response CAN-ID pair and a `services` map keyed by request byte sequence (e.g. `"22 F1 8C"`). Pure TypeScript, no runtime deps. |
| `dbc-parser.ts` | `parseDbcFile()` + `decodeSignal()` — line/regex-based parser for CAN DBC databases (`BO_`/`SG_`/`CM_`/`VAL_`) and Intel/Motorola signal bit-extraction with factor/offset scaling and value-table labels. Used by `toWire()` in `blf-host.ts` for the Name and Signals columns. Pure TypeScript, no runtime deps. |
| `blf-types.ts` | Shared TypeScript interfaces for the host↔webview message protocol: `FilterState`, `SortState`, `WireMessage`, `WebviewMessage`, `HostMessage`. |
| `blf-webview.ts` | Returns the complete webview HTML as a string (`getWebviewHtml`). The `<script>` is the entire webview runtime — virtual scroller, page cache, column management, context menu, detail panel — all inlined as a template literal (`WEBVIEW_JS`). CSS is also inlined (`CSS`). No external assets are loaded. |

### Data flow

```
.blf file
    │ BLFReader.parse()
    ▼
CANMessage[] (held in blfViewProvider, never sent whole to webview)
    │ requestPage {startIndex, count, filter, sort}   (webview → host)
    │ applyFilter → applySort → slice → toWire
    ▼
WireMessage[]  (lean, string-only rows)
    │ page {startIndex, totalFiltered, rows}           (host → webview)
    ▼
pageCache Map<pageStart, WireMessage[]>
    │ virtual scroller renders only visible rows
    ▼
DOM row pool (object-pool, ~30 divs reused)
```

### Webview paging & virtual scroll

- Page size: 60 rows per `requestPage` round-trip (`PAGE_SZ = 60`).
- Row height: 26 px (`ROW_H`), overscan: 15 rows above/below viewport.
- `pageCache`: `Map<pageStart, WireMessage[]>` keyed by the first row index of each 60-row page.
- `pending`: `Set<pageStart>` of in-flight requests — prevents duplicate requests.
- `resetAndRefetch()` is called on every filter/sort change: clears cache, resets scroll to top, sets `totalFiltered = 0` immediately (so stale ghost rows disappear), then fires `requestPage` for page 0.
- Page 0's response always carries the definitive `totalFiltered` count for the current filter/sort.

### BLF format constants (from `blf-parser.ts`)

- **File header**: `"LOGG"` signature, 144 bytes. Contains Windows SYSTEMTIME start/stop timestamps (UTC).
- **Object header base**: `"LOBJ"` signature, 16 bytes. Followed by a V1/V2 header (12–16 bytes) with a uint64 timestamp.
- **Timestamp resolution**: `TIMESTAMP_FLAG_TEN_MICS` (0x1) in object flags → multiply by `10e-6`; otherwise nanoseconds → multiply by `1e-9`.
- **Object types parsed**: `CAN_MESSAGE` (1), `LOG_CONTAINER` (10), `CAN_ERROR_EXT` (73), `CAN_MESSAGE2` (86), `CAN_FD_MESSAGE` (100), `CAN_FD_MESSAGE_64` (101). Unknown types are silently skipped.
- **LOG_CONTAINER**: holds zlib-compressed sub-objects. Compression method 0 = raw, 2 = zlib deflate.
- **Extended CAN ID**: bit 31 (`CAN_MSG_EXT = 0x80000000`) of the arbitration ID field; masked off before storing. Channel is stored **1-based** in the file, converted to **0-based** in the parser.
- **Object alignment**: each object is padded to a 4-byte boundary (`nextOffset += (4 - nextOffset % 4) % 4`).

### Webview security

The webview uses a strict CSP (`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'`). No external scripts, fonts, or images are loaded. All JS is injected via the nonce from `getNonce()`.

### Wire format (`WireMessage`)

The `toWire` function converts a `CANMessage` to a lean object with only string/number fields. Standard IDs are formatted as 3-char uppercase hex; extended IDs as `0x` + 8-char uppercase hex. Relative timestamps are serialized with `.toFixed(7)`. Data bytes are formatted as space-separated uppercase hex pairs.

### UDS / CAN-TP diagnostics (`cdd-parser.ts` + `UdsReconstructor` in `blf-host.ts`)

Importing a `.cdd` file (`openCddFile` webview message) parses the Request/Response CAN-ID pair and service catalogue, then — if both CAN IDs were found — calls `reconstructUdsMessages()` to rebuild the provider's entire `processedMessages` array (see `rebuildProcessedMessages()` in `blfViewProvider.ts`), replacing raw diagnostic-CAN-ID frames with a raw **OTP** transport row plus a synthesized, reassembled **UDS** row wherever a CAN-TP message completes. If no CAN-ID pair is found, `cddLoaded` is posted with `active: false` and the message array is left untouched — the webview shows an inactive badge instead of silently doing nothing.

- ISO 15765-2 PCI classification (SF/FF/CF/FC) and per-`channel:direction` reassembly state live in the `UdsReconstructor` class; `annotateUds()` resolves service names / NRC labels from the `CddDatabase`.
- `src`/`dst` on a reconstructed UDS row are derived from `arbitrationId` vs. the known request/response CAN-ID — **never** from `isRx`, which is capture-side and can be inverted (e.g. an ECU-side capture where a response frame is TX).
- `WireMessage.type` for these rows uses the `TpFrameType` union (`blf-parser.ts`) for transport frames (`SF`/`FF`/`CF`/`FC.*`/`TP`) or `'req'|'pos'|'neg'` for reassembled UDS rows — see `type` in `blf-types.ts`.
- CDD attribute values pulled from the file are escaped (`escapeRegExp`) before being interpolated into `new RegExp(...)`; do not remove this when touching `cdd-parser.ts` — an unescaped interpolation is a regex-injection/ReDoS vector against a crafted `.cdd` file.

### ID filter multi-match

`applyFilter` splits the `id` filter string on commas, trimming each segment, then matches a message if **any** segment is a substring of the raw hex, the 3-char padded form, the 8-char padded form, or the `0x`-prefixed variants. A segment may include `@<channel>` to bind that segment to a specific 0-based channel, bypassing the global channel dropdown for that segment only. Malformed `@` segments with a missing ID or non-integer channel are dropped.

The webview ID filter field is wider than the other toolbar controls and has a right-edge pointer resize handle. Width is persisted in webview `localStorage` as `blf.filterIdWidth` and clamped between 260 px and `min(80vw, 960px)`.

### Lint style

ESLint expects explicit braces around control-flow bodies. Keep `if`, `else`, loop, and similar bodies braced even when they are a single statement; this avoids the historical `{}` warnings in parser, host, provider, extension entry point, and webview code.

## BLF format reference

This extension's parser is adopted from [python-can's BLF implementation](https://github.com/hardbyte/python-can), which is itself based on Toby Lorenz' C++ library *Vector BLF*. The BLF format is a proprietary Vector Informatik format (produced by CANalyzer/CANoe); no official public spec exists.
