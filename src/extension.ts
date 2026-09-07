import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MuseChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vscode-muse-chat.chatView', provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-muse-chat.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.muse-chat');
      MusePanel.createOrShow(context.extensionUri);
    })
  );
}

export function deactivate() {}

class MusePanel {
  public static current?: MusePanel;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  constructor(private extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'vscode-muse-chat.panel', 'Muse Chat', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
    );
    this.panel.webview.html = getWebviewHtml(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'send') await handleSend(msg.text, this.panel.webview, getWorkspace());
    }, null, this.disposables);
    this.panel.onDidDispose(() => { MusePanel.current = undefined; this.dispose(); }, null, this.disposables);
  }
  static createOrShow(uri: vscode.Uri) {
    if (MusePanel.current) { MusePanel.current.panel.reveal(); return; }
    MusePanel.current = new MusePanel(uri);
  }
  dispose() { this.disposables.forEach(d => d.dispose()); }
}

class MuseChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private extensionUri: vscode.Uri) {}
  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    view.webview.html = getWebviewHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'send') await handleSend(msg.text, view.webview, getWorkspace());
    });
  }
}

function getWorkspace(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) return folders[0].uri.fsPath;
  return undefined;
}

function getMusePath(): string {
  const cfg = vscode.workspace.getConfiguration('vscode-muse-chat');
  const p = cfg.get<string>('muse.path');
  if (p && p.trim()) return p.trim();
  return 'muse';
}

async function handleSlash(prompt: string, webview: vscode.Webview, workspace?: string): Promise<boolean> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return false;
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const musePath = getMusePath();
  if (cmd === '/clear') {
    webview.postMessage({ type: 'clear' });
    return true;
  }
  if (cmd === '/help') {
    const help = `**Muse Chat — slash commands**\n\n- \`/resume\` — resume the most recent session (\`muse resume --last\`)\n- \`/resume <id>\` — resume a specific session\n- \`/help\` — this help\n- \`/clear\` — clear the chat log`;
    webview.postMessage({ type: 'chunk', text: help, done: false });
    webview.postMessage({ type: 'chunk', text: '', done: true });
    return true;
  }
  if (cmd === '/resume') {
    const target = parts[1];
    const args = target ? ['resume', target] : ['resume', '--last'];
    const resumeArgs = [...args, '--trust-workspace', '--disable-sandbox'];
    if (workspace) resumeArgs.push('--workspace', workspace);
    const proc = cp.spawn(musePath, resumeArgs, { cwd: workspace, env: { ...process.env } });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { const s = d.toString(); out += s; webview.postMessage({ type: 'chunk', text: s, done: false }); });
    proc.stderr?.on('data', (d: Buffer) => { const s = d.toString(); if (s.includes('Linux sandbox') || s.includes('Bubblewrap')) return; webview.postMessage({ type: 'chunk', text: s, done: false, isStderr: true }); });
    proc.on('error', (e: unknown) => webview.postMessage({ type: 'chunk', text: `resume spawn error: ${(e as Error).message}`, done: true, isError: true }));
    proc.on('close', (code) => {
      if (!out.trim()) webview.postMessage({ type: 'chunk', text: `(muse resume exited ${code} — no output; try terminal: \`muse resume --last\`)\n`, done: false });
      webview.postMessage({ type: 'chunk', text: '', done: true });
    });
    return true;
  }
  webview.postMessage({ type: 'chunk', text: `Unknown command \`${cmd}\`. Try \`/help\`.`, done: true, isError: true });
  return true;
}

