// ── Webview HTML/JS generator ─────────────────────────────────────────────────
// Returns the complete shell HTML injected into the WebviewPanel.
// The embedded <script> is the full webview runtime — no external deps.

export function getWebviewHtml(nonce: string, fileName: string): string {
  const safeFileName = escHtml(fileName);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>BLF Viewer – ${safeFileName}</title>
  <style>${CSS}</style>
</head>
<body>
<div class="app">

  <!-- Top bar -->
  <div class="topbar">
    <span class="topbar-icon">📡</span>
    <span class="topbar-title">${safeFileName}</span>
    <span class="topbar-time" id="topTime">Parsing…</span>
    <span class="topbar-space"></span>
    <button class="btn" id="btnCols" title="Show/hide columns">⊞ Columns</button>
    <button class="btn active" id="btnDetail">⊟ Detail</button>
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

  <!-- Filter toolbar -->
  <div class="toolbar">
    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-id" id="fId" placeholder="Filter by ID…" autocomplete="off" spellcheck="false">
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
    <span class="sel-count" id="selCount" style="display:none"></span>
    <span class="result-count" id="rCount">—</span>
    <button class="btn" id="btnClear">✕ Clear</button>
    <span style="width:1px;height:18px;background:var(--border);flex-shrink:0"></span>
    <button class="btn" id="btnImportDbc" title="Import DBC file">⊕ DBC</button>
    <span class="dbc-badge" id="dbcBadge" style="display:none"></span>
    <button class="btn" id="btnClearDbc" style="display:none" title="Remove DBC">✕</button>
  </div>

  <!-- Active grouping banner -->
  <div class="group-bar hidden" id="groupBar">
    <span>Grouped by:</span>
    <div id="groupChips"></div>
    <button class="btn" id="btnClearGroup" style="padding:2px 8px;height:22px;font-size:11px">Clear grouping</button>
  </div>

  <!-- Sticky column header — built by JS -->
  <div class="thead-wrap" id="theadWrap"></div>

  <!-- Main content -->
  <div class="main">
    <div class="table-area">
      <div class="scroller" id="scroller">
        <div class="spacer" id="spacer">
          <div class="overlay" id="overlay">
            <div class="spinner"></div>
            <span>Parsing BLF file…</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail panel -->
    <div class="detail" id="detail">
      <div class="detail-head">Message Detail</div>
      <div id="detailBody" style="color:var(--fg2);font-size:12px;padding:14px">
        Select a row to inspect.
      </div>
    </div>
  </div>

  <!-- Parse error bar -->
  <div class="errors-bar" id="errorsBar">
    <details>
      <summary id="errSummary"></summary>
      <div id="errList" style="margin-top:5px;line-height:1.8;font-family:var(--mono)"></div>
    </details>
  </div>

</div><!-- /.app -->

<!-- Portals rendered into body so they escape stacking contexts -->
<div class="ctx-menu"    id="ctxMenu"    style="display:none"></div>
<div class="ctx-submenu" id="ctxSubmenu" style="display:none"></div>
<div class="toast"       id="toast"></div>

<script nonce="${nonce}">${WEBVIEW_JS}</script>
</body>
</html>`;
}

// ── Utility (host-side only) ──────────────────────────────────────────────────

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── CSS ───────────────────────────────────────────────────────────────────────
// Kept here so it stays co-located with the HTML template above.

const CSS = `
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
    --sel:       var(--vscode-list-activeSelectionBackground, rgba(14,99,156,0.35));
    --sel-multi: rgba(14,99,156,0.18);
    --green:     var(--vscode-testing-iconPassed, #73c991);
    --red:       var(--vscode-errorForeground, #f14c4c);
    --yellow:    var(--vscode-editorWarning-foreground, #cca700);
    --blue:      var(--vscode-symbolIcon-variableForeground, #9cdcfe);
    --purple:    var(--vscode-symbolIcon-classForeground, #c586c0);
    --mono:      'Cascadia Code','JetBrains Mono',Menlo,Consolas,monospace;
    --row-h:     26px;
    --head-h:    32px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif); font-size: 13px; }

  .app { display: flex; flex-direction: column; height: 100vh; }

  /* Topbar */
  .topbar { display: flex; align-items: center; gap: 10px; padding: 8px 16px;
    background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
  .topbar-icon  { font-size: 15px; }
  .topbar-title { font-weight: 600; font-size: 13px; opacity: .9; }
  .topbar-time  { font-family: var(--mono); font-size: 11px; color: var(--fg2); }
  .topbar-space { flex: 1; }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px; height: 26px; background: var(--bg3); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    font-size: 12px; cursor: pointer; user-select: none; white-space: nowrap;
    transition: background .1s, border-color .1s;
  }
  .btn:hover  { background: var(--hover); border-color: var(--accent); }
  .btn.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }

  /* Stats strip */
  .stats { display: flex; background: var(--bg2); border-bottom: 1px solid var(--border);
    overflow-x: auto; flex-shrink: 0; }
  .stat { display: flex; flex-direction: column; padding: 9px 18px;
    border-right: 1px solid var(--border); min-width: 100px; flex-shrink: 0; }
  .stat:last-child { border-right: none; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg2); }
  .stat-value { font-family: var(--mono); font-size: 15px; font-weight: 600; margin-top: 3px; }
  .c-accent { color: var(--accent); } .c-green { color: var(--green); }
  .c-blue   { color: var(--blue);  } .c-purple{ color: var(--purple);}

  /* Toolbar */
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 16px;
    background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-icon { position: absolute; left: 8px; color: var(--fg2); font-size: 12px;
    pointer-events: none; user-select: none; }
  input[type="text"], select {
    background: var(--vscode-input-background); color: var(--fg);
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 4px; height: 26px; font-family: var(--mono); font-size: 12px; outline: none;
  }
  input[type="text"]:focus, select:focus { border-color: var(--accent); }
  .filter-id { padding: 0 8px 0 26px; width: 160px; }
  select { padding: 0 8px; cursor: pointer; }
  .toolbar-space { flex: 1; }
  .result-count { font-size: 11px; color: var(--fg2); font-family: var(--mono); white-space: nowrap; }
  .sel-count    { font-size: 11px; color: var(--accent); font-family: var(--mono); white-space: nowrap; }

  /* Group bar */
  .group-bar { display: flex; align-items: center; gap: 8px; padding: 4px 16px;
    background: rgba(14,99,156,.1); border-bottom: 1px solid var(--border);
    font-size: 11px; color: var(--fg2); flex-shrink: 0; }
  .group-bar.hidden { display: none; }
  .group-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
    border-radius: 10px; background: var(--accent); color: var(--accent-fg);
    font-size: 11px; font-weight: 600; }
  .group-chip button { background: none; border: none; color: inherit; cursor: pointer;
    padding: 0; line-height: 1; font-size: 12px; opacity: .8; }
  .group-chip button:hover { opacity: 1; }

  /* Layout */
  .main       { display: flex; flex: 1; overflow: hidden; }
  .table-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

  /* Column header */
  .thead-wrap { background: var(--bg2); border-bottom: 2px solid var(--border);
    overflow: hidden; flex-shrink: 0; }
  .thead-row  { display: flex; align-items: stretch; height: var(--head-h); }

  .th-inner {
    display: flex; align-items: center; position: relative;
    height: var(--head-h); padding: 0 8px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .05em; color: var(--fg2);
    cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .th-inner:last-child { border-right: none; }
  .th-inner:hover  { color: var(--fg); background: var(--hover); }
  .th-inner.sorted { color: var(--accent); }
  .th-label  { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .sort-ind  { font-size: 10px; margin-left: 4px; opacity: .5; flex-shrink: 0; }
  .th-inner.sorted .sort-ind { opacity: 1; }

  /* Drag handle */
  .th-drag { width: 12px; cursor: grab; opacity: 0; color: var(--fg2);
    font-size: 9px; flex-shrink: 0; display: flex; align-items: center;
    justify-content: center; transition: opacity .15s; margin-right: 2px; }
  .th-inner:hover .th-drag { opacity: .45; }
  .th-drag:active { cursor: grabbing; }

  /* Resize handle */
  .th-resize { position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
    cursor: col-resize; background: transparent; z-index: 1; transition: background .12s; }
  .th-resize:hover, .th-resize.active { background: var(--accent); }

  /* Column DnD states */
  .th-inner.dragging  { opacity: .35; }
  .th-inner.drag-over { background: rgba(14,99,156,.15); border-left: 2px solid var(--accent); }

  /* Virtual scroller */
  .scroller { flex: 1; overflow-y: scroll; overflow-x: auto;
    position: relative; will-change: scroll-position; }
  .spacer { position: relative; width: 100%; min-height: 100%; }

  /* Row pool */
  .row { position: absolute; left: 0; right: 0; display: flex; align-items: center;
    height: var(--row-h); border-bottom: 1px solid rgba(128,128,128,.07); cursor: pointer; }
  .row:hover     { background: var(--hover); }
  .row.sel       { background: var(--sel) !important; }
  .row.sel-multi { background: var(--sel-multi); }
  .row.r-err     { background: rgba(241,76,76,.06); }
  .row.r-fd      { background: rgba(156,198,255,.04); }

  /* Custom row colors (from colorize menu) */
  .row[data-color="red"]    { background: rgba(241,76,76,.15)    !important; }
  .row[data-color="green"]  { background: rgba(115,201,145,.15)  !important; }
  .row[data-color="blue"]   { background: rgba(156,198,255,.15)  !important; }
  .row[data-color="yellow"] { background: rgba(204,167,0,.15)    !important; }
  .row[data-color="purple"] { background: rgba(197,134,192,.15)  !important; }
  .row[data-color="orange"] { background: rgba(210,140,60,.15)   !important; }

  /* Empty-state overlay */
  .empty-state { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 10px;
    color: var(--fg2); font-size: 13px; pointer-events: none; }
  .empty-state.hidden { display: none; }

  /* Cells */
  .cell { padding: 0 8px; font-family: var(--mono); font-size: 12px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .t-idx  { color: var(--fg2); font-size: 11px; }
  .t-time { color: var(--blue); }
  .t-id   { color: #e8c8a0; font-weight: 500; }
  .t-data { color: #b5cea8; letter-spacing: .03em; }

  /* Badges */
  .badge { display: inline-flex; align-items: center; padding: 0 5px; border-radius: 3px;
    font-size: 10px; font-weight: 700; letter-spacing: .04em; line-height: 16px; }
  .b-std { background: rgba(108,153,187,.18); color: #6c99bb; }
  .b-fd  { background: rgba(156,198,255,.18); color: #9cdcfe; }
  .b-err { background: rgba(241,76,76,.2);    color: #f48771; }
  .b-rx  { background: rgba(115,201,145,.15); color: #73c991; }
  .b-tx  { background: rgba(197,134,192,.15); color: #c586c0; }

  /* Flag pills */
  .flag { display: inline-block; padding: 0 3px; border-radius: 2px;
    font-size: 9px; font-weight: 700; margin-right: 2px; line-height: 14px; }
  .f-ext { background: rgba(108,153,187,.25); color: #6c99bb; }
  .f-rtr { background: rgba(202,178,100,.25); color: #cab864; }
  .f-brs { background: rgba(156,198,255,.25); color: #9cdcfe; }
  .f-esi { background: rgba(197,134,192,.25); color: #c586c0; }

  /* Detail panel */
  .detail { width: 270px; flex-shrink: 0; border-left: 1px solid var(--border);
    background: var(--bg2); overflow-y: auto; display: flex; flex-direction: column; }
  .detail.hidden { display: none; }
  .detail-head { padding: 10px 14px 8px; font-size: 10px; text-transform: uppercase;
    letter-spacing: .07em; color: var(--fg2); border-bottom: 1px solid var(--border);
    font-weight: 600; flex-shrink: 0; }
  .d-row { display: flex; padding: 6px 14px; border-bottom: 1px solid rgba(128,128,128,.07); gap: 8px; }
  .d-key { font-size: 11px; color: var(--fg2); width: 90px; flex-shrink: 0; }
  .d-val { font-family: var(--mono); font-size: 12px; color: var(--fg); word-break: break-all; }
  .byte-row  { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 14px; }
  .byte-cell { width: 30px; height: 24px; display: flex; align-items: center; justify-content: center;
    background: var(--bg3); border: 1px solid var(--border); border-radius: 3px;
    font-family: var(--mono); font-size: 11px; font-weight: 500; color: #b5cea8; }
  .byte-idx-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 14px 4px; }
  .byte-idx { width: 30px; text-align: center; font-size: 9px; color: var(--fg2); }

  /* Context menu */
  .ctx-menu { position: fixed; z-index: 9999; background: var(--bg2);
    border: 1px solid var(--border); border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45); min-width: 210px; padding: 4px 0;
    font-size: 12px; animation: ctxIn .08s ease-out; }
  @keyframes ctxIn { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
  .ctx-item { display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; cursor: pointer; color: var(--fg); user-select: none; white-space: nowrap; }
  .ctx-item:hover       { background: var(--hover); color: var(--accent); }
  .ctx-item.danger:hover{ background: rgba(241,76,76,.1); color: var(--red); }
  .ctx-sep   { height: 1px; background: var(--border); margin: 4px 0; }
  .ctx-label { padding: 4px 12px 2px; font-size: 10px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--fg2); cursor: default; }
  .ctx-icon  { width: 16px; text-align: center; font-size: 13px; flex-shrink: 0; }
  .ctx-arrow { margin-left: auto; font-size: 10px; color: var(--fg2); }

  /* Context submenu */
  .ctx-submenu { position: fixed; z-index: 10000; background: var(--bg2);
    border: 1px solid var(--border); border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45); padding: 8px;
    animation: ctxIn .08s ease-out; }
  .color-swatch { width: 22px; height: 22px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; transition: transform .1s, border-color .1s; }
  .color-swatch:hover { transform: scale(1.2); border-color: var(--fg); }

  /* Loading overlay */
  .overlay { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; color: var(--fg2); font-size: 13px; }
  .spinner { width: 36px; height: 36px; border: 3px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error bar */
  .errors-bar { flex-shrink: 0; padding: 6px 16px; background: rgba(241,76,76,.07);
    border-top: 1px solid rgba(241,76,76,.25); font-size: 11px; color: #f48771; display: none; }
  .errors-bar.visible { display: block; }
  .errors-bar summary { cursor: pointer; font-weight: 600; user-select: none; }

  /* Toast */
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 16px; font-size: 12px; color: var(--fg);
    box-shadow: 0 4px 16px rgba(0,0,0,.3); pointer-events: none; opacity: 0;
    transition: opacity .2s; z-index: 99999; }
  .toast.show { opacity: 1; }

  /* Scrollbars */
  ::-webkit-scrollbar       { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(128,128,128,.3); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,.5); }

  /* DBC badge in toolbar */
  .dbc-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 10px; font-size: 11px;
    background: rgba(115,201,145,.15); color: var(--green);
    font-family: var(--mono); max-width: 220px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Signal section in detail panel */
  .sig-section-head {
    padding: 8px 14px 4px; font-size: 10px; text-transform: uppercase;
    letter-spacing: .07em; color: var(--fg2); font-weight: 600;
    border-top: 1px solid var(--border); margin-top: 4px;
  }
  .sig-item { padding: 6px 14px; border-bottom: 1px solid rgba(128,128,128,.07); }
  .sig-name { font-family: var(--mono); font-size: 12px; color: var(--purple); font-weight: 500; }
  .sig-vals { display: flex; gap: 12px; margin-top: 3px; flex-wrap: wrap; align-items: baseline; }
  .sig-raw  { font-family: var(--mono); font-size: 11px; color: var(--yellow); }
  .sig-phys { font-family: var(--mono); font-size: 11px; color: var(--green); font-weight: 500; }
  .sig-label{ font-family: var(--mono); font-size: 11px; color: var(--purple); }
  .sig-comment { font-size: 11px; color: var(--fg2); font-style: italic; margin-top: 2px; }
`;

// ── Webview runtime JS ────────────────────────────────────────────────────────
// This string is injected verbatim into the <script nonce="…"> tag.
// It runs entirely inside the sandboxed webview iframe — no Node.js APIs.

const WEBVIEW_JS = `
(function () {
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ROW_H    = 26;   // must match CSS --row-h exactly
const OVERSCAN = 15;   // extra rows above/below visible viewport
const PAGE_SZ  = 60;   // rows per postMessage round-trip

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN DEFINITIONS
// key must match WireMessage field names (or 'flags').
// 'flex:true' columns take remaining width; only one should have flex.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_COLS = [
  { key:'i',     label:'#',       width:52,  minWidth:36,  sortable:true,  visible:true  },
  { key:'t',     label:'Time(s)', width:108, minWidth:70,  sortable:true,  visible:true  },
  { key:'utc',   label:'UTC',     width:178, minWidth:140, sortable:true,  visible:true  },
  { key:'id',    label:'Arb ID',  width:100, minWidth:60,  sortable:true,  visible:true  },
  { key:'name',  label:'Name',    width:160, minWidth:80,  sortable:false, visible:false },
  { key:'type',  label:'Type',    width:54,  minWidth:40,  sortable:true,  visible:true  },
  { key:'dir',   label:'Dir',     width:48,  minWidth:36,  sortable:true,  visible:true  },
  { key:'ch',    label:'Ch',      width:40,  minWidth:30,  sortable:true,  visible:true  },
  { key:'dlc',   label:'DLC',     width:38,  minWidth:30,  sortable:true,  visible:true  },
  { key:'flags', label:'Flags',   width:110, minWidth:60,  sortable:false, visible:true  },
  { key:'data',  label:'Data',    width:0,   minWidth:120, sortable:false, visible:true, flex:true },
];

// Working copy — mutated by reorder/resize/visibility toggles
let cols = DEFAULT_COLS.map(c => ({ ...c }));

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const vscode      = acquireVsCodeApi();

let totalFiltered = 0;            // total rows after filter+sort (from host)
let selectedRowI  = -1;           // single-selected row's 'i' value
let selectedSet   = new Set();    // multi-select set of 'i' values
let lastClickedI  = -1;           // anchor for shift-click range

const pageCache   = new Map();    // Map<pageStart, WireMessage[]>
const pending     = new Set();    // page-starts requested but not yet received

let filter = { id:'', dir:'', msgType:'', channel:'' };
let sort   = { col:'i', dir:'asc' };

// Colorization: Map<rowI, colorName>
const rowColors = new Map();

// DBC state
let dbcLoaded   = false;
let dbcFileName = '';

// Grouping field key or null
let groupBy = null;

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const scroller    = document.getElementById('scroller');
const spacer      = document.getElementById('spacer');
const overlay     = document.getElementById('overlay');
const detailPanel = document.getElementById('detail');
const detailBody  = document.getElementById('detailBody');
const rCountEl    = document.getElementById('rCount');
const selCountEl  = document.getElementById('selCount');
const theadWrap   = document.getElementById('theadWrap');
const ctxMenu     = document.getElementById('ctxMenu');
const ctxSubmenu  = document.getElementById('ctxSubmenu');
const toastEl     = document.getElementById('toast');
const groupBar    = document.getElementById('groupBar');
const groupChips  = document.getElementById('groupChips');

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN HEADER
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader() {
  theadWrap.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'thead-row';

  cols.forEach((col, ci) => {
    if (!col.visible) return;

    const th = document.createElement('div');
    th.className     = 'th-inner' + (sort.col === col.key ? ' sorted' : '');
    th.dataset.ci    = ci;
    th.draggable     = true;
    th.style.cssText = thStyle(col);

    const arrow = sort.col === col.key ? (sort.dir === 'asc' ? '↑' : '↓') : (col.sortable ? '↕' : '');
    th.innerHTML =
      '<span class="th-drag" title="Drag to reorder">⠿</span>' +
      '<span class="th-label">' + col.label + '</span>' +
      (col.sortable ? '<span class="sort-ind">' + arrow + '</span>' : '') +
      '<div class="th-resize" data-ci="' + ci + '"></div>';

    // Sort click (skip if the event originated on the resize/drag handles)
    if (col.sortable) {
      th.addEventListener('click', e => {
        if (e.target.classList.contains('th-resize') ||
            e.target.classList.contains('th-drag')) return;
        onSortClick(col.key);
      });
    }

    // Column drag-to-reorder
    th.addEventListener('dragstart', onColDragStart);
    th.addEventListener('dragover',  onColDragOver);
    th.addEventListener('dragleave', onColDragLeave);
    th.addEventListener('drop',      onColDrop);
    th.addEventListener('dragend',   onColDragEnd);

    // Column resize
    th.querySelector('.th-resize').addEventListener('mousedown', onResizeStart);

    row.appendChild(th);
  });

  theadWrap.appendChild(row);
}

function thStyle(col) {
  const base = 'overflow:hidden;position:relative;';
  return col.flex
    ? base + 'flex:1;min-width:' + col.minWidth + 'px;'
    : base + 'width:' + col.width + 'px;min-width:' + col.minWidth + 'px;flex-shrink:0;';
}

// ─────────────────────────────────────────────────────────────────────────────
// SORT
// ─────────────────────────────────────────────────────────────────────────────

function onSortClick(key) {
  if (sort.col === key) {
    sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sort.col = key;
    sort.dir = 'asc';
  }
  buildHeader();
  resetAndRefetch();
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN RESIZE
// ─────────────────────────────────────────────────────────────────────────────

let resizeCi = -1, resizeStartX = 0, resizeStartW = 0;

function onResizeStart(e) {
  e.preventDefault();
  e.stopPropagation();
  resizeCi     = parseInt(e.currentTarget.dataset.ci, 10);
  resizeStartX = e.clientX;
  resizeStartW = cols[resizeCi].width;
  e.currentTarget.classList.add('active');
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup',   onResizeEnd);
}

function onResizeMove(e) {
  if (resizeCi < 0) return;
  cols[resizeCi].width = Math.max(cols[resizeCi].minWidth, resizeStartW + (e.clientX - resizeStartX));
  syncHeaderWidths();
  renderViewport();  // re-paint rows immediately so widths stay in sync
}

function onResizeEnd() {
  resizeCi = -1;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup',   onResizeEnd);
  document.querySelectorAll('.th-resize').forEach(h => h.classList.remove('active'));
}

// Sync only header widths without rebuilding DOM
function syncHeaderWidths() {
  const ths = theadWrap.querySelectorAll('.th-inner');
  let vi = 0;
  cols.forEach(col => {
    if (!col.visible) return;
    const th = ths[vi++];
    if (!th) return;
    if (col.flex) { th.style.flex = '1'; th.style.width = ''; }
    else          { th.style.width = col.width + 'px'; th.style.flex = ''; }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN DRAG-TO-REORDER
// ─────────────────────────────────────────────────────────────────────────────

let dragSrcCi = -1;

function onColDragStart(e) {
  dragSrcCi = parseInt(e.currentTarget.dataset.ci, 10);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onColDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function onColDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function onColDrop(e) {
  e.preventDefault();
  const targetCi = parseInt(e.currentTarget.dataset.ci, 10);
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcCi < 0 || dragSrcCi === targetCi) return;
  const moved    = cols.splice(dragSrcCi, 1)[0];
  const insertAt = dragSrcCi < targetCi ? targetCi - 1 : targetCi;
  cols.splice(insertAt, 0, moved);
  buildHeader();
  renderViewport();
}
function onColDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragSrcCi = -1;
  document.querySelectorAll('.th-inner').forEach(t => t.classList.remove('drag-over'));
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN VISIBILITY POPOVER
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btnCols').addEventListener('click', function(e) {
  const existing = document.getElementById('colsPopover');
  if (existing) { existing.remove(); return; }

  const pop = document.createElement('div');
  pop.id = 'colsPopover';
  pop.style.cssText =
    'position:fixed;z-index:9998;background:var(--bg2);border:1px solid var(--border);' +
    'border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.4);padding:8px 0;min-width:160px;font-size:12px;';

  const rect = this.getBoundingClientRect();
  pop.style.top   = (rect.bottom + 4) + 'px';
  pop.style.right = (document.body.clientWidth - rect.right) + 'px';

  cols.forEach((col, ci) => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;color:var(--fg)';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = col.visible;
    chk.addEventListener('change', () => {
      cols[ci].visible = chk.checked;
      buildHeader();
      renderViewport();
    });
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(' ' + col.label));
    pop.appendChild(lbl);
  });

  document.body.appendChild(pop);

  const close = ev => {
    if (!pop.contains(ev.target) && ev.target !== e.currentTarget) {
      pop.remove();
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW POOL  (object-pool pattern for zero-GC virtual scrolling)
// ─────────────────────────────────────────────────────────────────────────────

let rowPool = [];

function ensurePool(needed) {
  while (rowPool.length < needed) {
    const div = document.createElement('div');
    div.className = 'row';
    div.addEventListener('click',       onRowClick);
    div.addEventListener('contextmenu', onRowContextMenu);
    spacer.appendChild(div);
    rowPool.push(div);
  }
  // Hide all — renderViewport unhides the ones it needs
  for (let i = 0; i < rowPool.length; i++) rowPool[i].style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL SCROLL CORE
// ─────────────────────────────────────────────────────────────────────────────

function updateSpacerHeight() {
  spacer.style.height = Math.max(0, totalFiltered) * ROW_H + 'px';
}

function renderViewport() {
  // Show/hide the "no results" state
  const emptyEl = document.getElementById('emptyState');
  if (totalFiltered === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    // Hide every pooled row so nothing stale is visible
    for (let i = 0; i < rowPool.length; i++) rowPool[i].style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const scrollTop    = scroller.scrollTop;
  const viewH        = scroller.clientHeight;
  const firstVisible = Math.floor(scrollTop / ROW_H);
  const lastVisible  = Math.min(totalFiltered - 1, Math.ceil((scrollTop + viewH) / ROW_H));
  const renderStart  = Math.max(0, firstVisible - OVERSCAN);
  const renderEnd    = Math.min(totalFiltered - 1, lastVisible + OVERSCAN);
  const count        = renderEnd - renderStart + 1;

  ensurePool(count);
  requestPagesForRange(renderStart, renderEnd);

  for (let vi = 0; vi < count; vi++) {
    const rowIdx = renderStart + vi;
    const div    = rowPool[vi];
    div.style.display = 'flex';
    div.style.top     = (rowIdx * ROW_H) + 'px';
    const msg = getCachedRow(rowIdx);
    msg ? renderRow(div, msg) : renderPlaceholder(div, rowIdx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function pageStart(idx) { return Math.floor(idx / PAGE_SZ) * PAGE_SZ; }

function requestPagesForRange(start, end) {
  for (let p = pageStart(start); p <= pageStart(end); p += PAGE_SZ) {
    if (!pageCache.has(p) && !pending.has(p)) {
      pending.add(p);
      vscode.postMessage({
        type: 'requestPage', startIndex: p, count: PAGE_SZ,
        filter: { ...filter }, sort: { ...sort },
      });
    }
  }
}

function getCachedRow(rowIdx) {
  const ps   = pageStart(rowIdx);
  const page = pageCache.get(ps);
  return page ? (page[rowIdx - ps] ?? null) : null;
}

// Called on every filter / sort change — clears cache and scrolls to top.
function resetAndRefetch() {
  pageCache.clear();
  pending.clear();
  selectedRowI = -1;
  selectedSet.clear();
  updateSelCount();
  scroller.scrollTop = 0;

  // Optimistically clear the row count now — the real value arrives with page 0.
  // Without this, the spacer keeps its old height and "ghost" rows stay visible
  // after a filter change that yields fewer (or zero) results.
  totalFiltered = 0;
  updateSpacerHeight();
  rCountEl.textContent = '…';
  renderViewport();   // hides all pool rows and shows empty-state if count is 0

  // Request page 0; when it arrives totalFiltered will be updated to the real value
  pending.add(0);
  vscode.postMessage({
    type: 'requestPage', startIndex: 0, count: PAGE_SZ,
    filter: { ...filter }, sort: { ...sort },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW RENDERING
// ─────────────────────────────────────────────────────────────────────────────

function renderRow(div, m) {
  const isSel      = m.i === selectedRowI;
  const isMultiSel = selectedSet.has(m.i);
  const color      = rowColors.get(m.i) || '';

  let cls = 'row';
  if (isSel)              cls += ' sel';
  else if (isMultiSel)    cls += ' sel-multi';
  else if (m.err)         cls += ' r-err';
  else if (m.type==='FD') cls += ' r-fd';

  div.className  = cls;
  div.dataset.mi = m.i;
  if (color) div.dataset.color = color;
  else       delete div.dataset.color;

  div.innerHTML = buildRowHTML(m);
}

function buildRowHTML(m) {
  const tc = m.type==='ERR' ? 'b-err' : m.type==='FD' ? 'b-fd' : 'b-std';
  const dc = m.dir==='RX'   ? 'b-rx'  : 'b-tx';
  let html = '';

  for (const col of cols) {
    if (!col.visible) continue;
    const s = col.flex
      ? 'flex:1;min-width:' + col.minWidth + 'px;'
      : 'width:' + col.width + 'px;flex-shrink:0;';

    let content;
    switch (col.key) {
      case 'i':     content = '<span class="t-idx">'   + (m.i+1)    + '</span>'; break;
      case 't':     content = '<span class="t-time">'  + m.t        + '</span>'; break;
      case 'utc':   content = '<span class="t-time">'  + m.utc      + '</span>'; break;
      case 'id':    content = '<span class="t-id">'    + esc(m.id)  + '</span>'; break;
      case 'name':  content = m.msgName
                      ? '<span style="color:var(--purple);font-weight:500">' + esc(m.msgName) + '</span>'
                      : '<span style="color:var(--fg2);font-size:11px">—</span>'; break;
      case 'type':  content = '<span class="badge ' + tc + '">'     + m.type + '</span>'; break;
      case 'dir':   content = '<span class="badge ' + dc + '">'     + m.dir  + '</span>'; break;
      case 'ch':    content = m.ch;  break;
      case 'dlc':   content = m.dlc; break;
      case 'data':  content = '<span class="t-data">'  + esc(m.data) + '</span>'; break;
      case 'flags': content = renderFlags(m); break;
      default:      content = '';
    }
    html += '<div class="cell" style="' + s + '">' + content + '</div>';
  }
  return html;
}

function renderPlaceholder(div, rowIdx) {
  div.className  = 'row';
  div.dataset.mi = '';
  delete div.dataset.color;
  div.innerHTML =
    '<div class="cell" style="width:52px;flex-shrink:0"><span class="t-idx">' + (rowIdx+1) + '</span></div>' +
    '<div class="cell" style="flex:1;color:var(--fg2);font-size:11px">loading…</div>';
}

function renderFlags(m) {
  return (m.ext ? '<span class="flag f-ext">EXT</span>' : '') +
         (m.rtr ? '<span class="flag f-rtr">RTR</span>' : '') +
         (m.brs ? '<span class="flag f-brs">BRS</span>' : '') +
         (m.esi ? '<span class="flag f-esi">ESI</span>' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW SELECTION (single / ctrl / shift)
// ─────────────────────────────────────────────────────────────────────────────

function onRowClick(e) {
  const mi = parseInt(e.currentTarget.dataset.mi ?? '-1', 10);
  if (isNaN(mi) || mi < 0) return;

  if (e.shiftKey && lastClickedI >= 0) {
    const lo = Math.min(lastClickedI, mi);
    const hi = Math.max(lastClickedI, mi);
    for (let x = lo; x <= hi; x++) selectedSet.add(x);
    selectedRowI = mi;
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedSet.has(mi)) selectedSet.delete(mi);
    else selectedSet.add(mi);
    selectedRowI = mi;
  } else {
    selectedSet.clear();
    selectedRowI = mi;
    lastClickedI = mi;
    showDetail(getCachedRow(mi));
  }

  updateSelCount();
  renderViewport();
}

function updateSelCount() {
  const n = selectedSet.size;
  selCountEl.textContent = n > 1 ? n + ' selected' : '';
  selCountEl.style.display = n > 1 ? 'inline' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU
// ─────────────────────────────────────────────────────────────────────────────

let ctxTargetI = -1;

function onRowContextMenu(e) {
  e.preventDefault();
  const mi = parseInt(e.currentTarget.dataset.mi ?? '-1', 10);
  if (isNaN(mi) || mi < 0) return;

  // Auto-select if not already
  if (!selectedSet.has(mi) && mi !== selectedRowI) {
    selectedSet.clear();
    selectedRowI = mi;
    lastClickedI = mi;
    updateSelCount();
    renderViewport();
  }

  ctxTargetI = mi;
  showContextMenu(e.clientX, e.clientY, mi);
}

function showContextMenu(x, y, mi) {
  closeCtxMenu();
  const m      = getCachedRow(mi);
  const isMul  = selectedSet.size > 1;
  const label  = isMul ? selectedSet.size + ' messages' : (m ? esc(m.id) : 'Message');
  const hasClr = rowColors.has(mi);

  ctxMenu.innerHTML =
    '<div class="ctx-label">📌 ' + label + '</div>' +

    '<div class="ctx-item" id="cxFilter">' +
      '<span class="ctx-icon">🔍</span>Add to Filter</div>' +

    '<div class="ctx-item" id="cxDetail">' +
      '<span class="ctx-icon">⊟</span>Show Details</div>' +

    '<div class="ctx-sep"></div>' +

    '<div class="ctx-item" id="cxColor">' +
      '<span class="ctx-icon">🎨</span>Colorize<span class="ctx-arrow">›</span></div>' +

    '<div class="ctx-item" id="cxGroup">' +
      '<span class="ctx-icon">⊞</span>Group by…<span class="ctx-arrow">›</span></div>' +

    '<div class="ctx-sep"></div>' +

    '<div class="ctx-item" id="cxSameId">' +
      '<span class="ctx-icon">◈</span>Select all with same ID</div>' +

    '<div class="ctx-sep"></div>' +

    '<div class="ctx-item" id="cxCopyRow">' +
      '<span class="ctx-icon">⎘</span>Copy row</div>' +

    '<div class="ctx-item" id="cxCopyId">' +
      '<span class="ctx-icon">⎘</span>Copy Arb ID</div>' +

    '<div class="ctx-item" id="cxCopyData">' +
      '<span class="ctx-icon">⎘</span>Copy data bytes</div>' +

    '<div class="ctx-item" id="cxCopyCsv">' +
      '<span class="ctx-icon">⎘</span>Copy selection as CSV</div>' +

    (hasClr ? '<div class="ctx-sep"></div>' +
      '<div class="ctx-item danger" id="cxClearClr">' +
        '<span class="ctx-icon">✕</span>Remove color</div>' : '');

  // Position (keep on screen)
  ctxMenu.style.display = 'block';
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(x, window.innerWidth  - mw - 8) + 'px';
  ctxMenu.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';

  // ── Wire up items ──────────────────────────────────────────────

  bind('cxFilter', () => {
    if (!m) return;
    const fId = document.getElementById('fId');
    if (fId) { fId.value = m.id; onFilterChange(); }
    closeCtxMenu();
  });

  bind('cxDetail', () => {
    if (!m) return;
    detailPanel.classList.remove('hidden');
    document.getElementById('btnDetail').classList.add('active');
    showDetail(m);
    closeCtxMenu();
  });

  bind('cxColor',  e2 => showColorSubmenu(e2.currentTarget, mi));
  bind('cxGroup',  e2 => showGroupSubmenu(e2.currentTarget));

  bind('cxSameId', () => {
    if (!m) return;
    const tid = m.rawId;
    selectedSet.clear();
    pageCache.forEach(page => page.forEach(r => { if (r.rawId === tid) selectedSet.add(r.i); }));
    updateSelCount();
    renderViewport();
    closeCtxMenu();
  });

  bind('cxCopyRow', () => {
    if (!m) return;
    copyText([m.i+1, m.t, m.utc, m.id, m.type, m.dir, m.ch, m.dlc, m.data, m.flags].join('\\t'));
    closeCtxMenu();
  });

  bind('cxCopyId',   () => { if (m) copyText(m.id);   closeCtxMenu(); });
  bind('cxCopyData', () => { if (m) copyText(m.data);  closeCtxMenu(); });

  bind('cxCopyCsv', () => {
    const rows = [['#','Time','UTC','Arb ID','Type','Dir','Ch','DLC','Data','Flags'].join(',')];
    const all  = [];
    pageCache.forEach(page => page.forEach(r => {
      if (selectedSet.has(r.i) || r.i === selectedRowI) all.push(r);
    }));
    all.sort((a,b) => a.i - b.i).forEach(r => {
      rows.push([r.i+1, r.t, r.utc, r.id, r.type, r.dir, r.ch, r.dlc, '"'+r.data+'"', r.flags].join(','));
    });
    copyText(rows.join('\\n'));
    closeCtxMenu();
  });

  bind('cxClearClr', () => {
    const targets = selectedSet.size > 1 ? [...selectedSet] : [mi];
    targets.forEach(i => rowColors.delete(i));
    renderViewport();
    closeCtxMenu();
  });
}

function bind(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

function showColorSubmenu(anchor, mi) {
  const swatches = [
    { name:'red',    bg:'#c0392b' },{ name:'green',  bg:'#27ae60' },
    { name:'blue',   bg:'#2980b9' },{ name:'yellow', bg:'#f39c12' },
    { name:'purple', bg:'#8e44ad' },{ name:'orange', bg:'#e67e22' },
  ];

  ctxSubmenu.innerHTML = '';
  ctxSubmenu.style.cssText = 'display:flex;flex-direction:row;gap:6px;padding:8px;flex-wrap:nowrap;';

  swatches.forEach(sw => {
    const el = document.createElement('div');
    el.className = 'color-swatch';
    el.title     = sw.name;
    el.style.background = sw.bg;
    el.addEventListener('click', () => {
      const targets = selectedSet.size > 1 ? [...selectedSet] : [mi];
      targets.forEach(i => rowColors.set(i, sw.name));
      renderViewport();
      closeCtxMenu();
    });
    ctxSubmenu.appendChild(el);
  });

  // "Clear" swatch
  const clr = document.createElement('div');
  clr.className = 'color-swatch';
  clr.title = 'Clear color';
  clr.style.cssText = 'background:transparent;border:2px dashed var(--border)';
  clr.addEventListener('click', () => {
    const targets = selectedSet.size > 1 ? [...selectedSet] : [mi];
    targets.forEach(i => rowColors.delete(i));
    renderViewport();
    closeCtxMenu();
  });
  ctxSubmenu.appendChild(clr);

  positionSubmenu(anchor);
}

function showGroupSubmenu(anchor) {
  const opts = [
    { key:'type', label:'Message Type (STD/FD/ERR)' },
    { key:'dir',  label:'Direction (RX/TX)' },
    { key:'ch',   label:'Channel' },
    { key:'id',   label:'Arb ID' },
  ];

  ctxSubmenu.innerHTML = '';
  ctxSubmenu.style.cssText = 'display:flex;flex-direction:column;padding:4px 0;';

  opts.forEach(o => {
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.textContent = o.label + (groupBy === o.key ? ' ✓' : '');
    el.addEventListener('click', () => { setGroupBy(o.key); closeCtxMenu(); });
    ctxSubmenu.appendChild(el);
  });

  positionSubmenu(anchor);
}

function positionSubmenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  ctxSubmenu.style.top  = rect.top  + 'px';
  ctxSubmenu.style.left = rect.right + 4 + 'px';
  ctxSubmenu.style.display = 'flex';

  // Flip left if off screen
  const sw = ctxSubmenu.offsetWidth;
  if (rect.right + 4 + sw > window.innerWidth) {
    ctxSubmenu.style.left = (rect.left - sw - 4) + 'px';
  }
}

function setGroupBy(key) {
  groupBy = key;
  groupBar.classList.remove('hidden');
  groupChips.innerHTML =
    '<div class="group-chip">' + key + '<button onclick="clearGroupBy()">×</button></div>';
  showToast('Grouped by ' + key);
}

// exposed to onclick in HTML
window.clearGroupBy = function() {
  groupBy = null;
  groupBar.classList.add('hidden');
  groupChips.innerHTML = '';
};

document.getElementById('btnClearGroup').addEventListener('click', window.clearGroupBy);

function closeCtxMenu() {
  ctxMenu.style.display    = 'none';
  ctxSubmenu.style.display = 'none';
}

document.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target) && !ctxSubmenu.contains(e.target)) closeCtxMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });

// ─────────────────────────────────────────────────────────────────────────────
// COPY HELPER
// ─────────────────────────────────────────────────────────────────────────────

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!')).catch(fallbackCopy.bind(null, text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Copied!'); } catch {}
  ta.remove();
}

let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────

function showDetail(m) {
  if (!m || !detailBody) return;
  const bytes = m.data ? m.data.split(' ').filter(Boolean) : [];
  const color = rowColors.get(m.i);

  let html =
    dr('Index',     m.i + 1) +
    dr('Rel. Time', '<span style="color:var(--blue)">' + m.t + ' s</span>') +
    dr('UTC',       '<span style="color:var(--blue)">' + esc(m.utc) + '</span>') +
    dr('Arb. ID',   '<span style="color:#e8c8a0">' + esc(m.id) + '</span>') +
    (m.msgName ? dr('Name', '<span style="color:var(--purple);font-weight:500">' + esc(m.msgName) + '</span>') : '') +
    dr('Type',      m.type) +
    dr('Direction', m.dir) +
    dr('Channel',   m.ch) +
    dr('DLC',       m.dlc) +
    dr('Flags',     m.flags || '—') +
    (color ? dr('Color', '<span style="text-transform:capitalize">' + color + '</span>') : '');

  if (bytes.length > 0) {
    html += '<div style="padding:8px 14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--fg2)">Bytes</div>';
    html += '<div class="byte-idx-row">' + bytes.map((_,i) => '<span class="byte-idx">' + i + '</span>').join('') + '</div>';
    html += '<div class="byte-row">'     + bytes.map(b   => '<div class="byte-cell">'   + b + '</div>').join('') + '</div>';
    html += '<div style="padding:4px 14px 8px"><table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">';
    html += '<tr>' + ['B','Hex','Dec','Bin'].map(h =>
      '<th style="color:var(--fg2);text-align:left;padding:2px 6px;font-size:10px">' + h + '</th>').join('') + '</tr>';
    bytes.forEach((b, i) => {
      const d = parseInt(b, 16);
      html += '<tr>' +
        '<td style="color:var(--fg2);padding:2px 6px">'  + i + '</td>' +
        '<td style="color:#9cdcfe;padding:2px 6px">'     + b + '</td>' +
        '<td style="padding:2px 6px">'                    + d + '</td>' +
        '<td style="color:#b5cea8;padding:2px 6px;letter-spacing:.1em">' + d.toString(2).padStart(8,'0') + '</td>' +
        '</tr>';
    });
    html += '</table></div>';
  } else {
    html += '<div style="padding:8px 14px;color:var(--fg2);font-size:12px">No data bytes</div>';
  }

  // Decoded signals section (shown when a DBC is loaded and the message matched)
  if (m.signals && m.signals.length > 0) {
    html += '<div class="sig-section-head">Signals</div>';
    m.signals.forEach(s => {
      const valPart = s.valueLabel
        ? '<span class="sig-label">' + esc(s.valueLabel) + '</span>'
        : '<span class="sig-phys">'  + esc(s.physStr)    + '</span>';
      html +=
        '<div class="sig-item">' +
          '<div class="sig-name">' + esc(s.name) + '</div>' +
          '<div class="sig-vals">' +
            '<span class="sig-raw">' + esc(s.rawHex) + '</span>' +
            valPart +
          '</div>' +
          (s.comment ? '<div class="sig-comment">' + esc(s.comment) + '</div>' : '') +
        '</div>';
    });
  }

  detailBody.innerHTML = html;
}

function dr(k, v) {
  return '<div class="d-row"><span class="d-key">' + k + '</span><span class="d-val">' + v + '</span></div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

const fId   = document.getElementById('fId');
const fDir  = document.getElementById('fDir');
const fType = document.getElementById('fType');
const fCh   = document.getElementById('fCh');

function onFilterChange() {
  filter.id      = (fId?.value   ?? '').trim().toLowerCase();
  filter.dir     = fDir?.value   ?? '';
  filter.msgType = fType?.value  ?? '';
  filter.channel = fCh?.value    ?? '';
  resetAndRefetch();  // clears cache, resets scroll, fires requestPage
}

fId?.addEventListener('input',   onFilterChange);
fDir?.addEventListener('change', onFilterChange);
fType?.addEventListener('change',onFilterChange);
fCh?.addEventListener('change',  onFilterChange);

document.getElementById('btnClear').addEventListener('click', () => {
  if (fId)   fId.value   = '';
  if (fDir)  fDir.value  = '';
  if (fType) fType.value = '';
  if (fCh)   fCh.value   = '';
  onFilterChange();
});

document.getElementById('btnDetail').addEventListener('click', function() {
  detailPanel.classList.toggle('hidden');
  this.classList.toggle('active');
});

document.getElementById('btnImportDbc').addEventListener('click', () => {
  vscode.postMessage({ type: 'openDbcFile' });
});

document.getElementById('btnClearDbc').addEventListener('click', () => {
  vscode.postMessage({ type: 'clearDbc' });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL LISTENER
// ─────────────────────────────────────────────────────────────────────────────

scroller.addEventListener('scroll', () => requestAnimationFrame(renderViewport), { passive: true });

// ─────────────────────────────────────────────────────────────────────────────
// HOST MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('message', ({ data: msg }) => {

  // ── init ──────────────────────────────────────────────────────────────────
  if (msg.type === 'init') {
    const h   = msg.header;
    const dur = h ? h.stopTimestamp - h.startTimestamp : 0;

    setText('s-total', msg.totalCount.toLocaleString());
    setText('s-dur',   dur.toFixed(2) + 's');
    setText('s-rate',  dur > 0 ? Math.round(msg.totalCount / dur).toLocaleString() : '—');
    setText('s-ids',   (msg.uniqueIds ?? '—').toLocaleString());
    setText('s-ch',    (msg.channels ?? []).map(c => 'Ch' + c).join(', ') || '—');
    setText('s-fd',    (msg.fdCount ?? 0).toLocaleString());

    if (h) setText('topTime',
      new Date(h.startTimestamp * 1000).toISOString().replace('T',' ').slice(0,23) + ' UTC');

    document.getElementById('s-rxtx').innerHTML =
      '<span style="color:var(--green)">' + (msg.rxCount ?? 0).toLocaleString() + '</span>' +
      ' / <span style="color:var(--purple)">' + (msg.txCount ?? 0).toLocaleString() + '</span>';

    // Populate channel dropdown
    (msg.channels ?? []).forEach(c => {
      const o = document.createElement('option');
      o.value = String(c); o.textContent = 'Ch ' + c;
      fCh?.appendChild(o);
    });

    // Parse errors
    if (msg.errors?.length) {
      document.getElementById('errorsBar')?.classList.add('visible');
      setText('errSummary', '⚠ ' + msg.errors.length + ' parse warning' + (msg.errors.length > 1 ? 's' : ''));
      const el = document.getElementById('errList');
      if (el) el.innerHTML = msg.errors.map(esc).join('<br>');
    }

    totalFiltered = msg.totalCount;

    // Inject the empty-state element into the spacer once
    if (!document.getElementById('emptyState')) {
      const emp = document.createElement('div');
      emp.id = 'emptyState';
      emp.className = 'empty-state hidden';
      emp.innerHTML = '<span style="font-size:28px">🔍</span><span>No messages match the current filter.</span>';
      spacer.appendChild(emp);
    }

    buildHeader();
    updateSpacerHeight();
    overlay.style.display = 'none';

    // Kick off page 0
    pending.add(0);
    vscode.postMessage({
      type: 'requestPage', startIndex: 0, count: PAGE_SZ,
      filter: { ...filter }, sort: { ...sort },
    });
  }

  // ── page ──────────────────────────────────────────────────────────────────
  else if (msg.type === 'page') {
    pending.delete(msg.startIndex);
    pageCache.set(msg.startIndex, msg.rows);

    // Page 0 always carries the definitive post-filter total.
    // We update it here so the spacer, row count, and empty-state all
    // reflect the real answer even when resetAndRefetch set it to 0 first.
    if (msg.startIndex === 0) {
      totalFiltered = msg.totalFiltered;
      updateSpacerHeight();
      rCountEl.textContent = totalFiltered.toLocaleString() + ' rows';
    }

    renderViewport();
  }

  // ── error ─────────────────────────────────────────────────────────────────
  else if (msg.type === 'error') {
    overlay.innerHTML =
      '<div style="background:rgba(241,76,76,.1);border:1px solid rgba(241,76,76,.4);' +
      'border-radius:6px;padding:20px 24px;max-width:500px">' +
      '<div style="color:#f48771;font-weight:600;margin-bottom:8px">⚠ Parse error</div>' +
      '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + esc(msg.message) + '</pre>' +
      '</div>';
  }

  // ── dbcLoaded ─────────────────────────────────────────────────────────────
  else if (msg.type === 'dbcLoaded') {
    dbcLoaded   = true;
    dbcFileName = msg.fileName;

    const badge    = document.getElementById('dbcBadge');
    const clearBtn = document.getElementById('btnClearDbc');
    if (badge)    { badge.textContent = msg.fileName + '  (' + msg.messageCount + ' msg)'; badge.style.display = 'inline-flex'; }
    if (clearBtn) { clearBtn.style.display = 'inline-flex'; }

    // Show the Name column
    const nameCol = cols.find(c => c.key === 'name');
    if (nameCol) { nameCol.visible = true; }
    buildHeader();

    showToast('DBC loaded: ' + msg.fileName);

    // Invalidate page cache — cached rows pre-date the DBC and lack msgName/signals
    resetAndRefetch();
  }

  // ── dbcCleared ────────────────────────────────────────────────────────────
  else if (msg.type === 'dbcCleared') {
    dbcLoaded   = false;
    dbcFileName = '';

    const badge    = document.getElementById('dbcBadge');
    const clearBtn = document.getElementById('btnClearDbc');
    if (badge)    { badge.style.display = 'none'; }
    if (clearBtn) { clearBtn.style.display = 'none'; }

    // Hide the Name column
    const nameCol = cols.find(c => c.key === 'name');
    if (nameCol) { nameCol.visible = false; }
    buildHeader();

    resetAndRefetch();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
  if (typeof s !== 'string') return String(s ?? '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

})();
`;
