import * as vscode from 'vscode';
import { BLFReader, CANMessage, FileHeader } from './blf-parser';
import * as path from 'path';

// ── Types shared between host and webview ─────────────────────────────────────

interface PageRequest {
  type: 'requestPage';
  startIndex: number;
  count: number;
  filter: FilterState;
}

interface FilterState {
  id: string;
  dir: string;      // '' | 'RX' | 'TX'
  msgType: string;  // '' | 'STD' | 'FD' | 'ERR'
  channel: string;  // '' | '0' | '1' ...
}

// Lean wire format — only what the webview needs per row
interface WireMessage {
  i: number;        // original (filtered) index
  t: string;        // formatted timestamp
  id: string;       // formatted arb ID
  rawId: number;
  type: 'STD' | 'FD' | 'ERR';
  dir: 'RX' | 'TX';
  ch: number;
  dlc: number;
  data: string;     // "AA BB CC"
  ext: boolean;
  rtr: boolean;
  brs: boolean;
  esi: boolean;
  err: boolean;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class BLFViewProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'blf.viewer';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Ship the shell immediately — zero data, instant paint
    const fileName = path.basename(document.uri.fsPath);
    webviewPanel.webview.html = this.getShellHtml(getNonce(), fileName);

    // Parse in the background; extension host owns the data array
    let messages: CANMessage[] = [];

    try {
      const reader  = new BLFReader(document.uri.fsPath);
      messages      = await reader.parse();
      const header  = reader.getHeader();
      const errors  = reader.getErrors();

      // Send metadata only — NOT the full message array
      const channels = [...new Set(messages.map(m => m.channel))].sort((a, b) => a - b);
      const rxCount  = messages.filter(m => m.isRx).length;
      const fdCount  = messages.filter(m => m.isFd).length;
      const errCount = messages.filter(m => m.isErrorFrame).length;
      const uniqueIds= new Set(messages.map(m => m.arbitrationId)).size;

      webviewPanel.webview.postMessage({
        type: 'init',
        header,
        totalCount: messages.length,
        rxCount,
        txCount: messages.length - rxCount,
        fdCount,
        errCount,
        uniqueIds,
        channels,
        errors: errors.slice(0, 50),
        fileName,
      });
    } catch (err) {
      webviewPanel.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // ── Handle page requests from the webview ─────────────────────────────────
    // The webview asks for small windows of data as the user scrolls.
    // We filter and page here in the extension host — never ship everything.
    webviewPanel.webview.onDidReceiveMessage((req: PageRequest) => {
      if (req.type !== 'requestPage') return;

      const filtered = applyFilter(messages, req.filter);
      const page     = filtered.slice(req.startIndex, req.startIndex + req.count);

      webviewPanel.webview.postMessage({
        type: 'page',
        startIndex: req.startIndex,
        totalFiltered: filtered.length,
        rows: page.map((m, li) => toWire(m, req.startIndex + li)),
      });
    });

    // Free parsed data when the editor closes
    webviewPanel.onDidDispose(() => { messages = []; });
  }

