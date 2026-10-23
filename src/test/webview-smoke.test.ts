import * as assert from 'assert';
import * as path    from 'path';
import * as vscode  from 'vscode';

// Smoke test for plan 009 (webview runtime extracted to src/webview/main.js,
// bundled to dist/webview.js, read via fs.readFileSync in resolveCustomEditor).
// Opens a real fixture through the custom editor and checks the panel
// resolves with HTML that actually embeds the bundled runtime — if
// dist/webview.js were missing, unreadable, or getWebviewHtml's new
// 3-arg signature were wired wrong, this activation path would throw.
suite('Webview activation smoke test (plan 009)', () => {
  test('opens a .blf fixture through the custom editor without error', async () => {
    const fixtureUri = vscode.Uri.file(
      path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'two-channel.blf')
    );

    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'blf.viewer');

    // Poll for the tab rather than a fixed sleep — resolveCustomEditor's
    // async parse + postMessage chain can take longer under CI load.
    const findTab = () => vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .find(t => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'blf.viewer');

    let tab = findTab();
    const deadline = Date.now() + 5000;
    while (!tab && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      tab = findTab();
    }

    assert.ok(tab, 'expected a blf.viewer tab to be open');

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
