import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MuseChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vscode-muse-chat.chatView', provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-muse-chat.openChat', async () => {
      // Focus the view, or open a panel as fallback
      await vscode.commands.executeCommand('workbench.view.extension.muse-chat');
      // Also open a standalone panel for larger chat
      MusePanel.createOrShow(context.extensionUri);
    })
  );
}

export function deactivate() {}

/** Standalone panel (larger) — used by command */
class MusePanel {
  public static current?: MusePanel;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  constructor(private extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'vscode-muse-chat.panel', 'Muse Chat (LaTeX)', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.webview.html = getHtml(this.panel.webview, extensionUri);
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
    view.webview.options = { enableScripts: true };
    view.webview.html = getHtml(view.webview, this.extensionUri);
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

async function handleSend(prompt: string, webview: vscode.Webview, workspace?: string) {
  if (!prompt.trim()) return;
  const musePath = getMusePath();
  // Correct order: `muse exec [OPTIONS] [PROMPT]` — exec first, then its flags
  const args = ['exec', '--json', '--trust-workspace'];
  if (workspace) args.push('--workspace', workspace);
  // stream JSONL events; fallback to plain if --json not desired
  // For MVP we also run a plain exec to get final text if JSONL parsing fails
  const useJson = true;
  const finalArgs = useJson ? args : ['exec', ...(workspace ? ['--workspace', workspace] : [])];

  let proc: cp.ChildProcess;
  try {
    proc = cp.spawn(musePath, [...finalArgs, prompt], {
      cwd: workspace,
      env: { ...process.env },
    });
  } catch (e: any) {
    webview.postMessage({ type: 'chunk', text: `Failed to spawn \`${musePath}\`: ${e?.message ?? e}` , done: true, isError: true });
    return;
  }

  let buf = '';
  let hasOutput = false;

  proc.stdout?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (useJson) {
      // JSONL: each line is an event; extract text deltas if present, else forward raw
      const lines = (buf + s).split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          // Try common fields; fall back to raw line
          const t = ev?.delta ?? ev?.text ?? ev?.content ?? ev?.message?.content ?? '';
          if (typeof t === 'string' && t) {
            hasOutput = true;
            webview.postMessage({ type: 'chunk', text: t, done: false });
          } else if (ev?.type === 'result' && ev?.result) {
            const rt = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
            hasOutput = true;
            webview.postMessage({ type: 'chunk', text: rt, done: false });
          }
        } catch {
          // not JSON — forward as-is
          hasOutput = true;
          webview.postMessage({ type: 'chunk', text: line + '\n', done: false });
        }
      }
    } else {
      hasOutput = true;
      webview.postMessage({ type: 'chunk', text: s, done: false });
    }
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    // Filter noisy sandbox warnings — surface only real errors
    if (s.includes('Linux sandbox') || s.includes('Bubblewrap') || s.includes('workspace is untrusted')) return;
    webview.postMessage({ type: 'chunk', text: s, done: false, isStderr: true });
  });

  proc.on('error', (err) => {
    webview.postMessage({ type: 'chunk', text: `spawn error: ${err.message}`, done: true, isError: true });
  });

  proc.on('close', (code) => {
    // flush remaining buf as JSONL tail
    if (useJson && buf.trim()) {
      try {
        const ev = JSON.parse(buf);
        const t = ev?.delta ?? ev?.text ?? '';
        if (t) webview.postMessage({ type: 'chunk', text: t, done: false });
      } catch { webview.postMessage({ type: 'chunk', text: buf, done: false }); }
    }
    if (!hasOutput) {
      // Fallback: try plain exec without --json (some builds don't support --json streaming)
      if (useJson) {
        const p2 = cp.spawn(musePath, ['exec', '--trust-workspace', ...(workspace ? ['--workspace', workspace] : []), prompt], { cwd: workspace });
        let out = '';
        p2.stdout?.on('data', (d: Buffer) => { out += d.toString(); webview.postMessage({ type: 'chunk', text: d.toString(), done: false }); });
        p2.stderr?.on('data', (d: Buffer) => webview.postMessage({ type: 'chunk', text: d.toString(), done: false, isStderr: true }));
        p2.on('close', (c2) => {
          if (!out.trim()) webview.postMessage({ type: 'chunk', text: `(muse exited ${c2}, no output)`, done: true, isError: true });
          else webview.postMessage({ type: 'chunk', text: '', done: true });
        });
        p2.on('error', (e2: any) => webview.postMessage({ type: 'chunk', text: `retry failed: ${e2.message}`, done: true, isError: true }));
        return;
      }
      webview.postMessage({ type: 'chunk', text: `(muse exited ${code}, no output)`, done: true, isError: true });
    } else {
      webview.postMessage({ type: 'chunk', text: '', done: true });
    }
    if (code !== 0 && code !== null && !hasOutput) {
      webview.postMessage({ type: 'chunk', text: `muse exited ${code}`, done: true, isError: true });
    }
  });
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Date.now());
  // Use CDNs for marked + katex (no bundle needed for MVP)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net https://cdn.jsdelivr.net https://unpkg.com; style-src ${webview.cspSource} https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline'; font-src https://cdn.jsdelivr.net https://unpkg.com ${webview.cspSource}; img-src ${webview.cspSource} https: data:; connect-src https:;">
