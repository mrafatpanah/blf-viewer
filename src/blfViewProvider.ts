import * as vscode from 'vscode';
import * as path    from 'path';

import { BLFReader }                        from './blf-parser';
import { applyFilter, applySort, toWire }   from './blf-host';
import { getWebviewHtml, getNonce }         from './blf-webview';
import { WebviewMessage }                   from './blf-types';

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
    if (!messages) return; // parse error already posted to webview

    // Handle page requests: filter → sort → slice → send
    webviewPanel.webview.onDidReceiveMessage((req: WebviewMessage) => {
      if (req.type !== 'requestPage') return;

      const filtered = applyFilter(messages!, req.filter);
      const sorted   = applySort(filtered,    req.sort);
      const page     = sorted.slice(req.startIndex, req.startIndex + req.count);

      webviewPanel.webview.postMessage({
        type:          'page',
        startIndex:    req.startIndex,
        totalFiltered: sorted.length,
        rows:          page.map((m, li) => toWire(m, req.startIndex + li)),
      });
    });

    webviewPanel.onDidDispose(() => { messages = null; });
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
