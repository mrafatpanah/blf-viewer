import * as vscode from 'vscode';
import { BLFViewProvider } from './blfViewProvider';

export function activate(context: vscode.ExtensionContext) {
  // Register the BLF custom editor provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      BLFViewProvider.viewType,
      new BLFViewProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // Register an explicit "Open with BLF Viewer" command
  context.subscriptions.push(
    vscode.commands.registerCommand('blf.openFile', async (uri?: vscode.Uri) => {
      if (!uri) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'BLF Files': ['blf'] },
          openLabel: 'Open BLF File',
        });
        if (!picked || picked.length === 0) return;
        uri = picked[0];
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        BLFViewProvider.viewType
      );
    })
  );

  console.log('BLF Viewer extension activated');
}

export function deactivate() {}