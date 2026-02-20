# BLF Viewer

View and analyze **Binary Logging Format (BLF)** CAN bus log files directly in VS Code — no external tools required.

BLF is the native recording format of Vector CANalyzer, CANoe, and related automotive diagnostic tools. This extension lets you inspect `.blf` files as a structured, filterable table without leaving your editor.

---

## Features

### Automatic file association

Opening any `.blf` file in VS Code launches the viewer automatically. No commands needed.

### Virtual scrolling — handles large files

Files with hundreds of thousands of messages open instantly. The viewer renders only the rows currently visible on screen, keeping memory usage constant regardless of file size.

### Stats dashboard

At a glance: total message count, recording duration, messages/sec throughput, unique arbitration IDs, active channels, RX/TX split, and CAN FD frame count.

### Filter toolbar

Narrow down messages by:

- **Arbitration ID** — hex substring match (e.g. `7e0` matches `0x07E0`, `0x17E0`, etc.)
- **Direction** — RX, TX, or both
- **Type** — Standard CAN, CAN FD, or Error frames
- **Channel** — individual channel or all

### Sortable columns

Click any column header to sort by index, timestamp, arbitration ID, type, direction, channel, or DLC.

### Detail panel

Select any row to see the full message breakdown: byte grid, hex/decimal/binary table for each byte, and all decoded flags (Extended ID, Remote Frame, BRS, ESI).

### Supported frame types

- CAN 2.0A — 11-bit standard frames
- CAN 2.0B — 29-bit extended frames
- CAN FD — with Bit Rate Switch (BRS) and Error State Indicator (ESI)
- Error frames

### Theme adaptive

Uses VS Code CSS variables throughout — works correctly with any light or dark color theme.

---

## Requirements

- VS Code **1.85.0** or later
- No external dependencies or native modules — pure TypeScript

---

## Usage

1. Open a `.blf` file via **File → Open File** or by double-clicking in the Explorer panel
2. The BLF Viewer opens automatically as a custom editor
3. Use the filter toolbar to search for specific messages
4. Click any row to inspect its bytes in the detail panel on the right
5. Click **⊞ Detail** in the top bar to show or hide the detail panel

You can also open a file explicitly from the Command Palette:

```
BLF: Open File
```

---

## Extension Settings

This extension does not contribute any configurable settings.

---

## Known Issues

- Sorting by column reorders the visual indicator only; rows are always returned in parse order (chronological). Full host-side sorting will be added in a future release.
- Very large files (>500 MB uncompressed) may take several seconds to parse on first open while the extension host decompresses and indexes the BLF containers.
- Timestamp accuracy depends on the recording tool's clock resolution. Some tools write 10 µs resolution; others write nanosecond resolution. The parser detects this from the object header flags.

---

## Release Notes

### 0.1.0

Initial release. Virtual scrolling viewer with filtering, stats dashboard, detail panel, and full CAN / CAN FD / error frame support.

---

## About BLF

The Binary Logging Format (`.blf`) is a binary container format developed by Vector Informatik GmbH. It stores timestamped CAN, CAN FD, LIN, FlexRay, and other bus messages in compressed blocks (LOBJ containers). This extension implements the CAN and CAN FD portions of the format.

---

## License

MIT
