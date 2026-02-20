# BLF Viewer — Developer Quickstart

## Project structure

```
blf-viewer/
├── src/
│   ├── extension.ts          # Entry point — registers the custom editor and commands
│   ├── blfViewProvider.ts    # Webview UI + virtual scroll engine + host↔webview messaging
│   ├── blf-parser.ts         # Binary BLF parser (file header, container decompression, CAN frames)
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
Extension Host (Node.js)          Webview (Chromium renderer)
────────────────────────          ───────────────────────────
blf-parser.ts                     blfViewProvider.ts (client)
  └─ Parses .blf file               └─ Virtual scroller
  └─ Holds CANMessage[] in memory     └─ Fixed DOM row pool (~80 divs)
  └─ Filters on demand                └─ Requests pages as user scrolls
        │                                       │
        └──── postMessage (60 rows at a time) ──┘
```

The webview **never receives the full dataset**. It requests small pages via `postMessage` and the extension host filters + slices the array on demand. This means a 500 MB BLF file with 2 million frames has the same DOM footprint as a 1 KB file.

## Recommended VS Code extensions for development

Install these before starting:

- `amodio.tsl-problem-matcher` — surfaces TypeScript errors inline
- `ms-vscode.extension-test-runner` — runs the test suite from the Testing panel
- `dbaeumer.vscode-eslint` — lint feedback as you type

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

Breakpoints set in `src/extension.ts`, `src/blfViewProvider.ts`, or `src/blf-parser.ts` work normally when launched with F5.

For debugging the **webview side** (the virtual scroller, filter logic, row rendering), open the Extension Development Host window and run:

```
Help → Toggle Developer Tools
```

This opens a standard Chromium DevTools attached to the webview process.

## Key files explained

### `src/blf-parser.ts`

Reads the BLF binary format: file header (`LOGG` signature), LOBJ container blocks, zlib decompression, and individual CAN/CAN FD/error frame parsing. Returns a `CANMessage[]` array with relative and absolute timestamps.

### `src/blfViewProvider.ts`

Implements `vscode.CustomReadonlyEditorProvider`. On open it:

1. Sends the shell HTML immediately (instant paint, no data embedded)
2. Parses the file asynchronously
3. Posts metadata (`init` message) to the webview
4. Listens for `requestPage` messages and responds with filtered, sliced rows

### `src/extension.ts`

Registers the `BLFViewProvider` as a custom editor for `*.blf` files and registers the `blf.openFile` command.

## Running tests

```bash
npm run test
```

Or use the Testing panel in VS Code (requires the Extension Test Runner extension). Test files must match `**/*.test.ts`.

## Building for publishing

```bash
# Type-check + lint + bundle (minified, tree-shaken)
npm run package

# Package into a .vsix file you can install locally or upload to the Marketplace
npx vsce package

# Install locally to verify before publishing
code --install-extension blf-viewer-0.1.0.vsix

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
