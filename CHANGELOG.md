# Changelog

All notable changes to the **BLF Viewer** extension are documented here.

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
