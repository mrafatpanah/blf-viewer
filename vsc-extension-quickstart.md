# BLF Viewer — Developer Quickstart

## Project structure

```
blf-viewer/
├── src/
│   ├── extension.ts          # Entry point — registers the custom editor and commands
│   ├── blfViewProvider.ts    # VS Code provider shell — wires parse → filter → sort → page
│   ├── blf-parser.ts         # Binary BLF parser (file header, container decompression, CAN frames)
│   ├── blf-host.ts           # Pure host-side logic: applyFilter, applySort, toWire
│   ├── blf-types.ts          # Shared TypeScript interfaces (FilterState, SortState, WireMessage, …)
│   ├── blf-webview.ts        # Webview HTML/CSS generator + full webview runtime (IIFE string)
│   └── test/
│       └── extension.test.ts # Integration tests
├── images/
│   └── icon.png              # 128×128 Marketplace icon (required for publishing)
├── package.json              # Extension manifest — customEditors, commands, metadata
├── esbuild.js                # Build script (compiles src/ → dist/extension.js)
└── tsconfig.json             # TypeScript config
```

## Architecture overview

The extension uses a **two-process, demand-paged** architecture to keep memory usage low even for very large BLF files.

```
Extension Host (Node.js)                  Webview (Chromium renderer)
────────────────────────                  ───────────────────────────
blf-parser.ts                             blf-webview.ts (runtime)
  └─ Parses .blf → CANMessage[]             └─ Virtual scroller
blf-host.ts                                 └─ Fixed DOM row pool (~80 divs)
  └─ applyFilter(messages, filter)           └─ Column resize / reorder / visibility
  └─ applySort(filtered, sort)               └─ Multi-select + right-click context menu
  └─ toWire(msg, idx) → WireMessage          └─ Requests pages as user scrolls / sorts / filters
blfViewProvider.ts                                    │
  └─ Orchestrates the above                          │
        │                                            │
        └──── postMessage (60 rows at a time) ───────┘
                filter + sort sent with every request
```

The webview **never receives the full dataset**. It sends a `requestPage` message containing the current `FilterState` and `SortState`; the extension host filters, sorts, and slices the array, then returns only the requested window of rows. A 500 MB file with 2 million frames has the same DOM footprint as a 1 KB file.

## Module responsibilities

### `src/blf-parser.ts`

Reads the BLF binary format: file header (`LOGG` signature), LOBJ container blocks, zlib decompression, and individual CAN / CAN FD / error frame structs. Returns a `CANMessage[]` array. No VS Code or webview dependencies — can be unit-tested in Node directly.

### `src/blf-types.ts`

All TypeScript interfaces shared between the host and the webview string:

- `FilterState` — the four filter fields sent with every page request
- `SortState` — column key + direction (`asc` | `desc`)
- `WireMessage` — lean per-row object sent over `postMessage`
- `WebviewMessage` / `HostMessage` — discriminated unions for the full message protocol

> **Note:** `blf-types.ts` is imported by the host modules at compile time. The webview runtime is a plain JS string (`WEBVIEW_JS` in `blf-webview.ts`), so types are structural only there — the field names in `WireMessage` must match what the webview JS reads.

### `src/blf-host.ts`

Pure functions with no VS Code or DOM dependencies:

- `applyFilter(messages, filter)` — filters by ID (padded hex match), direction, type, channel
- `applySort(messages, sort)` — stable sort by timestamp, Arb ID, type, direction, channel, or DLC; never mutates the master array
- `toWire(msg, idx)` — converts a `CANMessage` to the lean `WireMessage` wire format

Because these are pure functions, they are straightforward to unit-test without spinning up a webview.

### `src/blfViewProvider.ts`

Implements `vscode.CustomReadonlyEditorProvider`. On open it:

1. Sends the shell HTML immediately (instant paint — no data embedded in the HTML)
2. Parses the file asynchronously via `BLFReader`
3. Posts `init` metadata to the webview (stats, channel list, parse errors)
4. Listens for `requestPage` messages and responds with `applyFilter → applySort → slice → toWire`

### `src/blf-webview.ts`

Exports `getWebviewHtml(nonce, fileName)` which returns the complete HTML string injected into the `WebviewPanel`. It contains three embedded sections:

