import * as vscode from 'vscode';
import * as path    from 'path';
import * as fs      from 'fs';

import { BLFReader }                        from './blf-parser';
import { applyFilter, applySort, findFirstMatchingIndex, findLastMatchingIndex, countMatches, toWire, reconstructUdsMessages } from './blf-host';
import { getWebviewHtml, getNonce }         from './blf-webview';
import { WebviewMessage }                   from './blf-types';
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

    // Paint the shell immediately — zero data, instant first paint
    webviewPanel.webview.html = getWebviewHtml(getNonce(), fileName);

    // Parse in the background; the extension host is the single owner of data
    let messages = await this.parseFile(document.uri.fsPath, webviewPanel);
    if (!messages) { return; } // parse error already posted to webview

    // Per-panel DBC and CDD databases (in-memory, per-session)
    let dbcDb: DbcDatabase | null = null;
    let cddDb: CddDatabase | null = null;
    let originalMessages: import('./blf-parser').CANMessage[] | null = messages;
    let processedMessages: import('./blf-parser').CANMessage[] | null = messages;

    const rebuildProcessedMessages = () => {
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

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (req: WebviewMessage) => {
      if (!processedMessages) { return; }

      if (req.type === 'requestPage') {
        const filtered = applyFilter(processedMessages, req.filter);
        const sorted   = applySort(filtered,    req.sort);
        const page     = sorted.slice(req.startIndex, req.startIndex + req.count);

        webviewPanel.webview.postMessage({
          type:          'page',
          startIndex:    req.startIndex,
          totalFiltered: sorted.length,
          rows:          page.map((m, li) => toWire(m, req.startIndex + li, dbcDb)),
        });
        return;
      }

      if (req.type === 'searchFirst') {
        const filtered  = applyFilter(processedMessages, req.filter);
        const sorted    = applySort(filtered, req.sort);
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
          row:     index >= 0 ? toWire(sorted[index], index, dbcDb) : undefined,
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

      if (req.type === 'clearDbc') {
        dbcDb = null;
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
          webviewPanel.webview.postMessage({
            type:         'cddLoaded',
            fileName:     cddDb.fileName,
            serviceCount: cddDb.services.size,
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
    });

    webviewPanel.onDidDispose(() => {
      messages = null;
      originalMessages = null;
      processedMessages = null;
      dbcDb = null;
      cddDb = null;
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async parseFile(
    filePath: string,
    panel: vscode.WebviewPanel
  ) {
    try {
      const reader   = new BLFReader(filePath);
      const messages = await reader.parse();
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
      panel.webview.postMessage({
        type:    'error',
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