async function handleSend(prompt: string, webview: vscode.Webview, workspace?: string) {
  if (!prompt.trim()) return;
  if (await handleSlash(prompt, webview, workspace)) return;
  const musePath = getMusePath();
  const args = ['exec', '--json', '--trust-workspace', '--disable-sandbox'];
  if (workspace) args.push('--workspace', workspace);

  let proc: cp.ChildProcess;
  try {
    proc = cp.spawn(musePath, [...args, prompt], { cwd: workspace, env: { ...process.env } });
  } catch (e: unknown) {
    webview.postMessage({ type: 'chunk', text: `Failed to spawn \`${musePath}\`: ${(e as Error)?.message ?? String(e)}`, done: true, isError: true });
    return;
  }

  let buf = '';
  let hasOutput = false;
  let reasoningStarted = false;

  function emitTool(name: string, argsText: string, status: 'running' | 'done' | 'error', result?: string) {
    webview.postMessage({ type: 'tool_call', name, args: argsText, status, result });
  }

  proc.stdout?.on('data', (d: Buffer) => {
    const s = d.toString();
    const lines = (buf + s).split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as Record<string, unknown>;
        const ptype = String((ev['payload_type'] as string) ?? (ev['type'] as string) ?? '').toLowerCase();
        const payload = (ev['payload'] as Record<string, unknown>) ?? ev;
        const isReasoning = ptype.includes('reasoning') || ptype.includes('thinking') || ptype.includes('thought') || Boolean(payload['reasoning'] ?? payload['thinking']);
        const isTool = ptype.includes('tool') || Boolean(payload['tool_name'] ?? payload['toolName']) || payload['name'] === 'tool' || Boolean(ev['tool_call'] ?? payload['tool_call']);

        if (isReasoning) {
          const t = String(payload['text'] ?? payload['delta'] ?? payload['reasoning'] ?? payload['thinking'] ?? payload['content'] ?? (ev['delta'] as string) ?? '');
          if (t) {
            hasOutput = true;
            if (!reasoningStarted) { webview.postMessage({ type: 'reasoning_start' }); reasoningStarted = true; }
            webview.postMessage({ type: 'reasoning_delta', text: t });
          }
          continue;
        }
        if (isTool) {
          hasOutput = true;
          const toolName = String(payload['tool_name'] ?? payload['toolName'] ?? payload['name'] ?? (ev['tool_name'] as string) ?? 'tool');
          const toolArgs = payload['args'] ?? payload['input'] ?? payload['arguments'] ?? '';
          const argsStr = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs ?? '').slice(0, 400);
          const result = payload['result'] ?? payload['output'] ?? '';
          const resultStr = typeof result === 'string' ? result : (result ? JSON.stringify(result).slice(0, 800) : undefined);
          const status: 'running' | 'done' = resultStr ? 'done' : 'running';
          emitTool(toolName, argsStr, status, resultStr);
          continue;
        }

        const t = String(payload['text'] ?? payload['delta'] ?? (ev['delta'] as string) ?? (ev['text'] as string) ?? payload['content'] ?? '');
        if (t) {
          if (ptype === 'run.output.delta' || ptype === 'run.terminal.completed' || !ptype || ptype.includes('delta') || ptype.includes('result') || ptype.includes('message')) {
            hasOutput = true;
            if (reasoningStarted) { webview.postMessage({ type: 'reasoning_end' }); reasoningStarted = false; }
            webview.postMessage({ type: 'chunk', text: t, done: false });
          }
        } else if (payload['result']) {
          const rt = typeof payload['result'] === 'string' ? String(payload['result']) : JSON.stringify(payload['result']);
          hasOutput = true;
          if (reasoningStarted) { webview.postMessage({ type: 'reasoning_end' }); reasoningStarted = false; }
          webview.postMessage({ type: 'chunk', text: rt, done: false });
        } else if (ev['type'] === 'result' && ev['result']) {
          const rt = typeof ev['result'] === 'string' ? String(ev['result']) : JSON.stringify(ev['result']);
          hasOutput = true;
          webview.postMessage({ type: 'chunk', text: rt, done: false });
        }
      } catch {
        hasOutput = true;
        if (reasoningStarted) { webview.postMessage({ type: 'reasoning_end' }); reasoningStarted = false; }
        webview.postMessage({ type: 'chunk', text: line + '\n', done: false });
      }
    }
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (s.includes('Linux sandbox') || s.includes('Bubblewrap') || s.includes('workspace is untrusted')) return;
    webview.postMessage({ type: 'chunk', text: s, done: false, isStderr: true });
  });

  proc.on('error', (err) => {
    webview.postMessage({ type: 'chunk', text: `spawn error: ${err.message}`, done: true, isError: true });
  });

  proc.on('close', (code) => {
    if (buf.trim()) {
      try {
        const ev = JSON.parse(buf) as Record<string, unknown>;
        const t = String((ev['delta'] as string) ?? (ev['text'] as string) ?? '');
        if (t) webview.postMessage({ type: 'chunk', text: t, done: false });
      } catch { webview.postMessage({ type: 'chunk', text: buf, done: false }); }
    }
    if (reasoningStarted) webview.postMessage({ type: 'reasoning_end' });
    if (!hasOutput) {
      const p2 = cp.spawn(musePath, ['exec', '--trust-workspace', '--disable-sandbox', ...(workspace ? ['--workspace', workspace] : []), prompt], { cwd: workspace });
      let out = '';
      p2.stdout?.on('data', (d: Buffer) => { out += d.toString(); webview.postMessage({ type: 'chunk', text: d.toString(), done: false }); });
      p2.stderr?.on('data', (d: Buffer) => webview.postMessage({ type: 'chunk', text: d.toString(), done: false, isStderr: true }));
      p2.on('close', (c2) => {
        if (!out.trim()) webview.postMessage({ type: 'chunk', text: `(muse exited ${c2}, no output)`, done: true, isError: true });
        else webview.postMessage({ type: 'chunk', text: '', done: true });
      });
      p2.on('error', (e2: Error) => webview.postMessage({ type: 'chunk', text: `retry failed: ${e2.message}`, done: true, isError: true }));
      return;
    } else {
      webview.postMessage({ type: 'chunk', text: '', done: true });
    }
  });
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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

  // Vite outputs <link href="./assets/index-XXX.css"> and <script src="./assets/index-XXX.js">
  // Replace every ./assets/<file> with the webview URI
  html = html.replace(/\.\/assets\/([^\"]+)/g, (_m, file: string) => {
    const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'assets', file));
    return assetUri.toString();
  });
  // Handle root-absolute /assets/ if vite ever emits it
  html = html.replace(/\"\/assets\//g, `"${webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'assets')).toString()}/`);

  // Inject CSP
  const csp = `default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} https: data:; connect-src https:;`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
  } else {
    html = `<meta http-equiv="Content-Security-Policy" content="${csp}">` + html;
  }

  return html;
}
