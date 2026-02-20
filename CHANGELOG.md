# Changelog

All notable changes to the **BLF Viewer** extension are documented here.

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
