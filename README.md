# BLF Viewer

View and analyze **Binary Logging Format (BLF)** CAN bus log files directly in VS Code — no external tools required.

BLF is the native recording format of Vector CANalyzer, CANoe, and related automotive diagnostic tools. This extension lets you inspect `.blf` files as a structured, filterable table without leaving your editor.

---

## Sample Screenshot

Below is a sample viewer screenshot. The left panel shows the message table with filters applied, and the right panel shows the details for a selected CAN frame.

![BLF Viewer sample](./images/preview.png)

## Features

### Automatic file association

Opening any `.blf` file in VS Code launches the viewer automatically. No commands needed.

### Virtual scrolling — handles large files

Files with hundreds of thousands of messages open instantly. The viewer renders only the rows currently visible on screen, keeping memory usage constant regardless of file size.

### Stats dashboard

At a glance: total message count, recording duration, messages/sec throughput, unique arbitration IDs, active channels, RX/TX split, and CAN FD frame count.

### DBC signal decoding

Click the **⊕ DBC** button in the toolbar to import a `.dbc` file. Once loaded:

- A badge shows the file name and the number of matched messages
- Every matched row in the table shows a **Name** column with the DBC message name
- Selecting a matched row shows a **Signals** section in the detail panel with each signal's raw hex value, physical value (with unit), and value-table label for enum signals (e.g. `Drive`, `Park`)
- Click **✕** next to the badge to unload the DBC and return to raw data

### Filter and search panels

The viewer has separate **Filter** and **Search** panels so you can either reduce the visible dataset or jump to a matching frame without changing what is displayed.

#### Filter panel

Use **Filter** when you want to hide messages that do not match your criteria. Filtering is applied on the extension host before paging, so it works across the full BLF file instead of only the currently rendered rows.

Filter by:

- **Arbitration ID** — hex substring match, comma-separated list (e.g. `7E0,7E8`), or `id@channel` syntax to pin a segment to a specific channel (e.g. `100@0` matches ID `100` on channel 0 only; `100@0,100@1` matches the same ID on both channels). Segments without `@` respect the global channel dropdown.
- **Data bytes** — contiguous payload byte sequence match, updated live as you type
- **Direction** — RX, TX, or both
- **Type** — Standard CAN, CAN FD, or Error frames
- **Channel** — individual channel or all

The ID filter field is wider by default and has a right-edge resize handle. Drag it horizontally when working with long comma-separated or `id@channel` filter expressions; the chosen width is remembered for the webview.

Data byte examples:

| Input              | Meaning                                                     |
| ------------------ | ----------------------------------------------------------- |
| `3E 80`            | Matches frames whose payload contains bytes `3E 80`         |
| `22 F1 90`         | Matches UDS ReadDataByIdentifier requests for DID `F190`    |
| `22F190`           | Same as `22 F1 90`; spaces are optional                     |
| `0x22 0xF1 0x90`   | Same as `22 F1 90`; `0x` prefixes are accepted              |

The data byte filter matches bytes in order and contiguously. For example, `22 F1 90` matches `03 22 F1 90 00`, but it does not match `22 00 F1 90` or `90 F1 22`.

#### Search panel

Use **Search** when you want to locate the first matching row without changing the visible dataset. Search uses the current filtered and sorted table as its search space, then scrolls to and selects the first matching row.

Search by:

- **Arbitration ID**
- **Data bytes**
- **Direction**
- **Type**
- **Channel**

Search data bytes follow the same matching rules as the data byte filter. For example, entering `22 F1 90` in **Search data bytes** and clicking **Find** jumps to the first currently visible-table row whose payload contains that sequence. The row count and active filters do not change.

Use **Filter** when you want a smaller table. Use **Search** when you want navigation inside the current table.

### Sortable columns

Click any column header to sort ascending; click again to reverse. Sorting is applied on the full filtered dataset on the extension host before paging, so the order is always correct across all pages.

The table includes both the original relative **Time(s)** column and a default-visible **UTC** column with ISO UTC timestamps.

### Resizable and reorderable columns

Drag a column edge to resize it. Drag a column header to a new position to reorder. Use the **⊞ Columns** button to show or hide individual columns.

### Multi-select

