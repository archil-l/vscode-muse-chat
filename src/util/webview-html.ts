import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const indexPath = path.join(extensionUri.fsPath, 'media', 'index.html');

  if (!fs.existsSync(indexPath)) {
    return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
      <h3>Build required</h3>
      <p>Webview not built. Run <code>npm run build:webview</code> then <code>npm run compile</code>.</p>
      <p>Missing: ${indexPath}</p>
    </body></html>`;
  }

  let html = fs.readFileSync(indexPath, 'utf8');
  const bust = Date.now().toString(36);
  html = html.replace(/\.\/assets\/([^\"]+)/g, (_m, file: string) => {
    const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'assets', file));
    return assetUri.toString() + `?v=${bust}`;
  });
  html = html.replace(/\"\/assets\//g, `"${webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'assets')).toString()}/?v=${bust}/`);

  const csp = `default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} https: data:; connect-src https:;`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
  } else {
    html = `<meta http-equiv="Content-Security-Policy" content="${csp}">` + html;
  }

  return html;
}