- **`CSS`** constant — all styles, including column resize/drag states, row colorization, context menu, and toast
- **HTML template** — structural markup; data-free, paints instantly
- **`WEBVIEW_JS`** constant — the full webview runtime as an IIFE string. Responsible for: column definitions and layout, virtual scroll engine, page cache, sort/filter state, row pool rendering, multi-select, right-click context menu with all submenus, colorization, grouping banner, detail panel, and clipboard copy

### `src/extension.ts`

Registers `BLFViewProvider` as a custom editor for `*.blf` files and registers the `blf.openFile` command.

## Running the extension locally

```bash
npm install       # install dev dependencies
npm run compile   # build src/ → dist/
```

Then press **F5** in VS Code. A new **Extension Development Host** window opens with your extension loaded. Open any `.blf` file in that window — the viewer activates automatically.

> **Important:** never run `node dist/extension.js` directly. The `vscode` module is
> injected by the extension host at runtime and does not exist as an npm package.
> The extension must be launched via F5 or `vsce`.

## Development workflow

| Action                      | How                                               |
| --------------------------- | ------------------------------------------------- |
| Rebuild after a code change | `Ctrl+Shift+B` or `npm run compile`               |
| Reload the extension host   | `Ctrl+R` in the Extension Development Host window |
| Full restart with debugger  | Stop and re-press F5                              |
| Watch mode (auto-rebuild)   | `npm run watch` in a terminal                     |

Breakpoints set in `src/extension.ts`, `src/blfViewProvider.ts`, `src/blf-host.ts`, or `src/blf-parser.ts` work normally when launched with F5.

For debugging the **webview side** (virtual scroller, filter/sort state, row rendering, context menu), open the Extension Development Host window and run:

```
Help → Toggle Developer Tools
```

This opens a standard Chromium DevTools attached to the webview process. Because the webview runtime lives inside the `WEBVIEW_JS` string in `blf-webview.ts`, source maps are not available there — use `console.log` or the DevTools console directly.

## Page request flow

Every scroll, filter change, or sort click triggers this sequence:

```
Webview                              Extension Host
──────                               ──────────────
postMessage({                        onDidReceiveMessage
  type: 'requestPage',          →      applyFilter(messages, req.filter)
  startIndex: 0,                       applySort(filtered, req.sort)
  count: 60,                           sorted.slice(0, 60).map(toWire)
  filter: { id:'7e0', … },       ←    postMessage({ type:'page', rows, totalFiltered })
  sort:   { col:'t', dir:'asc' }
})
```

Key invariants:

- The master `CANMessage[]` array is **never mutated** — `applySort` always works on a `.slice()` copy
- `totalFiltered` (returned with every page-0 response) drives the spacer height and row count display
- When `resetAndRefetch()` fires (filter or sort change), `totalFiltered` is set to `0` immediately so stale rows are hidden before the response arrives

## Running tests

```bash
npm run test
```

Or use the Testing panel in VS Code (requires the Extension Test Runner extension). Test files must match `**/*.test.ts`.

`blf-host.ts` and `blf-parser.ts` have no VS Code dependencies and can be tested with plain Node / Mocha.

## Building for publishing

```bash
# Type-check + lint + bundle (minified, tree-shaken)
npm run package

# Package into a .vsix file you can install locally or upload to the Marketplace
npx vsce package

# Install locally to verify before publishing
code --install-extension blf-viewer-0.2.0.vsix

# Publish (requires a publisher account and Personal Access Token)
npx vsce publish
```

## Publishing checklist

Before running `vsce publish`, confirm:

- [ ] `images/icon.png` exists and is exactly 128×128 px (Marketplace rejects without it)
- [ ] `README.md` has at least one screenshot under `images/`
- [ ] `package.json` has a valid `publisher` field matching your Marketplace account
- [ ] `package.json` has a `repository` URL
- [ ] `CHANGELOG.md` reflects the current version
- [ ] `npm run package` completes with no errors or warnings
- [ ] The extension works correctly when installed from the `.vsix` file locally

## Useful references

- [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [vsce CLI reference](https://github.com/microsoft/vscode-vsce)