- **Click** — single select
- **Ctrl / Cmd + Click** — toggle individual rows
- **Shift + Click** — select a contiguous range

The selection count is shown in the toolbar.

### Right-click context menu

Right-click any row for quick actions:

| Action                  | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| Add to Filter           | Sets the ID filter to this message's arbitration ID             |
| Show Details            | Opens the detail panel for this row                             |
| Colorize                | Highlights the row (or selection) in a chosen color             |
| Group by…               | Groups rows visually by type, direction, channel, or ID         |
| Select all with same ID | Multi-selects every visible row sharing the same arbitration ID |
| Copy row                | Copies tab-separated values to the clipboard                    |
| Copy Arb ID             | Copies the hex arbitration ID                                   |
| Copy data bytes         | Copies the hex byte string                                      |
| Copy selection as CSV   | Exports all selected rows as CSV with a header row              |
| Remove color            | Clears colorization from the row or selection                   |

### Detail panel

Select any row to see the full message breakdown: byte grid, hex/decimal/binary table for each byte, and all decoded flags (Extended ID, Remote Frame, BRS, ESI).

### Supported frame types

- CAN 2.0A — 11-bit standard frames
- CAN 2.0B — 29-bit extended frames
- CAN FD — with Bit Rate Switch (BRS) and Error State Indicator (ESI)
- CAN FD Message 64 payloads — decoded with the CAN FD DLC-to-length mapping so 12/16/20/24/32/48/64-byte payloads display correctly
- Error frames

### Theme adaptive

Uses VS Code CSS variables throughout — works correctly with any light or dark color theme.

---

## Requirements

- VS Code **1.109.0** or later
- No external dependencies or native modules — pure TypeScript

---

## Usage

1. Open a `.blf` file via **File → Open File** or by double-clicking in the Explorer panel
2. The BLF Viewer opens automatically as a custom editor
3. Use the **Filter** panel to narrow the table by ID, data bytes, direction, type, or channel
4. Use the **Search** panel to jump to the first matching row without changing the current table
5. Click any row to inspect its bytes in the detail panel on the right
6. Click **⊟ Detail** in the top bar to show or hide the detail panel
7. Right-click any row for copy, colorize, filter, and grouping options

Common examples:

| Goal                                     | Action                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| Show only tester present frames          | Enter `3E 80` in **Filter → Data bytes**                |
| Show only DID F190 read requests         | Enter `22 F1 90` in **Filter → Data bytes**             |
| Jump to the first DID F190 request       | Enter `22 F1 90` in **Search → Data bytes**, click Find |
| Show multiple response IDs               | Enter `7E8,7E9` in **Filter → ID**                      |
| Search only inside channel 1 traffic     | Set **Filter → Ch** to `Ch 1`, then use **Search**      |

You can also open a file explicitly from the Command Palette:

```
BLF: Open File
```

---

## Extension Settings

This extension does not contribute any configurable settings.

---

## Release Notes

### Unreleased

CAN FD Message 64 payload parsing fix, UTC timestamp column, payload data byte filter, and a Search panel to jump to matching rows without changing the visible table.

### 1.1.0

`id@channel` filter syntax to restrict individual ID segments to a specific channel, a wider resizable ID filter field, test infrastructure with 11 unit tests for `applyFilter`, and lint cleanup for brace-style control-flow warnings.

### 1.0.0

DBC import and signal decoding, message name column, multi-ID filter (comma-separated), and a pure-TypeScript DBC parser with Intel/Motorola byte order, signed/unsigned signals, value tables, and comments.

### 0.2.0

Resizable and reorderable columns, column visibility toggle, real host-side sorting, multi-select, right-click context menu with colorize / group / copy actions, and fixes for sort key mismatch, empty-filter ghost rows, and leading-zero ID matching.

### 0.1.0

Initial release. Virtual scrolling viewer with filtering, stats dashboard, detail panel, and full CAN / CAN FD / error frame support.

---

## About BLF

The Binary Logging Format (`.blf`) is a binary container format developed by Vector Informatik GmbH. It stores timestamped CAN, CAN FD, LIN, FlexRay, and other bus messages in compressed blocks (LOBJ containers). This extension implements the CAN and CAN FD portions of the format.

---

## License

MIT