<title>Muse Chat</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:0;display:flex;flex-direction:column;height:100vh}
  #log{flex:1;overflow:auto;padding:12px 14px}
  .msg{margin:10px 0;padding:10px 12px;border-radius:8px;line-height:1.5;word-wrap:break-word}
  .user{background:var(--vscode-inputValidation-infoBorder);border:1px solid var(--vscode-widget-border);opacity:0.95}
  .assistant{background:var(--vscode-editor-inactiveSelectionBackground);border:1px solid var(--vscode-widget-border)}
  .stderr{opacity:0.7;font-family:var(--vscode-editor-font-family);font-size:0.9em;white-space:pre-wrap}
  .error{color:var(--vscode-errorForeground);border-color:var(--vscode-inputValidation-errorBorder)}
  #composer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--vscode-widget-border);background:var(--vscode-sideBar-background)}
  #input{flex:1;min-height:44px;max-height:120px;resize:vertical;padding:8px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:6px;font-family:inherit}
  #send{padding:8px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;cursor:pointer}
  #send:disabled{opacity:0.5}
  pre{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:6px;overflow:auto}
  code{font-family:var(--vscode-editor-font-family)}
  a{color:var(--vscode-textLink-foreground)}
</style>
</head>
<body>
<div id="log"></div>
<div id="composer">
  <textarea id="input" placeholder="Ask Muse… (Shift+Enter for newline, Enter to send). Try: $$E[\\theta]=E[T](2P-1)$$"></textarea>
  <button id="send">Send</button>
</div>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const log = document.getElementById('log');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
let pendingAssistant = null;
let pendingText = '';

function appendMsg(role, text, opts={}){
  const div = document.createElement('div');
  div.className = 'msg ' + role + (opts.isError ? ' error' : '') + (opts.isStderr ? ' stderr' : '');
  log.appendChild(div);
  return div;
}
function renderMarkdown(el, md){
  try{
    const html = marked.parse(md || '');
    el.innerHTML = html;
    if (window.renderMathInElement) {
      renderMathInElement(el, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false},
          {left: '\\\\[', right: '\\\\]', display: true},
          {left: '\\\\(', right: '\\\\)', display: false}
        ],
        throwOnError: false
      });
    }
  }catch(e){ el.textContent = md; }
  log.scrollTop = log.scrollHeight;
}

function startAssistant(){
  pendingAssistant = appendMsg('assistant','');
  pendingText = '';
}

window.addEventListener('message', e=>{
  const m = e.data;
  if (m.type === 'chunk'){
    if (!pendingAssistant) startAssistant();
    if (m.isStderr){
      const s = appendMsg('assistant', m.text, {isStderr:true});
      s.textContent = m.text;
    } else {
      pendingText += m.text;
      renderMarkdown(pendingAssistant, pendingText);
    }
    if (m.done){
      pendingAssistant = null;
      pendingText = '';
      sendBtn.disabled = false;
      input.focus();
    }
  }
});

function send(){
  const text = input.value.trim();
  if (!text) return;
  const u = appendMsg('user','');
  renderMarkdown(u, text);
  vscode.postMessage({type:'send', text});
  input.value = '';
  sendBtn.disabled = true;
  startAssistant();
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', e=>{
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
input.focus();
</script>
</body>
</html>`;
}
