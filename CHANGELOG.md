# Changelog

All notable changes to the **BLF Viewer** extension are documented here.

## [1.3.3] — 2026-07-12

### Documentation

- README release-notes section: add the missing 1.3.1 and 1.3.2 entries.

## [1.3.2] — 2026-07-11

### Added

- **Diagnostic type filters** — the Type dropdown in both the filter toolbar and the search panel gains **Diag (UDS+TP)**, **UDS**, and **TP frames** options, so diagnostic traffic can be isolated like CANoe's Diag window (all diagnostic rows, only reassembled UDS messages, or only raw transport frames). Physical type filters (`STD`/`FD`/`ERR`) no longer match the synthetic reassembled UDS rows — raw transport frames still match their physical type.

### Fixed

- **Src/Dst on transport rows** — raw ISO-TP transport rows (`SF`/`FF`/`CF`/`FC.*`) now carry the **Src**/**Dst** CAN-IDs like the reassembled UDS rows, matching CANoe's Diag view which fills them on every diagnostic frame. Previously only the reassembled `req`/`pos`/`neg` rows had them, so most diagnostic rows showed an empty Src/Dst.
- **Name column auto-shown on CDD import** — the **Name** column (where `<OTP>` markers and resolved service names like `Default Session Start::req` render) is now shown automatically when an active CDD loads, instead of staying hidden until enabled manually. Name-column visibility is now shared between DBC and CDD state, so clearing one database no longer hides names the other still provides.

## [1.3.1] — 2026-07-11

### Fixed

- **CAN error-frame parser (`CAN_ERROR_EXT`)** — the arbitration ID was read from the `frameLength` field (4 bytes too early) and the data bytes started 4 bytes early, so error-frame rows showed a garbage ID and shifted payload. Offsets now match the python-can `CAN_ERROR_EXT_STRUCT` layout (`<HHLBBBxLLH2x8s`).

## [1.3.0] — 2026-07-10

### Added

- **CDD (Vector CANdela Studio) diagnostic database import** — new **⊕ CDD** toolbar button imports a `.cdd` file (10 MB limit). Extracts the Request/Response CAN-ID pair and the service catalogue (SID, sub-function/DID, positive-response SID) so diagnostic traffic can be labelled by name instead of raw bytes. **✕** clears the loaded CDD and reverts to raw CAN rows.
- **Stateful ISO 15765-2 (CAN-TP) transport reconstruction** — when a CDD's Request/Response CAN-ID pair is found, matching CAN traffic is reassembled per ISO 15765-2: Single Frame, First Frame + Consecutive Frame (with sequence-number validation and the CAN-FD length escape), and Flow Control (CTS / WT / OVFLW) are recognized and shown as raw transport rows (`SF`/`FF`/`CF`/`FC.*`), with completed multi-frame messages emitted as a second, fully-reassembled UDS row. Reassembly state is tracked per channel and per direction, so concurrent sessions on different channels don't collide.
- **UDS diagnostics columns** — new **Diag ID**, **Src**, **Dst**, **Conn**, and **Service** columns (auto-shown when a CDD is active) surface the matched service name, request/positive/negative classification (`req`/`pos`/`neg` row types with distinct badge colors), the resolved NRC name for negative responses (e.g. `requestOutOfRange`), and a per-connection grouping index.
- **CDD-aware detail panel** — the row detail panel shows Diag ID / Service / Src / Dst / Conn for diagnostic rows, and renders transport padding bytes (`[AA BB]`) distinctly from real payload bytes in the byte table.

### Fixed

- **Regex-injection / ReDoS hardening in the CDD parser** — attribute values read from an untrusted `.cdd` file are escaped before being interpolated into a `RegExp`, preventing catastrophic backtracking from a crafted attribute value.

## [1.2.0] — 2026-06-10

### Added

- **UTC timestamp column** — a default-visible **UTC** column shows ISO 8601 timestamps derived from the file's base timestamp. Sortable. Included in copy-row, CSV export, and detail panel. (contributed by [@lofyzhou](https://github.com/lofyzhou))
- **Payload data filter** — new **Data bytes** field in the Filter toolbar matches contiguous byte sequences (`3E 80`, `22F190`, `0x22 0xF1 0x90`). Updated live as you type. (contributed by [@lofyzhou](https://github.com/lofyzhou))
- **Search panel** — separate **Search** toolbar row to locate the first matching row (by ID, data bytes, direction, type, or channel) without changing the visible filtered dataset. (contributed by [@lofyzhou](https://github.com/lofyzhou))
- **Search navigation (Find Next / Find Prev)** — ◀ / ▶ buttons step through all matches; a `current / total` counter updates with each navigation. First ◀ press jumps to the last match.
- **Search hit highlight** — amber left-border stripe marks the current search result, composable with row selection and colorize.
- **Resizable Search ID field** — drag handle on the Search ID input, width persisted in `localStorage`.

### Fixed

- **CAN FD Message 64 parser** — `CAN_FD_MESSAGE_64` objects no longer read from the wrong byte offset (`extDataOffset` was incorrectly used as the payload start). Buffer size check corrected from `pos+32` to `pos+40`. DLC-to-length mapping added so 12/16/20/24/32/48/64-byte payloads parse correctly when `validBytes` is 0. (contributed by [@lofyzhou](https://github.com/lofyzhou))
- **Filter toolbar layout** — fixed CSS gap between the data-bytes input and dropdowns; added Filter / Search panel labels.
- **ID filter stray comma** — typing `,` or a trailing comma (e.g. `1A3,`) now returns zero rows instead of showing all messages.
- **Data filter invalid hex** — fully non-hex input (e.g. `GG`) now returns zero rows instead of silently disabling the filter.

## [1.1.0] — 2026-06-06

### Added

- **`id@channel` filter syntax** — append `@<channel>` to any ID segment to restrict that segment to a specific channel (e.g. `100@0` matches ID `100` on channel 0 only; `100@0,100@1` matches the same ID on both channels independently). Segments without `@` continue to respect the global channel dropdown. Malformed `@` suffixes (non-integer or missing ID part) are silently dropped. Placeholder text in the filter input updated to show an example.
- **Resizable ID filter field** — the toolbar ID filter is wider by default, has a visible right-edge drag handle, and remembers the chosen width in the webview for long comma-separated or `id@channel` expressions.
- **Unit tests for `applyFilter`** — Mocha suite covering no-filter passthrough, plain ID match, channel-qualified match, multi-segment channel combinations, global channel interaction, and malformed-segment handling (11 tests).
- **Test infrastructure** — added `"outDir": "out"` to `tsconfig.json` and a `pretest` script so `vscode-test` finds compiled test files in `out/test/`.

### Fixed

- **Brace-style lint warnings** — single-line control-flow bodies in parser, host, provider, extension entry point, and webview logic now use explicit braces to satisfy the configured lint rules.

## [1.0.0] — 2026-05-15

### Added

- **DBC import** — click the **⊕ DBC** button in the toolbar to load a `.dbc` (Database CAN) file; a badge shows the file name and matched message count
- **Signal decoding** — when a DBC is loaded, the detail panel shows a **Signals** section with each signal's raw hex value, physical value (with unit and decimal precision derived from the DBC factor), and value-table label (e.g. `Drive`, `Park`) for enum-style signals
- **Message Name column** — a **Name** column appears automatically when a DBC is loaded, showing the DBC message name inline in the table; hidden when no DBC is active
- **Multi-ID search** — the ID filter accepts a comma-separated list of IDs (e.g. `7E0,7E8`) to match any of the specified arbitration IDs simultaneously (contributed by [@sonerb](https://github.com/sonerb))
- **DBC parser** — new `dbc-parser.ts` module: pure TypeScript, no dependencies; supports `BO_` message blocks, `SG_` signals (Intel/Motorola byte order, signed/unsigned), `CM_` comments, `VAL_` value tables, and extended IDs (bit 31 mask)

### Changed

- `toWire` now accepts an optional `DbcDatabase` parameter; decoded `msgName` and `signals` fields are included in the wire format only when a DBC is loaded, keeping payloads lean for DBC-free sessions

## [0.2.0] — 2026-02-22

### Added

- **Resizable columns** — drag the handle on any column edge to resize it; the Data column expands to fill remaining space
- **Reorderable columns** — drag any column header to a new position; order persists for the session
- **Column visibility** — the ⊞ Columns button in the top bar opens a checklist to show or hide individual columns
- **Real host-side sorting** — clicking a column header now sends the sort key and direction to the extension host, which re-sorts the full filtered dataset before paging; previously the sort indicator was cosmetic only
- **Ascending / descending toggle** — clicking an already-sorted column reverses the sort direction; active column is highlighted with ↑ / ↓
- **Multi-select** — Ctrl/Cmd+Click toggles individual rows; Shift+Click selects a contiguous range; selection count shown in the toolbar
- **Right-click context menu** with submenus:
  - _Add to Filter_ — sets the ID filter field to the selected message's arbitration ID
  - _Show Details_ — opens the detail panel and populates it for the right-clicked row
  - _Colorize_ — color-swatch submenu to highlight rows in red, green, blue, yellow, purple, or orange; applies to the entire multi-selection
  - _Group by…_ — submenu to visually group rows by message type, direction, channel, or arbitration ID; active grouping shown in a dismissible banner
  - _Select all with same ID_ — adds every cached row sharing the same arbitration ID to the selection
  - _Copy row_ — copies tab-separated row values to the clipboard
  - _Copy Arb ID_ — copies just the hex arbitration ID
  - _Copy data bytes_ — copies the hex byte string
  - _Copy selection as CSV_ — exports all selected rows as a CSV string with a header row
  - _Remove color_ — clears colorization from the row or selection
- **Empty-state message** — "No messages match the current filter" shown immediately when a filter yields zero results; previously stale rows would remain visible
- **Code split into four focused modules**: `blf-types.ts` (shared interfaces), `blf-host.ts` (filter / sort / wire-format logic), `blf-webview.ts` (HTML, CSS, and webview runtime), `blfViewProvider.ts` (VS Code provider shell)

### Fixed

- Column sort sent the wrong key (`rawId`) to the host; the host had no matching case so all column sorts were silently ignored
- Filtering to zero results left the virtual scroller at the old spacer height, keeping ghost rows or "loading…" placeholders visible
- ID filter did not match leading-zero display forms: searching `052` failed to match a message displayed as `052` because `parseInt` strips the leading zero; filter now tests against raw hex, 3-char padded (STD), 8-char padded (EXT), and `0x`-prefixed variants

## [0.1.0] — 2026-02-20

### Added

- Custom editor for `.blf` (Binary Logging Format) files — opens automatically on double-click
- Virtual scrolling table: renders only visible rows, handles millions of messages with constant memory
- On-demand paging architecture: extension host streams data to the webview in small pages rather than serializing the entire file
- Stats strip showing total message count, recording duration, messages/sec rate, unique arbitration IDs, active channels, RX/TX split, and CAN FD count
- Filter toolbar: filter by arbitration ID (hex substring), direction (RX/TX), message type (STD/CAN FD/Error), and channel
- Sortable column headers: index, timestamp, arbitration ID, type, direction, channel, DLC
- Detail panel: byte grid, hex/decimal/binary breakdown, and all message flags for the selected row
- Color-coded row and badge system: green for RX, purple for TX, blue for CAN FD, red for error frames
- Full support for CAN 2.0A (11-bit), CAN 2.0B (29-bit extended), CAN FD, and error frames
- BLF container decompression (zlib deflate and deflate-raw)
- Parse warning bar showing up to 50 parser diagnostics
- UTC start timestamp displayed in the top bar
- Command palette entry: `BLF: Open File`
- Theme-adaptive styling using VS Code CSS variables (works with any light or dark theme)
