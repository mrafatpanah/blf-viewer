import * as vscode from 'vscode';
import * as path    from 'path';
import * as fs      from 'fs';

import { BLFReader }                        from './blf-parser';
import { applyFilter, applySort, findFirstMatchingIndex, findLastMatchingIndex, countMatches, toWire, reconstructUdsMessages, ViewCache } from './blf-host';
import { getWebviewHtml, getNonce }         from './blf-webview';
import { WebviewMessage, BlfViewerConfig }           from './blf-types';
import { parseDbcFile, DbcDatabase }        from './dbc-parser';
import { parseCddFile, CddDatabase }        from './cdd-parser';

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

    const fileName = path.basename(document.uri.fsPath);

    // Bundled by esbuild (see esbuild.js) and inlined into the HTML under the CSP nonce.
    const webviewJs = fs.readFileSync(
      path.join(this.context.extensionUri.fsPath, 'dist', 'webview.js'),
      'utf8'
    );

    // Paint the shell immediately — zero data, instant first paint
    webviewPanel.webview.html = getWebviewHtml(getNonce(), fileName, webviewJs);

    // Parse in the background; the extension host is the single owner of data
    let originalMessages: import('./blf-parser').CANMessage[] | null =
      await this.parseFile(document.uri.fsPath, webviewPanel);
    if (!originalMessages) { return; } // parse error already posted to webview

    // Per-panel DBC and CDD databases (in-memory, per-session)
    let dbcDb: DbcDatabase | null = null;
    let dbcChannel: number | null = null;
    let cddDb: CddDatabase | null = null;
    let processedMessages: import('./blf-parser').CANMessage[] | null = originalMessages;
    const viewCache = new ViewCache();

    const rebuildProcessedMessages = () => {
      viewCache.invalidate();
      if (!originalMessages) {
        processedMessages = null;
        return;
      }
      if (cddDb && cddDb.requestCanId !== null && cddDb.responseCanId !== null) {
        processedMessages = reconstructUdsMessages(
          originalMessages,
          cddDb.requestCanId,
          cddDb.responseCanId,
          cddDb
        );
      } else {
        processedMessages = originalMessages;
      }
    };

    // ── Auto-load DBC/CDD from .blfviewer.json ─────────────────────────────────
    const folderUri = vscode.Uri.file(path.dirname(document.uri.fsPath));
    try {
      const configPath  = path.join(folderUri.fsPath, '.blfviewer.json');
      const configRaw   = fs.readFileSync(configPath, 'utf8');
      const config: BlfViewerConfig = JSON.parse(configRaw);
      const autoDbcPaths = resolveGlobs(config.dbc ?? [], folderUri.fsPath);
      const autoCddPaths = resolveGlobs(config.cdd ?? [], folderUri.fsPath);

      const MAX_AUTOLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — same cap as manual import

      for (const dbcPath of autoDbcPaths) {
        try {
          if (fs.statSync(dbcPath).size > MAX_AUTOLOAD_BYTES) { continue; }
          const text  = fs.readFileSync(dbcPath, 'utf8');
          dbcDb       = parseDbcFile(text, path.basename(dbcPath));
          dbcChannel  = null;
          webviewPanel.webview.postMessage({
            type: 'dbcLoaded', fileName: dbcDb.fileName, messageCount: dbcDb.messages.size,
          });
        } catch { /* skip individual DBC failure */ }
      }

      for (const cddPath of autoCddPaths) {
        try {
          if (fs.statSync(cddPath).size > MAX_AUTOLOAD_BYTES) { continue; }
          const text = fs.readFileSync(cddPath, 'utf8');
          cddDb      = parseCddFile(text, path.basename(cddPath));
          rebuildProcessedMessages();
          const active = cddDb.requestCanId !== null && cddDb.responseCanId !== null;
          webviewPanel.webview.postMessage({
            type: 'cddLoaded', fileName: cddDb.fileName, serviceCount: cddDb.services.size, active,
          });
        } catch { /* skip individual CDD failure */ }
      }
    } catch { /* No .blfviewer.json — silently skip */ }

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (req: WebviewMessage) => {
      if (!processedMessages) { return; }

      if (req.type === 'requestPage') {
        const sorted   = viewCache.get(processedMessages, req.filter, req.sort);
        const page     = sorted.slice(req.startIndex, req.startIndex + req.count);

        webviewPanel.webview.postMessage({
          type:          'page',
          startIndex:    req.startIndex,
          totalFiltered: sorted.length,
          rows:          page.map((m, li) => toWire(m, req.startIndex + li, dbcDb, dbcChannel)),
        });
        return;
      }

      if (req.type === 'searchFirst') {
        const sorted    = viewCache.get(processedMessages, req.filter, req.sort);
        const fromIndex = req.fromIndex ?? 0;
        const direction = req.direction ?? 'forward';

        let index: number;
        if (direction === 'backward') {
          index = findLastMatchingIndex(sorted, req.search, fromIndex);
          if (index < 0) { index = findLastMatchingIndex(sorted, req.search, sorted.length); }
        } else {
          index = findFirstMatchingIndex(sorted, req.search, fromIndex);
          if (index < 0 && fromIndex > 0) { index = findFirstMatchingIndex(sorted, req.search, 0); }
        }

        const total = index >= 0 ? countMatches(sorted, req.search) : 0;

        webviewPanel.webview.postMessage({
          type:    'searchResult',
          index,
          row:     index >= 0 ? toWire(sorted[index], index, dbcDb, dbcChannel) : undefined,
          message: index >= 0 ? undefined : 'No matching message found',
          total,
        });
        return;
      }

      if (req.type === 'openDbcFile') {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'DBC Files': ['dbc'] },
          openLabel: 'Import DBC',
        });
        if (!picked?.length) { return; }
        try {
          const MAX_DBC_BYTES = 10 * 1024 * 1024; // 10 MB
          const stat = fs.statSync(picked[0].fsPath);
          if (stat.size > MAX_DBC_BYTES) {
            throw new Error(`DBC file is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB); limit is 10 MB`);
          }
          const text = fs.readFileSync(picked[0].fsPath, 'utf8');
          dbcDb = parseDbcFile(text, path.basename(picked[0].fsPath));
          dbcChannel = null;
          webviewPanel.webview.postMessage({
            type:         'dbcLoaded',
            fileName:     dbcDb.fileName,
            messageCount: dbcDb.messages.size,
          });
        } catch (err) {
          webviewPanel.webview.postMessage({
            type:    'error',
            message: 'DBC parse error: ' + (err instanceof Error ? err.message : String(err)),
          });
        }
        return;
      }

      if (req.type === 'setDbcChannel') {
        dbcChannel = req.channel;
        webviewPanel.webview.postMessage({ type: 'dbcChannelChanged', channel: dbcChannel });
        return;
      }

      if (req.type === 'clearDbc') {
        dbcDb = null;
        dbcChannel = null;
        webviewPanel.webview.postMessage({ type: 'dbcCleared' });
        return;
      }

      if (req.type === 'openCddFile') {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'CDD Files': ['cdd'] },
          openLabel: 'Import CDD',
        });
        if (!picked?.length) { return; }
        try {
          const MAX_CDD_BYTES = 10 * 1024 * 1024; // 10 MB
          const stat = fs.statSync(picked[0].fsPath);
          if (stat.size > MAX_CDD_BYTES) {
            throw new Error(`CDD file is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB); limit is 10 MB`);
          }
          const text = fs.readFileSync(picked[0].fsPath, 'utf8');
          cddDb = parseCddFile(text, path.basename(picked[0].fsPath));
          rebuildProcessedMessages();
          // "active" = CAN IDs were found, so TP/UDS reconstruction actually ran.
          const active = cddDb.requestCanId !== null && cddDb.responseCanId !== null;
          webviewPanel.webview.postMessage({
            type:         'cddLoaded',
            fileName:     cddDb.fileName,
            serviceCount: cddDb.services.size,
            active,
          });
        } catch (err) {
          webviewPanel.webview.postMessage({
            type:    'error',
            message: 'CDD parse error: ' + (err instanceof Error ? err.message : String(err)),
          });
        }
        return;
      }

      if (req.type === 'clearCdd') {
        cddDb = null;
        rebuildProcessedMessages();
        webviewPanel.webview.postMessage({ type: 'cddCleared' });
        return;
      }

      if (req.type === 'openInEditor') {
        const sorted   = viewCache.get(processedMessages, req.filter, req.sort);
        const rows: string[] = [];
        const cols     = ['#','Time','UTC','Arb ID','Type','Dir','Ch','DLC','Data','Flags'];
        rows.push(cols.join('\t'));
        for (const idx of req.indices) {
          const m = sorted[idx];
          if (!m) { continue; }
          const w = toWire(m, idx, dbcDb, dbcChannel);
          rows.push([w.i+1, w.t, w.utc, w.id, w.type, w.dir, w.ch, w.dlc, w.data, w.flags].join('\t'));
        }
        const doc = await vscode.workspace.openTextDocument({
          content: rows.join('\n'),
          language: 'plaintext',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
      }

      if (req.type === 'saveViewState') {
        await this.context.workspaceState.update(req.file + '.viewState', req.state);
        return;
      }
    });

    webviewPanel.onDidDispose(() => {
      viewCache.invalidate();
      originalMessages = null;
      processedMessages = null;
      dbcDb = null;
      dbcChannel = null;
      cddDb = null;
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async parseFile(
    filePath: string,
    panel: vscode.WebviewPanel
  ) {
    const controller = new AbortController();

    try {
      const reader   = new BLFReader(filePath);
      const messages = await vscode.window.withProgress({
        location:      vscode.ProgressLocation.Notification,
        title:         `Parsing ${path.basename(filePath)}…`,
        cancellable:   true,
      }, async (progress, token) => {
        // Forward VS Code's cancellation token to AbortController
        token.onCancellationRequested(() => controller.abort());
        let lastPct = 0;
        return await reader.parse(controller.signal, ratio => {
          const pct = Math.floor(ratio * 100);
          const inc = pct - lastPct;
          if (inc > 0) { progress.report({ increment: inc }); }
          lastPct = pct;
        });
      });
      const header   = reader.getHeader();
      const errors   = reader.getErrors();

      const channels  = [...new Set(messages.map(m => m.channel))].sort((a, b) => a - b);
      const rxCount   = messages.filter(m => m.isRx).length;
      const fdCount   = messages.filter(m => m.isFd).length;
      const uniqueIds = new Set(messages.map(m => m.arbitrationId)).size;

      panel.webview.postMessage({
        type:       'init',
        fileName:   path.basename(filePath),
        header,
        totalCount: messages.length,
        rxCount,
        txCount:    messages.length - rxCount,
        fdCount,
        errCount:   messages.filter(m => m.isErrorFrame).length,
        uniqueIds,
        channels,
        errors:     errors.slice(0, 50),
      });

      return messages;
    } catch (err) {
      // Don't show an error notification when the user explicitly cancels
      if (err instanceof Error && err.name === 'AbortError') { return null; }
      panel.webview.postMessage({
        type:    'error',
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

// ── .blfviewer.json glob resolver ────────────────────────────────────────────

/** Simple glob match: `*` matches any chars except `/`; `?` matches one non-`/`. */
function matchGlob(pattern: string, name: string): boolean {
  const reStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$';
  return new RegExp(reStr).test(name);
}

/**
 * Resolve glob patterns relative to `baseDir`, return absolute file paths.
 * Config is auto-applied with no user confirmation, so patterns are confined
 * to `baseDir` (no `..` escape) to avoid a committed `.blfviewer.json`
 * silently reading files outside the folder it lives in.
 */
function resolveGlobs(patterns: string[], baseDir: string): string[] {
  const results: string[] = [];
  const resolvedBase = path.resolve(baseDir) + path.sep;
  for (const pat of patterns) {
    const parts    = pat.split('/');
    const fileName = parts[parts.length - 1]!;
    const dirGlob  = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const scanDir  = path.resolve(baseDir, dirGlob);
    if (scanDir + path.sep !== resolvedBase && !scanDir.startsWith(resolvedBase)) {
      continue; // escapes baseDir — skip
    }
    try {
      const entries = fs.readdirSync(scanDir);
      for (const entry of entries) {
        const full = path.join(scanDir, entry);
        if (matchGlob(fileName, entry) && fs.statSync(full).isFile()) {
          results.push(full);
        }
      }
    } catch {
      // Skip directories that don't exist or can't be read
    }
  }
  return results;
}