  // ── Shell HTML ──────────────────────────────────────────────────────────────
  // Structure + script only. Zero message data embedded here.
  // Small and instant; becomes interactive before the file finishes parsing.
  private getShellHtml(nonce: string, fileName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>BLF Viewer</title>
  <style>
    /* ── Variables ─────────────────────────────────────────── */
    :root {
      --bg:        var(--vscode-editor-background);
      --bg2:       var(--vscode-sideBar-background, #1e1e1e);
      --bg3:       var(--vscode-tab-inactiveBackground, #2d2d2d);
      --border:    var(--vscode-panel-border, rgba(255,255,255,0.08));
      --fg:        var(--vscode-editor-foreground);
      --fg2:       var(--vscode-descriptionForeground);
      --accent:    var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #fff);
      --hover:     var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
      --sel:       var(--vscode-list-activeSelectionBackground, rgba(14,99,156,0.3));
      --green:     var(--vscode-testing-iconPassed, #73c991);
      --red:       var(--vscode-errorForeground, #f14c4c);
      --yellow:    var(--vscode-editorWarning-foreground, #cca700);
      --blue:      var(--vscode-symbolIcon-variableForeground, #9cdcfe);
      --purple:    var(--vscode-symbolIcon-classForeground, #c586c0);
      --mono:      'Cascadia Code','JetBrains Mono',Menlo,Consolas,monospace;
      --row-h:     26px;  /* EXACT — virtual scroller depends on this */
      --head-h:    32px;
    }

    /* ── Reset ──────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%; overflow: hidden;
      background: var(--bg); color: var(--fg);
      font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
    }

    /* ── App shell ───────────────────────────────────────────── */
    .app { display: flex; flex-direction: column; height: 100vh; }

    /* ── Topbar ──────────────────────────────────────────────── */
    .topbar {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; background: var(--bg2);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .topbar-icon  { font-size: 15px; }
    .topbar-title { font-weight: 600; font-size: 13px; opacity: .9; }
    .topbar-time  { font-family: var(--mono); font-size: 11px; color: var(--fg2); }
    .topbar-space { flex: 1; }
    .btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; height: 26px;
      background: var(--bg3); color: var(--fg);
      border: 1px solid var(--border); border-radius: 4px;
      font-size: 12px; cursor: pointer; user-select: none; white-space: nowrap;
      transition: background .1s, border-color .1s;
    }
    .btn:hover  { background: var(--hover); border-color: var(--accent); }
    .btn.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }

    /* ── Stats strip ─────────────────────────────────────────── */
    .stats {
      display: flex; background: var(--bg2);
      border-bottom: 1px solid var(--border);
      overflow-x: auto; flex-shrink: 0;
    }
    .stat {
      display: flex; flex-direction: column; padding: 9px 18px;
      border-right: 1px solid var(--border); min-width: 100px; flex-shrink: 0;
    }
    .stat:last-child { border-right: none; }
    .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg2); }
    .stat-value { font-family: var(--mono); font-size: 15px; font-weight: 600; margin-top: 3px; }
    .c-accent  { color: var(--accent); }  .c-green  { color: var(--green); }
    .c-red     { color: var(--red);   }   .c-blue   { color: var(--blue);  }
    .c-purple  { color: var(--purple);}   .c-yellow { color: var(--yellow);}

    /* ── Toolbar ─────────────────────────────────────────────── */
    .toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 16px; background: var(--bg2);
      border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
    }
    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-icon {
      position: absolute; left: 8px; color: var(--fg2);
      font-size: 12px; pointer-events: none; user-select: none;
    }
    input[type="text"], select {
      background: var(--vscode-input-background); color: var(--fg);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px; height: 26px;
      font-family: var(--mono); font-size: 12px; outline: none;
    }
    input[type="text"]:focus, select:focus { border-color: var(--accent); }
    .filter-id { padding: 0 8px 0 26px; width: 160px; }
    select { padding: 0 8px; cursor: pointer; }
    .toolbar-space { flex: 1; }
    .result-count { font-size: 11px; color: var(--fg2); font-family: var(--mono); white-space: nowrap; }

    /* ── Main ────────────────────────────────────────────────── */
    .main { display: flex; flex: 1; overflow: hidden; }

    /* ── Virtual scroller ────────────────────────────────────── */
    /*
     * The scroller is a fixed-height div with overflow-y:scroll.
     * Inside it sits one tall "spacer" div: height = totalRows × ROW_H.
     * This makes the scrollbar behave as if all rows are present.
     * Only visible rows (+overscan) are actual DOM nodes.
     * They are positioned absolutely at top = rowIndex × ROW_H.
     *
     * Memory cost: constant regardless of file size.
     * 1,000,000 rows → same DOM footprint as 60 rows.
     */
    .scroller {
      flex: 1; overflow-y: scroll; overflow-x: auto;
      position: relative;
      will-change: scroll-position; /* GPU-composited layer */
    }
    .spacer { position: relative; width: 100%; }

    /* ── Table header (outside scroller so it never scrolls away) ── */
    .thead-wrap {
      background: var(--bg2); border-bottom: 1px solid var(--border);
      overflow: hidden; flex-shrink: 0;
    }
    .col-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .col-table th {
      padding: 0 8px; height: var(--head-h);
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--fg2); text-align: left;
      border-right: 1px solid var(--border);
      cursor: pointer; user-select: none;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .col-table th:last-child { border-right: none; }
    .col-table th:hover { color: var(--fg); background: var(--hover); }
    .col-table th.sorted { color: var(--fg); }
    .sort-ind { font-size: 9px; margin-left: 3px; }

    /* Shared column widths (applied to both header and rows) */
    .c0 { width: 52px;  }   /* # */
    .c1 { width: 108px; }   /* time */
    .c2 { width: 100px; }   /* id */
    .c3 { width: 52px;  }   /* type */
    .c4 { width: 44px;  }   /* dir */
    .c5 { width: 38px;  }   /* ch */
    .c6 { width: 36px;  }   /* dlc */
    .c7 { min-width: 160px; } /* data — grows */
    .c8 { width: 110px; }   /* flags */

    /* ── Row pool ────────────────────────────────────────────── */
    /*
     * Rows are absolutely-positioned div.row elements, not <tr>.
     * <tr> cannot be position:absolute, so flex rows are used instead.
     * We keep a fixed pool and mutate content + top offset on each render.
     * This avoids the cost of createElement/removeChild during scroll.
     */
    .row {
      position: absolute; left: 0; right: 0;
      display: flex; align-items: center;
      height: var(--row-h);
      border-bottom: 1px solid rgba(128,128,128,0.07);
      cursor: pointer;
    }
    .row:hover { background: var(--hover); }
    .row.sel   { background: var(--sel);   }
    .row.r-err { background: rgba(241,76,76,.05); }
    .row.r-fd  { background: rgba(156,198,255,.04); }

    .cell {
      padding: 0 8px; font-family: var(--mono); font-size: 12px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
    }
    .cell.c7 { flex-shrink: 1; flex-grow: 1; }

    .t-idx  { color: var(--fg2); font-size: 11px; }
    .t-time { color: var(--blue); }
    .t-id   { color: #e8c8a0; font-weight: 500; }
    .t-data { color: #b5cea8; letter-spacing: .03em; }

    /* Badges */
    .badge {
      display: inline-flex; align-items: center;
      padding: 0 5px; border-radius: 3px;
      font-size: 10px; font-weight: 700; letter-spacing: .04em; line-height: 16px;
    }
    .b-std { background: rgba(108,153,187,.18); color: #6c99bb; }
    .b-fd  { background: rgba(156,198,255,.18); color: #9cdcfe; }
    .b-err { background: rgba(241,76,76,.2);    color: #f48771; }
    .b-rx  { background: rgba(115,201,145,.15); color: #73c991; }
    .b-tx  { background: rgba(197,134,192,.15); color: #c586c0; }

    .flag {
      display: inline-block; padding: 0 3px; border-radius: 2px;
      font-size: 9px; font-weight: 700; margin-right: 2px; line-height: 14px;
    }
    .f-ext { background: rgba(108,153,187,.25); color: #6c99bb; }
    .f-rtr { background: rgba(202,178,100,.25); color: #cab864; }
    .f-brs { background: rgba(156,198,255,.25); color: #9cdcfe; }
    .f-esi { background: rgba(197,134,192,.25); color: #c586c0; }

    /* ── Detail panel ────────────────────────────────────────── */
    .detail {
      width: 270px; flex-shrink: 0;
      border-left: 1px solid var(--border); background: var(--bg2);
      overflow-y: auto; display: flex; flex-direction: column;
    }
    .detail.hidden { display: none; }
    .detail-head {
      padding: 10px 14px 8px; font-size: 10px; text-transform: uppercase;
      letter-spacing: .07em; color: var(--fg2);
      border-bottom: 1px solid var(--border); font-weight: 600; flex-shrink: 0;
    }
    .d-row  { display: flex; padding: 6px 14px; border-bottom: 1px solid rgba(128,128,128,.07); gap: 8px; }
    .d-key  { font-size: 11px; color: var(--fg2); width: 90px; flex-shrink: 0; }
    .d-val  { font-family: var(--mono); font-size: 12px; color: var(--fg); word-break: break-all; }
    .byte-row  { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 14px; }
    .byte-cell {
      width: 30px; height: 24px; display: flex; align-items: center; justify-content: center;
      background: var(--bg3); border: 1px solid var(--border); border-radius: 3px;
      font-family: var(--mono); font-size: 11px; font-weight: 500; color: #b5cea8;
    }
    .byte-idx-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 14px 4px; }
    .byte-idx { width: 30px; text-align: center; font-size: 9px; color: var(--fg2); }

    /* ── Loading / empty / error states ─────────────────────── */
    .overlay {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 14px; color: var(--fg2); font-size: 13px;
    }
    .spinner {
      width: 36px; height: 36px;
      border: 3px solid var(--border); border-top-color: var(--accent);
      border-radius: 50%; animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Errors bar ──────────────────────────────────────────── */
    .errors-bar {
      flex-shrink: 0; padding: 6px 16px;
      background: rgba(241,76,76,.07);
      border-top: 1px solid rgba(241,76,76,.25);
      font-size: 11px; color: #f48771; display: none;
    }
    .errors-bar.visible { display: block; }
    .errors-bar summary { cursor: pointer; font-weight: 600; user-select: none; }

    /* ── Scrollbar ───────────────────────────────────────────── */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(128,128,128,.3); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,.5); }
  </style>
</head>
<body>
<div class="app">

  <!-- Top bar -->
  <div class="topbar">
    <span class="topbar-icon">📡</span>
    <span class="topbar-title">${escHtml(fileName)}</span>
    <span class="topbar-time" id="topTime">Parsing…</span>
    <span class="topbar-space"></span>
    <button class="btn active" id="btnDetail">⊞ Detail</button>
  </div>

  <!-- Stats strip -->
  <div class="stats">
    <div class="stat"><span class="stat-label">Messages</span><span class="stat-value c-accent" id="s-total">—</span></div>
    <div class="stat"><span class="stat-label">Duration</span><span class="stat-value" id="s-dur">—</span></div>
    <div class="stat"><span class="stat-label">Msg/s</span><span class="stat-value" id="s-rate">—</span></div>
    <div class="stat"><span class="stat-label">Unique IDs</span><span class="stat-value c-blue" id="s-ids">—</span></div>
    <div class="stat"><span class="stat-label">Channels</span><span class="stat-value" id="s-ch">—</span></div>
    <div class="stat"><span class="stat-label">RX / TX</span><span class="stat-value" id="s-rxtx">—</span></div>
    <div class="stat"><span class="stat-label">CAN FD</span><span class="stat-value c-blue" id="s-fd">—</span></div>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-id" id="fId" placeholder="Filter ID…" autocomplete="off" spellcheck="false">
    </div>
    <select id="fDir">
      <option value="">All Dir</option>
      <option value="RX">RX</option>
      <option value="TX">TX</option>
    </select>
    <select id="fType">
      <option value="">All Types</option>
      <option value="STD">STD</option>
      <option value="FD">CAN FD</option>
      <option value="ERR">Error</option>
    </select>
    <select id="fCh"><option value="">All Ch</option></select>
    <span class="toolbar-space"></span>
    <span class="result-count" id="rCount"></span>
    <button class="btn" id="btnClear">✕ Clear</button>
  </div>

  <!-- Sticky table header (lives OUTSIDE the scroller) -->
  <div class="thead-wrap">
    <table class="col-table">
      <colgroup>
        <col class="c0"><col class="c1"><col class="c2"><col class="c3">
        <col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8">
      </colgroup>
      <thead><tr>
        <th class="c0 sorted" data-sort="i">#<span class="sort-ind">↑</span></th>
        <th class="c1" data-sort="t">Time (s)<span class="sort-ind">↕</span></th>
        <th class="c2" data-sort="rawId">Arb ID<span class="sort-ind">↕</span></th>
        <th class="c3" data-sort="type">Type<span class="sort-ind">↕</span></th>
        <th class="c4" data-sort="dir">Dir<span class="sort-ind">↕</span></th>
        <th class="c5" data-sort="ch">Ch<span class="sort-ind">↕</span></th>
        <th class="c6" data-sort="dlc">DLC<span class="sort-ind">↕</span></th>
        <th class="c7">Data</th>
        <th class="c8">Flags</th>
      </tr></thead>
    </table>
  </div>

  <!-- Main content area -->
  <div class="main">

    <!-- Virtual scroller -->
    <div class="scroller" id="scroller">
      <div class="spacer" id="spacer">
        <!-- Loading overlay; removed after init -->
        <div class="overlay" id="overlay">
          <div class="spinner"></div>
          <span>Parsing BLF file…</span>
        </div>
        <!-- Row pool is injected here by JS -->
      </div>
    </div>

    <!-- Detail panel -->
    <div class="detail" id="detail">
      <div class="detail-head">Message Detail</div>
      <div id="detailBody" style="color:var(--fg2);font-size:12px;padding:14px">Select a row to inspect</div>
    </div>
  </div>

  <!-- Parse errors -->
  <div class="errors-bar" id="errorsBar">
    <details>
      <summary id="errSummary"></summary>
      <div id="errList" style="margin-top:5px;line-height:1.8;font-family:var(--mono)"></div>
    </details>
  </div>

</div><!-- /.app -->

<script nonce="${nonce}">
(function () {
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const ROW_H    = 26;   // Must match CSS --row-h exactly
const OVERSCAN = 15;   // Extra rows rendered above/below the visible window
const PAGE_SZ  = 60;   // Rows requested per postMessage round-trip

// ── State ─────────────────────────────────────────────────────────────────────
const vscode = acquireVsCodeApi();
let totalFiltered = 0;
let selectedRowI  = -1;  // selected row's 'i' field

// Page cache: Map<pageStart, WireMessage[]>
// We cache received pages so scrolling back up is free.
const pageCache   = new Map();
const pending     = new Set();   // page starts we've requested but not yet received

let filter = { id: '', dir: '', msgType: '', channel: '' };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const scroller    = document.getElementById('scroller');
const spacer      = document.getElementById('spacer');
const overlay     = document.getElementById('overlay');
const detailPanel = document.getElementById('detail');
const detailBody  = document.getElementById('detailBody');
const rCount      = document.getElementById('rCount');

// ── Row pool (object pooling pattern) ────────────────────────────────────────
//
// We pre-create a fixed number of div.row elements and REUSE them across
// renders. Instead of inserting/removing nodes on every scroll tick, we
// only update innerHTML and style.top — both are cheap mutations.
//
// Why this matters:
//   createElement / appendChild / removeChild each trigger style recalc.
//   For 60 fps scrolling across 100k rows, that would be thousands of
//   recalcs per second → jank and high CPU. A fixed pool eliminates that.
//
let rowPool = [];

function ensurePool(needed) {
  while (rowPool.length < needed) {
    const div = document.createElement('div');
    div.className = 'row';
    div.addEventListener('click', onRowClick);
    spacer.appendChild(div);
    rowPool.push(div);
  }
  // Hide everything first; renderViewport will unhide what it needs
  for (let i = 0; i < rowPool.length; i++) {
    rowPool[i].style.display = 'none';
  }
}

// ── Virtual scroll core ───────────────────────────────────────────────────────

function updateSpacerHeight() {
  // The spacer's height makes the scrollbar reflect the full logical list.
  // Without this, the scrollbar thumb would be proportional to DOM nodes only.
  spacer.style.height = (totalFiltered * ROW_H) + 'px';
}

function renderViewport() {
  if (totalFiltered === 0) return;

  const scrollTop     = scroller.scrollTop;
  const viewH         = scroller.clientHeight;
  const firstVisible  = Math.floor(scrollTop / ROW_H);
  const lastVisible   = Math.min(totalFiltered - 1, Math.ceil((scrollTop + viewH) / ROW_H));

  // Expand range by overscan to reduce visible "popping" during fast scroll
  const renderStart = Math.max(0, firstVisible - OVERSCAN);
  const renderEnd   = Math.min(totalFiltered - 1, lastVisible + OVERSCAN);
  const count       = renderEnd - renderStart + 1;

  ensurePool(count);

  // Request any pages we don't yet have
  requestPagesForRange(renderStart, renderEnd);

  // Place rows
  for (let vi = 0; vi < count; vi++) {
    const rowIdx = renderStart + vi;
    const div    = rowPool[vi];
    div.style.display = 'flex';
    div.style.top     = (rowIdx * ROW_H) + 'px';

    const msg = getCachedRow(rowIdx);
    if (msg) {
      renderRow(div, msg);
    } else {
      renderPlaceholder(div, rowIdx);
    }
  }
}

// ── Page management ───────────────────────────────────────────────────────────

function pageStart(rowIdx) {
  return Math.floor(rowIdx / PAGE_SZ) * PAGE_SZ;
}

function requestPagesForRange(start, end) {
  const ps = pageStart(start);
  const pe = pageStart(end);
  for (let p = ps; p <= pe; p += PAGE_SZ) {
    if (!pageCache.has(p) && !pending.has(p)) {
      pending.add(p);
      vscode.postMessage({
        type: 'requestPage',
        startIndex: p,
        count: PAGE_SZ,
        filter: { ...filter },
      });
    }
  }
}

function getCachedRow(rowIdx) {
  const ps   = pageStart(rowIdx);
  const page = pageCache.get(ps);
  return page ? (page[rowIdx - ps] ?? null) : null;
}

function invalidateCache() {
  pageCache.clear();
  pending.clear();
}

// ── Row rendering ─────────────────────────────────────────────────────────────
//
// We build innerHTML via string concatenation rather than DOM manipulation.
//
// Benchmark reality for hot-path rendering:
//   innerHTML = "..." : 1 style recalc per row (browser batches children)
//   createElement × N : N style recalcs per row
//
// For 60 rows re-rendered 60 times/sec = 3600 renders/sec.
// String concat is the right call here.

function renderRow(div, m) {
  const tc = m.type === 'ERR' ? 'b-err' : m.type === 'FD' ? 'b-fd' : 'b-std';
  const dc = m.dir  === 'RX'  ? 'b-rx'  : 'b-tx';
  const rc = 'row' + (m.i === selectedRowI ? ' sel' : '') + (m.err ? ' r-err' : m.type === 'FD' ? ' r-fd' : '');

  div.className  = rc;
  div.dataset.mi = m.i;
  div.innerHTML  =
    '<div class="cell c0 t-idx">'  + (m.i + 1) + '</div>' +
    '<div class="cell c1 t-time">' + m.t + '</div>' +
    '<div class="cell c2 t-id">'   + esc(m.id) + '</div>' +
    '<div class="cell c3"><span class="badge ' + tc + '">' + m.type + '</span></div>' +
    '<div class="cell c4"><span class="badge ' + dc + '">' + m.dir  + '</span></div>' +
    '<div class="cell c5">'  + m.ch  + '</div>' +
    '<div class="cell c6">'  + m.dlc + '</div>' +
    '<div class="cell c7 t-data">' + esc(m.data) + '</div>' +
    '<div class="cell c8">'  + flags(m) + '</div>';
}

function renderPlaceholder(div, rowIdx) {
  div.className  = 'row';
  div.dataset.mi = '';
  div.innerHTML  =
    '<div class="cell c0 t-idx">' + (rowIdx + 1) + '</div>' +
    '<div class="cell c1" style="color:var(--fg2);font-size:11px">loading…</div>';
}

function flags(m) {
  return (m.ext ? '<span class="flag f-ext">EXT</span>' : '') +
         (m.rtr ? '<span class="flag f-rtr">RTR</span>' : '') +
         (m.brs ? '<span class="flag f-brs">BRS</span>' : '') +
         (m.esi ? '<span class="flag f-esi">ESI</span>' : '');
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function showDetail(m) {
  if (!m || !detailBody) return;
  const bytes = m.data ? m.data.split(' ').filter(Boolean) : [];

  let html =
    dr('Index',    m.i + 1) +
    dr('Rel. Time','<span style="color:var(--blue)">' + m.t + ' s</span>') +
    dr('Arb. ID',  '<span style="color:#e8c8a0">' + esc(m.id) + '</span>') +
    dr('Type',     m.type) +
    dr('Direction',m.dir) +
    dr('Channel',  m.ch) +
    dr('DLC',      m.dlc) +
    dr('Flags',    [m.ext ? 'Extended ID' : 'Standard ID', m.rtr ? 'Remote Frame' : '', m.brs ? 'BRS' : '', m.esi ? 'ESI' : ''].filter(Boolean).join(', '));

  if (bytes.length > 0) {
    html += '<div style="padding:8px 14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--fg2)">Bytes</div>';
    html += '<div class="byte-idx-row">' + bytes.map((_,i) => '<span class="byte-idx">' + i + '</span>').join('') + '</div>';
    html += '<div class="byte-row">'     + bytes.map(b => '<div class="byte-cell">' + b + '</div>').join('') + '</div>';
    html += '<div style="padding:4px 14px 8px"><table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">';
    html += '<tr>' + ['B','Hex','Dec','Bin'].map(h => '<th style="color:var(--fg2);text-align:left;padding:2px 6px;font-size:10px">' + h + '</th>').join('') + '</tr>';
    bytes.forEach((b, i) => {
      const d = parseInt(b, 16);
      html += '<tr>' +
        '<td style="color:var(--fg2);padding:2px 6px">' + i + '</td>' +
        '<td style="color:#9cdcfe;padding:2px 6px">'    + b + '</td>' +
        '<td style="padding:2px 6px">'                   + d + '</td>' +
        '<td style="color:#b5cea8;padding:2px 6px;letter-spacing:.1em">' + d.toString(2).padStart(8,'0') + '</td></tr>';
    });
    html += '</table></div>';
  } else {
    html += '<div style="padding:8px 14px;color:var(--fg2);font-size:12px">No data bytes</div>';
  }

  detailBody.innerHTML = html;
}

function dr(key, val) {
  return '<div class="d-row"><span class="d-key">' + key + '</span><span class="d-val">' + val + '</span></div>';
}

// ── Events ────────────────────────────────────────────────────────────────────

function onRowClick(e) {
  const div = e.currentTarget;
  const mi  = parseInt(div.dataset.mi ?? '-1', 10);
  if (isNaN(mi) || mi < 0) return;
  selectedRowI = mi;
  showDetail(getCachedRow(mi));
  renderViewport(); // refresh selection highlight
}

scroller.addEventListener('scroll', () => {
  // requestAnimationFrame coalesces rapid scroll events into one paint.
  // Without it, scroll at 4000 px/s triggers renderViewport() hundreds of
  // times per second, each doing layout reads (scrollTop, clientHeight).
  requestAnimationFrame(renderViewport);
}, { passive: true });

// Filter controls
const fId   = document.getElementById('fId');
const fDir  = document.getElementById('fDir');
const fType = document.getElementById('fType');
const fCh   = document.getElementById('fCh');

function onFilterChange() {
  filter.id      = (fId?.value   ?? '').toLowerCase().trim();
  filter.dir     = fDir?.value   ?? '';
  filter.msgType = fType?.value  ?? '';
  filter.channel = fCh?.value    ?? '';
  invalidateCache();
  selectedRowI = -1;
  // Request page 0 to get the updated totalFiltered
  pending.add(0);
  vscode.postMessage({ type: 'requestPage', startIndex: 0, count: PAGE_SZ, filter: { ...filter } });
}

fId?.addEventListener('input',    onFilterChange);
fDir?.addEventListener('change',  onFilterChange);
fType?.addEventListener('change', onFilterChange);
fCh?.addEventListener('change',   onFilterChange);

document.getElementById('btnClear')?.addEventListener('click', () => {
  if (fId)   fId.value   = '';
  if (fDir)  fDir.value  = '';
  if (fType) fType.value = '';
  if (fCh)   fCh.value   = '';
  onFilterChange();
});

document.getElementById('btnDetail')?.addEventListener('click', () => {
  detailPanel?.classList.toggle('hidden');
  document.getElementById('btnDetail')?.classList.toggle('active');
});

// Sorting (currently cosmetic indicator — host always sends data in parse order;
// a future enhancement could pass sort params in requestPage)
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    document.querySelectorAll('th').forEach(t => { t.classList.remove('sorted'); t.querySelector('.sort-ind') && (t.querySelector('.sort-ind').textContent = '↕'); });
    th.classList.add('sorted');
    const si = th.querySelector('.sort-ind');
    if (si) si.textContent = '↑';
  });
});

// ── Message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', evt => {
  const msg = evt.data;

  if (msg.type === 'init') {
    const h   = msg.header;
    const dur = h ? (h.stopTimestamp - h.startTimestamp) : 0;

    set('s-total', msg.totalCount.toLocaleString());
    set('s-dur',   dur.toFixed(2) + 's');
    set('s-rate',  dur > 0 ? Math.round(msg.totalCount / dur).toLocaleString() : '—');
    set('s-ids',   (msg.uniqueIds ?? '—').toLocaleString());
    set('s-ch',    (msg.channels ?? []).map(c => 'Ch' + c).join(', ') || '—');
    set('s-rxtx',  '<span style="color:var(--green)">' + (msg.rxCount ?? 0).toLocaleString() + '</span> / <span style="color:var(--purple)">' + (msg.txCount ?? 0).toLocaleString() + '</span>');
    set('s-fd',    (msg.fdCount ?? 0).toLocaleString());

    if (h) {
      set('topTime', new Date(h.startTimestamp * 1000).toISOString().replace('T',' ').slice(0,23) + ' UTC');
    }

    // innerHTML is safe for stats because values are numbers, not user data
    document.getElementById('s-rxtx').innerHTML =
      '<span style="color:var(--green)">' + (msg.rxCount ?? 0).toLocaleString() + '</span>' +
      ' / <span style="color:var(--purple)">' + (msg.txCount ?? 0).toLocaleString() + '</span>';

    // Populate channel filter
    (msg.channels ?? []).forEach(c => {
      const o = document.createElement('option');
      o.value = String(c); o.textContent = 'Ch ' + c;
      fCh?.appendChild(o);
    });

    // Show parse errors
    if (msg.errors?.length) {
      const bar = document.getElementById('errorsBar');
      bar?.classList.add('visible');
      set('errSummary', '⚠ ' + msg.errors.length + ' parse warning' + (msg.errors.length > 1 ? 's' : ''));
      const el = document.getElementById('errList');
      if (el) el.innerHTML = msg.errors.map(esc).join('<br>');
    }

    totalFiltered = msg.totalCount;
    updateSpacerHeight();
    overlay.style.display = 'none';

    // Kick off the first page
    requestPagesForRange(0, Math.min(totalFiltered - 1, PAGE_SZ - 1));
  }

  else if (msg.type === 'page') {
    pending.delete(msg.startIndex);
    pageCache.set(msg.startIndex, msg.rows);

    if (msg.startIndex === 0) {
      totalFiltered = msg.totalFiltered;
      updateSpacerHeight();
      if (rCount) rCount.textContent = totalFiltered.toLocaleString() + ' rows';
    }

    renderViewport();
  }

  else if (msg.type === 'error') {
    overlay.innerHTML =
      '<div style="background:rgba(241,76,76,.1);border:1px solid rgba(241,76,76,.4);' +
      'border-radius:6px;padding:20px 24px;max-width:500px">' +
      '<div style="color:#f48771;font-weight:600;margin-bottom:8px">⚠ Parse error</div>' +
      '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + esc(msg.message) + '</pre></div>';
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(s) {
  if (typeof s !== 'string') return String(s ?? '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

})();
</script>
</body>
</html>`;
  }
}

// ── Host-side helpers ─────────────────────────────────────────────────────────

function applyFilter(messages: CANMessage[], f: FilterState): CANMessage[] {
  const idLower = f.id.toLowerCase();
  const dir     = f.dir;
  const type    = f.msgType;
  const ch      = f.channel;

  // Fast path: no filters active
  if (!idLower && !dir && !type && !ch) return messages;

  return messages.filter(m => {
    if (dir  && (m.isRx ? 'RX' : 'TX') !== dir)                            return false;
    if (type && (m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD') !== type) return false;
    if (ch   && String(m.channel) !== ch)                                   return false;
    if (idLower) {
      const hexId = m.arbitrationId.toString(16).toLowerCase();
      if (!hexId.includes(idLower) && !('0x' + hexId).includes(idLower))   return false;
    }
    return true;
  });
}

function toWire(m: CANMessage, idx: number): WireMessage {
  return {
    i:     idx,
    t:     m.relativeTimestamp.toFixed(7),
    id:    m.isExtendedId
             ? '0x' + m.arbitrationId.toString(16).padStart(8,'0').toUpperCase()
             : m.arbitrationId.toString(16).padStart(3,'0').toUpperCase(),
    rawId: m.arbitrationId,
    type:  m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD',
    dir:   m.isRx ? 'RX' : 'TX',
    ch:    m.channel,
    dlc:   m.dlc,
    data:  Buffer.from(m.data).toString('hex').match(/.{1,2}/g)?.join(' ').toUpperCase() ?? '',
    ext:   m.isExtendedId,
    rtr:   m.isRemoteFrame,
    brs:   m.bitrateSwitch    ?? false,
    esi:   m.errorStateIndicator ?? false,
    err:   m.isErrorFrame     ?? false,
  };
}

function getNonce(): string {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
  return t;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}