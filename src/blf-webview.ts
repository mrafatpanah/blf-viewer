// ── Webview HTML/JS generator ─────────────────────────────────────────────────
// Returns the complete shell HTML injected into the WebviewPanel.
// The embedded <script> is the full webview runtime — no external deps.

export function getWebviewHtml(nonce: string, fileName: string, webviewJs: string): string {
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
    <span class="topbar-icon"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="topbar-svg"><path d="M8 1c-2 0-3.7.8-4.9 2.1l.7.7C4.7 2.6 6.2 2 8 2s3.3.6 4.2 1.8l.7-.7A6.7 6.7 0 0 0 8 1zM6.5 10a3.5 3.5 0 0 1 3 0l.5-1c-1.2-.7-2.8-.7-4 0l.5 1zM8 6c-.9 0-1.7.3-2.3.9l.7.7c.4-.4 1-.6 1.6-.6s1.2.2 1.6.6l.7-.7C9.7 6.3 8.9 6 8 6z"/></svg></span>
    <span class="topbar-title">${safeFileName}</span>
    <span class="topbar-time" id="topTime">Parsing…</span>
    <span class="topbar-space"></span>
    <button class="btn" id="btnCols" title="Show/hide columns">⊞ Columns</button>
    <button class="btn active" id="btnDetail" aria-pressed="true">⊟ Detail</button>
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
    <span class="panel-label">Filter</span>
    <div class="search-wrap" id="filterIdWrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-id" id="fId" placeholder="Filter by ID… (e.g. 1A3, 2B5@0)" autocomplete="off" spellcheck="false" aria-label="Filter by CAN ID">
      <div class="filter-resize" id="filterResize" title="Resize ID filter"></div>
    </div>
    <div class="search-wrap data-search-wrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-data" id="fData" placeholder="Data bytes…" autocomplete="off" spellcheck="false" aria-label="Filter by data bytes">
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
      <option value="DIAG">Diag (UDS+TP)</option>
      <option value="UDS">UDS</option>
      <option value="TP">TP frames</option>
    </select>
    <select id="fCh"><option value="">All Ch</option></select>
    <span class="toolbar-space"></span>
    <span class="sel-count" id="selCount" style="display:none" aria-live="polite"></span>
    <span class="result-count" id="rCount" aria-live="polite">—</span>
    <button class="btn" id="btnClear"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:2px"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg> Clear</button>
    <span style="width:1px;height:18px;background:var(--border);flex-shrink:0"></span>
    <button class="btn" id="btnImportDbc" title="Import DBC file">⊕ DBC</button>
    <span class="dbc-badge" id="dbcBadge" style="display:none"></span>
    <select id="dbcChannel" style="display:none" title="Apply DBC to channel">
      <option value="">All Ch</option>
    </select>
    <button class="btn" id="btnClearDbc" style="display:none" title="Remove DBC"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:middle"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg></button>
    <span style="width:1px;height:18px;background:var(--border);flex-shrink:0"></span>
    <button class="btn" id="btnImportCdd" title="Import CDD file">⊕ CDD</button>
    <span class="cdd-badge" id="cddBadge" style="display:none"></span>
    <button class="btn" id="btnClearCdd" style="display:none" title="Remove CDD"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:middle"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg></button>
  </div>

  <!-- Search toolbar -->
  <div class="toolbar search-toolbar">
    <span class="panel-label">Search</span>
    <div class="search-wrap" id="searchIdWrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-id" id="sId" placeholder="Search ID…" autocomplete="off" spellcheck="false" aria-label="Search within results">
      <div class="filter-resize" id="searchResize" title="Resize search ID field"></div>
    </div>
    <div class="search-wrap data-search-wrap">
      <span class="search-icon">⌕</span>
      <input type="text" class="filter-data" id="sData" placeholder="Search data bytes…" autocomplete="off" spellcheck="false">
    </div>
    <select id="sDir">
      <option value="">Any Dir</option>
      <option value="RX">RX</option>
      <option value="TX">TX</option>
    </select>
    <select id="sType">
      <option value="">Any Type</option>
      <option value="STD">STD</option>
      <option value="FD">CAN FD</option>
      <option value="ERR">Error</option>
      <option value="DIAG">Diag (UDS+TP)</option>
      <option value="UDS">UDS</option>
      <option value="TP">TP frames</option>
    </select>
    <select id="sCh"><option value="">Any Ch</option></select>
    <button class="btn data-search-btn" id="btnSearchPrev" title="Previous match"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle"><path d="M10.5 3l-7 5 7 5V3z"/></svg></button>
    <button class="btn data-search-btn" id="btnSearchNext" title="Next match"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle"><path d="M5.5 3l7 5-7 5V3z"/></svg></button>
    <span class="search-match-count" id="searchMatchCount"></span>
    <button class="btn" id="btnClearSearch"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:middle"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg></button>
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
<div class="ctx-menu"    id="ctxMenu"    role="menu" tabindex="-1" style="display:none"></div>
<div class="ctx-submenu" id="ctxSubmenu" role="menu" tabindex="-1" style="display:none"></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script nonce="${nonce}">${webviewJs}</script>
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
  .search-toolbar { background: var(--bg); }
  .panel-label {
    width: 48px; flex-shrink: 0; color: var(--fg2); font-size: 10px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase;
  }
  .search-wrap { position: relative; display: flex; align-items: center;
    width: clamp(380px, 42vw, 760px); min-width: 260px; max-width: min(80vw, 960px);
    overflow: visible; }
  .search-icon { position: absolute; left: 8px; color: var(--fg2); font-size: 12px;
    pointer-events: none; user-select: none; }
  input[type="text"], select {
    background: var(--vscode-input-background); color: var(--fg);
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 4px; height: 30px; font-family: var(--mono); font-size: 12.5px; outline: none;
  }
  input[type="text"]:focus, select:focus { border-color: var(--accent); }
  .filter-id { padding: 0 28px 0 26px; width: 100%; min-width: 0; box-sizing: border-box; }
  .filter-resize { position: absolute; right: 0; top: 5px; bottom: 5px; width: 10px;
    cursor: col-resize; border-right: 2px solid transparent; z-index: 1;
    transition: border-color .12s, background .12s; }
  .search-wrap:hover .filter-resize, .filter-resize.active { border-right-color: var(--accent); }
  .filter-resize:hover, .filter-resize.active { background: rgba(14,99,156,.12); }
  .data-search-wrap { gap: 4px; width: auto !important; min-width: 0; flex-shrink: 0; }
  .filter-data { padding: 0 8px 0 26px; width: 150px; }
  .data-search-btn { height: 26px; padding: 0 8px; font-size: 11px; }
  #searchIdWrap { width: clamp(160px, 18vw, 320px); }
  .search-match-count { font-family: var(--mono); font-size: 11px; color: var(--fg2);
    white-space: nowrap; min-width: 42px; text-align: center; }
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
  .th-resize:hover, .th-resize.active, .th-resize:focus { background: var(--accent); outline: none; }

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
  .row-search-hit { box-shadow: inset 3px 0 0 var(--yellow); }

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
  .ctx-item:hover,
  .ctx-item:focus       { background: var(--hover); color: var(--accent); outline: none; }
  .ctx-item.danger:hover,
  .ctx-item.danger:focus{ background: rgba(241,76,76,.1); color: var(--red); }
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
  .color-swatch:hover,
  .color-swatch:focus { transform: scale(1.2); border-color: var(--fg); outline: none; }

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

  /* CDD badge in toolbar */
  .cdd-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 10px; font-size: 11px;
    background: rgba(204,167,0,.15); color: var(--yellow);
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

