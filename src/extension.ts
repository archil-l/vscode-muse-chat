import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
function uuidv7(): string {
  const ts = Date.now();
  const tHex = ts.toString(16).padStart(12, '0');
  const rand = crypto.randomBytes(10).toString('hex');
  let hex = (tHex + rand).slice(0, 32);
  const arr = hex.split('');
  arr[12] = '7';
  const v = parseInt(arr[16], 16);
  arr[16] = ((v & 0x3) | 0x8).toString(16);
  return `${arr.slice(0,8).join('')}-${arr.slice(8,12).join('')}-${arr.slice(12,16).join('')}-${arr.slice(16,20).join('')}-${arr.slice(20,32).join('')}`;
}

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

export function deactivate() {
  mspManager.dispose();
}

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
    this.bindWebview(this.panel.webview);
    this.panel.onDidDispose(() => { MusePanel.current = undefined; this.dispose(); }, null, this.disposables);
  }
  static createOrShow(uri: vscode.Uri) {
    if (MusePanel.current) { MusePanel.current.panel.reveal(); return; }
    MusePanel.current = new MusePanel(uri);
  }
  private bindWebview(webview: vscode.Webview) {
    pushStatus(webview, getWorkspace());
    webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'send') await handleSend(msg.text, webview, getWorkspace());
      else if (msg.type === 'user_input_answer') await mspManager.handleUserInputAnswer(msg, webview);
      else if (msg.type === 'approval_decide') await mspManager.handleApprovalDecide(msg, webview);
      else if (msg.type === 'session_pick') await handleSessionPick(msg.sessionId, webview);
      else if (msg.type === 'model_pick') await handleModelPick(msg.modelId, webview);
      else if (msg.type === 'session_list_request') await handleSlash('/resume', webview, getWorkspace());
      else if (msg.type === 'get_status' || msg.type === 'request_status') await pushStatus(webview, getWorkspace());
    }, null, this.disposables);
    webview.onDidReceiveMessage(async ()=> { /* status pushes on session events below */ }, null, this.disposables);
  }
  dispose() { this.disposables.forEach(d => d.dispose()); }
}

class MuseChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private extensionUri: vscode.Uri) {}
  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    view.webview.html = getWebviewHtml(view.webview, this.extensionUri);
    pushStatus(view.webview, getWorkspace());
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'send') await handleSend(msg.text, view.webview, getWorkspace());
      else if (msg.type === 'user_input_answer') await mspManager.handleUserInputAnswer(msg, view.webview);
      else if (msg.type === 'approval_decide') await mspManager.handleApprovalDecide(msg, view.webview);
      else if (msg.type === 'session_pick') await handleSessionPick(msg.sessionId, view.webview);
      else if (msg.type === 'model_pick') await handleModelPick(msg.modelId, view.webview);
      else if (msg.type === 'session_list_request') await handleSlash('/resume', view.webview, getWorkspace());
      else if (msg.type === 'get_status' || msg.type === 'request_status') await pushStatus(view.webview, getWorkspace());
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

function getSettingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg.trim() : path.join(process.env.HOME ?? '', '.config');
  return path.join(base, 'muse', 'settings.json');
}

function readSettings(): { model?: string; reasoning_effort?: string } {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    return { model: j.model, reasoning_effort: j.reasoning_effort };
  } catch { return {}; }
}

function mapApprovalMode(m: string): string {
  const map: Record<string,string> = { allowAll: 'never', promptUnmatched: 'untrusted', onRequest: 'on-request', denyUnmatched: 'deny' };
  return map[m] ?? m;
}

async function buildStatus(workspace?: string): Promise<Record<string, any>> {
  const settings = readSettings();
  const workdir = workspace ?? getWorkspace() ?? process.cwd();
  const workdirLabel = workdir ? path.basename(workdir) || workdir : '—';
  // defaults from muse: model muse-spark-1.2-contributor, effort high
  let model: string | null = settings.model ?? 'muse-spark-1.2-contributor';
  let effort: string | null = settings.reasoning_effort ?? 'high';
  let approvalMode: string | null = null;
  let sandbox: string = 'off';
  let trust: string = 'trusted';

  // try live session via MSP
  try {
    const mgr: any = mspManager as any;
    const key = workspace ?? getWorkspace() ?? '__global__';
    const sessEntry = mgr.sessions?.get(key);
    if (sessEntry?.sessionId) {
      try {
        const res = await sessEntry.host.request('session/read', { sessionId: sessEntry.sessionId } as any);
        const sess = res?.session ?? res;
        if (sess?.modelId) model = sess.modelId;
        if (sess?.workspaceRoot) {
          // prefer live workspaceRoot
        }
        if (sess?.approvalMode?.mode) approvalMode = mapApprovalMode(String(sess.approvalMode.mode));
        // effort: check model/effort from session? not in session, peek last turn if available
      } catch {}
    } else {
      // probe session/list for most recent if no active
      try {
        const host = mspManager.getHost(workspace);
        await host.ensureStarted();
        const list = await host.request('session/list', { workspaceRoot: workspace, limit: 1 } as any).catch(()=>null);
        const s = list?.sessions?.[0];
        if (s?.modelId && !sessEntry) model = s.modelId;
        if (s?.approvalMode?.mode) approvalMode = mapApprovalMode(String(s.approvalMode.mode));
      } catch {}
    }
  } catch {}

  if (!approvalMode) approvalMode = 'on-request';
  // derive sandbox/trust from host spawn args (MspHost uses --trust-workspace --disable-sandbox)
  // surface as permissions mode like muse TUI: yolo/trusted/sandbox
  const permissionsLabel = `${trust} • sandbox ${sandbox} • ${approvalMode}`;

  return {
    model,
    effort,
    workdir,
    workdirLabel,
    approvalMode,
    sandbox,
    trust,
    permissions: permissionsLabel,
    settingsPath: getSettingsPath(),
  };
}

async function pushStatus(webview: vscode.Webview, workspace?: string) {
  const s = await buildStatus(workspace);
  webview.postMessage({ type: 'muse_status', status: s });
}

// ---- MSP Host (serve over stdio JSON-RPC) ----
type JsonRpcId = number | string;
class MspHost {
  private proc?: cp.ChildProcess;
  private rl?: readline.Interface;
  private nextId = 1;
  private pending = new Map<JsonRpcId, { resolve: (v:any)=>void; reject:(e:any)=>void }>();
  private initialized = false;
  private notifHandler?: (method:string, params:any)=>void;
  private workspace?: string;

  constructor(private musePath: string, workspace?: string) {
    this.workspace = workspace;
  }

  onNotification(handler:(method:string, params:any)=>void){ this.notifHandler = handler; }

  async ensureStarted(): Promise<void> {
    if (this.proc && !this.proc.killed) return;
    const args = ['serve', '--trust-workspace', '--disable-sandbox'];
    // serve has fixed workspace via --trust-workspace, but per-session workspace is in session/start
    this.proc = cp.spawn(this.musePath, args, { stdio: ['pipe','pipe','pipe'], env: {...process.env} });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line)=> this.handleLine(line));
    this.proc.stderr?.on('data', (d)=> {
      const s=d.toString();
      if(s.includes('muse: workspace')) return;
      // surface errors silently for now
    });
    this.proc.on('exit', ()=> { this.initialized=false; this.proc=undefined; });
    // initialize handshake
    await this.request('initialize', {
      clientInfo: { name: 'vscode-muse-chat', version: '0.1.0' },
      capabilities: {},
    });
    // send initialized notification
    this.notify('initialized', {});
    this.initialized = true;
  }

  private handleLine(line:string){
    if(!line.trim()) return;
    try{
      const msg = JSON.parse(line);
      if(msg.id !== undefined){
        // response
        const pend = this.pending.get(msg.id);
        if(pend){
          this.pending.delete(msg.id);
          if(msg.error) pend.reject(msg.error);
          else pend.resolve(msg.result);
        }
      } else if(msg.method){
        // notification or request from server
        if(this.notifHandler) this.notifHandler(msg.method, msg.params);
        // if server sent request (e.g. for something), auto-respond ack
        if(msg.id !== undefined){
          this.send({ jsonrpc:'2.0', id: msg.id, result: {} });
        }
      }
    }catch{}
  }

  private send(obj:any){
    if(!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(obj)+'\n');
  }

  request(method:string, params:any): Promise<any>{
    const id = this.nextId++;
    const p = new Promise<any>((resolve, reject)=>{
      this.pending.set(id, {resolve, reject});
      setTimeout(()=> { if(this.pending.has(id)){ this.pending.delete(id); reject(new Error(`msp timeout ${method}`)); } }, 20000);
    });
    this.send({ jsonrpc:'2.0', id, method, params });
    return p;
  }

  notify(method:string, params:any){
    this.send({ jsonrpc:'2.0', method, params });
  }

  dispose(){
    try{ this.rl?.close(); }catch{}
    try{ this.proc?.kill(); }catch{}
    this.proc=undefined; this.initialized=false;
  }
}

class SessionManager {
  private hosts = new Map<string, MspHost>();
  private sessions = new Map<string, { host: MspHost; sessionId: string; viewCursor?: string }>();
  private webviewBySession = new Map<string, vscode.Webview>();

  getHost(workspace?: string): MspHost {
    const key = workspace ?? '__global__';
    let h = this.hosts.get(key);
    if(!h){ h = new MspHost(getMusePath(), workspace); this.hosts.set(key, h); }
    return h;
  }

  async ensureSession(workspace?: string, webview?: vscode.Webview): Promise<{host: MspHost; sessionId:string}> {
    const key = workspace ?? '__global__';
    const existing = this.sessions.get(key);
    if(existing && existing.sessionId) return existing;
    const host = this.getHost(workspace);
    await host.ensureStarted();
    // bind notifications once per host
    if(!(host as any)._bound){
      (host as any)._bound = true;
      host.onNotification((method, params)=> this.handleNotification(method, params, workspace, webview));
    }
    const sessionId = uuidv7();
    const commandId = uuidv7();
    const res = await host.request('session/start', { commandId, sessionId, workspaceRoot: workspace } as any);
    // server may mint id; prefer returned session.sessionId
    const sid = (res?.session?.sessionId ?? res?.session?.session_id ?? sessionId) as string;
    const entry = { host, sessionId: sid };
    this.sessions.set(key, entry);
    if(webview) this.webviewBySession.set(sid, webview);
    return entry;
  }

  handleNotification(method:string, params:any, workspace?:string, webview?: vscode.Webview){
    // dispatch to all webviews for simplicity if no specific session
    const targetWebviews: vscode.Webview[] = [];
    // try to resolve sessionId from params
    const sid = params?.sessionId ?? params?.session_id ?? params?.item?.sessionId;
    if(sid && this.webviewBySession.has(sid)) targetWebviews.push(this.webviewBySession.get(sid)!);
    else {
      // broadcast to known webviews for workspace
      for(const v of this.webviewBySession.values()) targetWebviews.push(v);
    }
    // also need to deliver to current active webviews via global registry
    // For now, broadcast to all known if none matched
    const deliver = (wv:vscode.Webview) => {
      if(method === 'userInput/requested' || method === 'userInput/requested' || method === 'userInput/request'){
        // params has questions[]
        wv.postMessage({ type:'user_input_requested', userInputId: params.userInputId, toolName: params.toolName, questions: params.questions, sessionId: params.sessionId });
      } else if(method === 'approval/requested'){
        wv.postMessage({ type:'approval_requested', approvalId: params.approvalId, toolName: params.toolName, subject: params.subject, choices: params.availableChoices, sessionId: params.sessionId });
      } else if(method === 'item/started'){
        const item = params.item;
        if(item?.kind === 'toolCall'){
          wv.postMessage({ type:'tool_call', id: item.callId ?? item.itemId ?? params.itemId, name: item.toolName ?? item.tool ?? 'tool', args: item.args ? String(item.args).slice(0,180) : '', status:'running' });
        } else if(item?.kind === 'reasoning'){
          wv.postMessage({ type:'reasoning_start' });
          if(item.content) wv.postMessage({ type:'reasoning_delta', text: item.content });
        } else if(item?.kind === 'agentMessage'){
          // ensure assistant turn exists; content will come via delta/completed
          wv.postMessage({ type:'chunk', text:'', done:false });
        }
      } else if(method === 'item/delta'){
        // delta has path and delta; common paths: content, args, result
        const itemId = params.itemId;
        const path = params.path ?? params.field ?? '';
        const delta = params.delta ?? params.text ?? '';
        // heuristic: if path contains content for agentMessage/reasoning
        if(typeof delta === 'string' && delta){
          // try to infer kind via pending items? For now treat as chunk or reasoning
          // Check if webview has reasoning open? We'll just send as chunk if not reasoning
          // Use simple heuristic: if path includes 'content' or item kind reasoning, send reasoning
          if(String(path).toLowerCase().includes('reasoning') || String(path).toLowerCase().includes('thinking')){
            wv.postMessage({ type:'reasoning_delta', text: String(delta) });
          } else {
            wv.postMessage({ type:'chunk', text: String(delta), done:false });
          }
        } else if(delta && typeof delta === 'object'){
          // tool args streaming
          wv.postMessage({ type:'tool_call', id: itemId, name: 'tool', args: JSON.stringify(delta).slice(0,180), status:'running' });
        }
      } else if(method === 'item/completed'){
        const item = params.item;
        if(item?.kind === 'toolCall'){
          const status = item.status === 'failed' || item.status === 'error' ? 'error' : 'done';
          wv.postMessage({ type:'tool_call', id: item.callId ?? item.itemId, name: item.toolName ?? 'tool', args: item.args ? String(item.args).slice(0,180) : '', status });
        } else if(item?.kind === 'reasoning'){
          wv.postMessage({ type:'reasoning_end' });
        } else if(item?.kind === 'agentMessage'){
          // final content
          if(item.content) wv.postMessage({ type:'chunk', text: String(item.content), done:false });
        }
      } else if(method === 'turn/completed'){
        wv.postMessage({ type:'chunk', text:'', done:true });
      } else if(method === 'turn/retryScheduled'){
        // transient
      } else if(method === 'session/modelChanged' || method === 'session/approvalModeChanged' || method === 'session/branchChanged'){
        // push updated status to webview
        const ws = workspace ?? getWorkspace();
        buildStatus(ws).then(s=> wv.postMessage({ type:'muse_status', status: s }));
      }
    };
    for(const wv of targetWebviews) deliver(wv);
    // also broadcast status changes even if no target matched (e.g. global status bar)
    if(method === 'session/modelChanged' || method === 'session/approvalModeChanged'){
      const anyWv = targetWebviews[0] ?? [...this.webviewBySession.values()][0];
      if(anyWv && targetWebviews.length===0){
        const ws = workspace ?? getWorkspace();
        buildStatus(ws).then(s=> anyWv.postMessage({ type:'muse_status', status: s }));
      }
    }
  }

  async handleUserInputAnswer(msg:any, webview:vscode.Webview){
    const { userInputId, sessionId, answers } = msg;
    if(!userInputId || !sessionId) return;
    const key = this.findWorkspaceForSession(sessionId) ?? '__global__';
    const host = this.hosts.get(key) ?? this.getHost(undefined);
    await host.ensureStarted();
    try{
      await host.request('userInput/answer', { sessionId, userInputId, commandId: uuidv7(), answers } as any);
    }catch(e:any){
      webview.postMessage({ type:'chunk', text:`userInput answer failed: ${e.message ?? e}`, done:true, isError:true });
    }
  }

  async handleApprovalDecide(msg:any, webview:vscode.Webview){
    const { approvalId, choiceId, sessionId } = msg;
    if(!approvalId) return;
    // need to resolve session and requirement id via approval/listPending
    const workspace = getWorkspace();
    const host = this.getHost(workspace);
    await host.ensureStarted();
    // fetch pending to get requirement id
    let requirementId: any = undefined;
    try{
      const pending = await host.request('approval/listPending', { sessionId } as any);
      const match = (pending?.approvals ?? []).find((a:any)=> a.approvalId===approvalId);
      if(match) requirementId = match.currentRequirementId;
    }catch{}
    try{
      await host.request('approval/decide', { approvalId, choiceId, currentRequirementId: requirementId, sessionId } as any);
    }catch(e:any){
      webview.postMessage({ type:'chunk', text:`approval failed: ${e.message ?? e}`, done:true, isError:true });
    }
  }

  private findWorkspaceForSession(sessionId:string): string|undefined {
    for(const [k,v] of this.sessions.entries()) if(v.sessionId===sessionId) return k==='__global__'?undefined:k;
    return undefined;
  }

  async listSessions(workspace?:string){
    const host = this.getHost(workspace);
    await host.ensureStarted();
    const res = await host.request('session/list', { workspaceRoot: workspace, limit: 20 } as any);
    return res?.sessions ?? res?.sessions ?? [];
  }

  async resumeSession(sessionId:string, workspace?:string, webview?:vscode.Webview){
    const host = this.getHost(workspace);
    await host.ensureStarted();
    const commandId = uuidv7();
    const res = await host.request('session/resume', { commandId, sessionId } as any);
    const key = workspace ?? '__global__';
    this.sessions.set(key, { host, sessionId });
    if(webview) this.webviewBySession.set(sessionId, webview);
    // replay history to webview
    if(res?.history?.items){
      for(const item of res.history.items){
        this.replayItem(item, webview);
      }
    }
    return res;
  }

  private replayItem(item:any, webview?:vscode.Webview){
    if(!webview) return;
    if(item.kind==='userMessage'){
      webview.postMessage({ type:'replay_user', text: item.displayText ?? item.content ?? '' });
    } else if(item.kind==='agentMessage'){
      webview.postMessage({ type:'chunk', text: item.content ?? '', done:false });
    }
  }

  async startTurn(prompt:string, workspace?:string, webview?:vscode.Webview){
    const { host, sessionId } = await this.ensureSession(workspace, webview);
    if(webview) this.webviewBySession.set(sessionId, webview);
    const commandId = uuidv7();
    await host.request('turn/start', { commandId, sessionId, input: [{ type:'text', text: prompt }], displayText: prompt } as any);
  }

  async setModel(modelId:string, workspace?:string){
    const sess = this.sessions.get(workspace ?? '__global__');
    if(!sess) throw new Error('no session');
    await sess.host.request('session/setModel', { sessionId: sess.sessionId, commandId: uuidv7(), modelId } as any);
  }

  async setApprovalMode(mode:string, workspace?:string){
    const sess = this.sessions.get(workspace ?? '__global__');
    if(!sess) throw new Error('no session');
    await sess.host.request('session/setApprovalMode', { sessionId: sess.sessionId, commandId: uuidv7(), approvalMode: mode } as any);
  }

  async compact(workspace?:string){
    const sess = this.sessions.get(workspace ?? '__global__');
    if(!sess) throw new Error('no session');
    await sess.host.request('session/compact', { sessionId: sess.sessionId, commandId: uuidv7() } as any);
  }

  async fork(workspace?:string, cursor?:string){
    const sess = this.sessions.get(workspace ?? '__global__');
    if(!sess) throw new Error('no session');
    const res = await sess.host.request('session/fork', { sessionId: sess.sessionId, commandId: uuidv7(), cutPoint: cursor ? { cursor } as any : undefined } as any);
    return res;
  }

  dispose(){ for(const h of this.hosts.values()) h.dispose(); }
}

const mspManager = new SessionManager();

async function handleSessionPick(sessionId:string, webview:vscode.Webview){
  const workspace = getWorkspace();
  try{
    await mspManager.resumeSession(sessionId, workspace, webview);
    webview.postMessage({ type:'clear' });
    webview.postMessage({ type:'chunk', text:`Resumed session \`${sessionId.slice(0,8)}\``, done:true });
  }catch(e:any){
    webview.postMessage({ type:'chunk', text:`resume failed: ${e.message ?? e}`, done:true, isError:true });
  }
}
async function handleModelPick(modelId:string, webview:vscode.Webview){
  try{
    await mspManager.setModel(modelId, getWorkspace());
    webview.postMessage({ type:'chunk', text:`Model set to \`${modelId}\``, done:true });
  }catch(e:any){
    webview.postMessage({ type:'chunk', text:`setModel failed: ${e.message ?? e}`, done:true, isError:true });
  }
}

// ---- Slash registry ----
type SlashHandler = (args:string[], webview:vscode.Webview, workspace:string|undefined, raw:string)=>Promise<boolean>;

const slashRegistry: Record<string, SlashHandler> = {
  '/clear': async (_args, webview)=>{
    webview.postMessage({ type:'clear' });
    return true;
  },
  '/help': async (_args, webview)=>{
    const help = `**Muse Chat — slash commands**\n\n`+
      `- \`/clear\` — clear the chat log\n`+
      `- \`/help\` — this help\n`+
      `- \`/resume [--last|<id>]\` — resume a session (no arg shows picker)\n`+
      `- \`/new\` or \`/start\` — start a new session\n`+
      `- \`/sessions\` — list recent sessions\n`+
      `- \`/compact\` — compact session context (summary)\n`+
      `- \`/fork [cursor]\` — fork session at cursor\n`+
      `- \`/model [id]\` — list or set model (e.g. \`/model muse-spark-1.2-contributor\`)\n`+
      `- \`/approval-mode <mode>\` — set approval mode (untrusted|on-request|never)\n`+
      `- \`/export [path]\` — export transcript (coming soon)\n`+
      `- \`/trace\` — inspect last trace (coming soon)\n`+
      `- \`/skills\` — list enabled skills\n`+
      `\nAlso: follow-up questions and approval prompts are interactive dialogs handled automatically during turns.`;
    webview.postMessage({ type:'chunk', text: help, done:false });
    webview.postMessage({ type:'chunk', text:'', done:true });
    return true;
  },
  '/resume': async (args, webview, workspace)=>{
    if(args[0]==='--last'){
      // resume most recent via DB
      const sessions = await mspManager.listSessions(workspace).catch(()=>[]);
      const latest = sessions[0];
      if(!latest){ webview.postMessage({ type:'chunk', text:'No previous sessions', done:true, isError:true }); return true; }
      const sid = latest.sessionId ?? latest.session_id ?? latest.id;
      await handleSessionPick(sid, webview);
      return true;
    }
    if(args[0] && !args[0].startsWith('-')){
      await handleSessionPick(args[0], webview);
      return true;
    }
    // no arg → show picker via MSP session/list
    try{
      const sessions = await mspManager.listSessions(workspace);
      if(!sessions.length){
        webview.postMessage({ type:'chunk', text:'No sessions found for this workspace', done:true });
        return true;
      }
      webview.postMessage({ type:'session_list', sessions: sessions.map((s:any)=> ({
        sessionId: s.sessionId ?? s.session_id,
        title: s.title ?? s.firstUserPrompt ?? 'Untitled',
        updatedAt: s.updatedAt ?? s.updated_at_us,
        workspaceRoot: s.workspaceRoot ?? s.workspace_root,
      }))});
      return true;
    }catch(e:any){
      // fallback to sqlite direct
      try{
        const dbSessions = listSessionsFromDb(workspace);
        webview.postMessage({ type:'session_list', sessions: dbSessions });
      }catch{
        webview.postMessage({ type:'chunk', text:`resume list failed: ${e.message ?? e}`, done:true, isError:true });
      }
      return true;
    }
  },
  '/sessions': async (args, webview, workspace)=> slashRegistry['/resume'](args, webview, workspace, ''),
  '/new': async (_args, webview, workspace)=>{
    const host = mspManager.getHost(workspace);
    await host.ensureStarted();
    const sid = uuidv7();
    await host.request('session/start', { commandId: uuidv7(), sessionId: sid, workspaceRoot: workspace } as any);
    (mspManager as any).sessions.set(workspace ?? '__global__', { host, sessionId: sid });
    webview.postMessage({ type:'clear' });
    webview.postMessage({ type:'chunk', text:`Started new session \`${sid.slice(0,8)}\``, done:true });
    return true;
  },
  '/start': async (a,b,c)=> slashRegistry['/new'](a,b,c,''),
  '/compact': async (_args, webview, workspace)=>{
    try{ await mspManager.compact(workspace); webview.postMessage({ type:'chunk', text:'Session compacted', done:true }); }
    catch(e:any){ webview.postMessage({ type:'chunk', text:`compact failed: ${e.message}`, done:true, isError:true }); }
    return true;
  },
  '/fork': async (args, webview, workspace)=>{
    try{ const res = await mspManager.fork(workspace, args[0]); webview.postMessage({ type:'chunk', text:`Forked to \`${(res?.sessionId ?? res?.session?.sessionId ?? '').slice(0,8)}\``, done:true }); }
    catch(e:any){ webview.postMessage({ type:'chunk', text:`fork failed: ${e.message}`, done:true, isError:true }); }
    return true;
  },
  '/model': async (args, webview, workspace)=>{
    if(!args[0]){
      const host = mspManager.getHost(workspace);
      await host.ensureStarted();
      try{
        const res = await host.request('model/list', {} as any);
        const models = res?.models ?? res ?? [];
        webview.postMessage({ type:'model_list', models });
      }catch(e:any){
        webview.postMessage({ type:'chunk', text:`model list failed: ${e.message}`, done:true, isError:true });
      }
      return true;
    }
    await handleModelPick(args[0], webview);
    return true;
  },
  '/approval-mode': async (args, webview, workspace)=>{
    if(!args[0]){ webview.postMessage({ type:'chunk', text:'Usage: /approval-mode <untrusted|on-request|never>', done:true, isError:true }); return true; }
    try{ await mspManager.setApprovalMode(args[0], workspace); webview.postMessage({ type:'chunk', text:`Approval mode set to \`${args[0]}\``, done:true }); }
    catch(e:any){ webview.postMessage({ type:'chunk', text:`setApprovalMode failed: ${e.message}`, done:true, isError:true }); }
    return true;
  },
  '/skills': async (_args, webview)=>{
    const proc = cp.spawn(getMusePath(), ['skills','list','--enabled-only','--json'], {});
    let out='';
    proc.stdout?.on('data',d=> out+=d.toString());
    proc.on('close',()=>{
      try{
        const j=JSON.parse(out);
        const list = (j.skills ?? []).map((s:any)=> `- \`${s.id}\` — ${s.display_name ?? s.name}`).join('\n');
        webview.postMessage({ type:'chunk', text:`**Enabled skills**\n\n${list || '_none_'}`, done:false });
        webview.postMessage({ type:'chunk', text:'', done:true });
      }catch{ webview.postMessage({ type:'chunk', text: out || '(no output)', done:true }); }
    });
    return true;
  },
  '/export': async (_args, webview, workspace)=>{
    const sess = (mspManager as any).sessions.get(workspace ?? '__global__');
    if(!sess){ webview.postMessage({ type:'chunk', text:'No active session to export', done:true, isError:true }); return true; }
    const host = sess.host;
    try{
      const res = await host.request('view/page', { sessionId: sess.sessionId, limit: 200 } as any);
      const text = JSON.stringify(res, null, 2).slice(0, 8000);
      webview.postMessage({ type:'chunk', text:`\`\`\`json\n${text}\n\`\`\``, done:true });
    }catch(e:any){ webview.postMessage({ type:'chunk', text:`export failed: ${e.message}`, done:true, isError:true }); }
    return true;
  },
  '/trace': async (_args, webview, workspace)=>{
    // use local CLI trace inspect via exec fallback
    const sess = (mspManager as any).sessions.get(workspace ?? '__global__');
    const sid = sess?.sessionId;
    const args = sid ? ['trace','inspect','--session-id', sid, '--render-mode','compact'] : ['trace','inspect','--render-mode','compact'];
    const proc = cp.spawn(getMusePath(), args, { cwd: workspace } as any);
    let out=''; proc.stdout?.on('data',d=> out+=d.toString());
    proc.stderr?.on('data',d=> out+=d.toString());
    proc.on('close',()=>{ webview.postMessage({ type:'chunk', text: out || '(no trace)', done:true }); });
    return true;
  },
};

function listSessionsFromDb(workspace?:string){
  const dbPath = path.join(process.env.HOME ?? '', '.local/share/muse/session-index.db');
  if(!fs.existsSync(dbPath)) return [];
  try{
    // Use sqlite3 CLI to avoid native dep
    const cmd = `sqlite3 "${dbPath}" "SELECT session_id, title, updated_at_us, workspace_root FROM sessions ${workspace ? `WHERE workspace_root='${workspace.replace(/'/g,"''")}'` : ''} ORDER BY updated_at_us DESC LIMIT 20;"`;
    const out = cp.execSync(cmd, { encoding:'utf8' });
    return out.trim().split('\n').filter(Boolean).map(l=>{
      const [sid,title,us,ws]=l.split('|');
      return { sessionId: sid, title: title||'Untitled', updatedAt: Number(us), workspaceRoot: ws };
    });
  }catch{ return []; }
}

async function handleSlash(prompt: string, webview: vscode.Webview, workspace?: string): Promise<boolean> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return false;
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const handler = slashRegistry[cmd];
  if(handler){
    await handler(args, webview, workspace, trimmed);
    return true;
  }
  webview.postMessage({ type: 'chunk', text: `Unknown command \`${cmd}\`. Try \`/help\` for available commands.`, done: true, isError: true });
  return true;
}

async function handleSend(prompt: string, webview: vscode.Webview, workspace?: string) {
  if (!prompt.trim()) return;
  if (await handleSlash(prompt, webview, workspace)) return;
  // Prefer MSP turn/start for interactive support (approvals/userInput), fallback to exec --json
  try{
    await mspManager.startTurn(prompt, workspace, webview);
    // streaming will arrive via notifications -> webview messages
    return;
  }catch(e:any){
    // fallback to exec --json path (previous working)
  }
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

  const pendingToolByTask = new Map<string, { name: string }>();
  const callIdToTask = new Map<string, string>();

  function emitTool(id: string, name: string, argsText: string, status: 'running' | 'done' | 'error', result?: string) {
    webview.postMessage({ type: 'tool_call', id, name, args: argsText, status, result });
  }

  function formatToolTarget(description: string | undefined, command: string | undefined): string {
    const d = (description ?? '').trim();
    const c = (command ?? '').trim();
    if (d && c) return `${d} — ${c}`;
    if (d) return d;
    if (c) return c;
    return '';
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

        if (ptype === 'task.lifecycle.proposed') {
          const evt = payload['event'] as Record<string, unknown> | undefined;
          const taskKind = String((evt?.['task_kind'] as string) ?? '');
          if (taskKind.startsWith('tool.')) {
            const toolName = taskKind.slice(5) || 'tool';
            const taskId = String((evt?.['task_id'] as string) ?? (payload['task_id'] as string) ?? '');
            if (taskId) {
              pendingToolByTask.set(taskId, { name: toolName });
              hasOutput = true;
              emitTool(taskId, toolName, '', 'running');
            }
            continue;
          }
        }
        if (ptype === 'task.lifecycle.scheduled') {
          const evt = payload['event'] as Record<string, unknown> | undefined;
          const key = String((evt?.['idempotency_key'] as string) ?? '');
          const taskId = String((evt?.['task_id'] as string) ?? (payload['task_id'] as string) ?? '');
          if (key.startsWith('tool:') && taskId) {
            const callId = key.slice(5);
            callIdToTask.set(callId, taskId);
          }
        }
        if (ptype === 'task.lifecycle.output') {
          const evt = payload['event'] as Record<string, unknown> | undefined;
          const taskId = String((payload['task_id'] as string) ?? (evt?.['task_id'] as string) ?? '');
          const chunk = String((evt?.['chunk'] as string) ?? '');
          const info = pendingToolByTask.get(taskId);
          if (info && chunk) {
            try {
              const parsed = JSON.parse(chunk) as Record<string, unknown>;
              const description = String((parsed['description'] as string) ?? '');
              const command = String((parsed['command'] as string) ?? '');
              const target = formatToolTarget(description, command);
              if (target) {
                hasOutput = true;
                emitTool(taskId, info.name, target, 'running');
                continue;
              }
            } catch {}
          }
        }
        if (ptype === 'tool.result') {
          const callId = String((payload['call_id'] as string) ?? '');
          const facts = payload['correlation_facts'] as Record<string, unknown> | undefined;
          const toolName = String((facts?.['tool_name'] as string) ?? (payload['tool_name'] as string) ?? 'tool');
          const outcome = String((facts?.['outcome'] as string) ?? '');
          const taskId = callId ? (callIdToTask.get(callId) ?? callId) : '';
          const targetId = taskId || callId || `tool-${Date.now()}`;
          if (taskId && !pendingToolByTask.has(taskId)) pendingToolByTask.set(taskId, { name: toolName });
          const isError = outcome === 'error' || outcome === 'failure';
          hasOutput = true;
          emitTool(targetId, toolName, '', isError ? 'error' : 'done', outcome ? `outcome: ${outcome}` : undefined);
          if (taskId && pendingToolByTask.has(taskId)) pendingToolByTask.delete(taskId);
          if (callId) callIdToTask.delete(callId);
          continue;
        }
        if (ptype === 'task.lifecycle.completed') {
          const evt = payload['event'] as Record<string, unknown> | undefined;
          const taskId = String((evt?.['task_id'] as string) ?? (payload['task_id'] as string) ?? '');
          if (taskId && pendingToolByTask.has(taskId)) {
            const info = pendingToolByTask.get(taskId)!;
            hasOutput = true;
            emitTool(taskId, info.name, '', 'done');
            pendingToolByTask.delete(taskId);
            continue;
          }
        }

        const isReasoning = ptype.includes('reasoning') || ptype.includes('thinking') || ptype.includes('thought') || Boolean(payload['reasoning'] ?? payload['thinking']);
        const isGenericTool = ptype.includes('tool') || Boolean(payload['tool_name'] ?? payload['toolName']) || payload['name'] === 'tool' || Boolean((ev as Record<string, unknown>)['tool_call'] ?? payload['tool_call']);

        if (isReasoning) {
          const t = String(payload['text'] ?? payload['delta'] ?? payload['reasoning'] ?? payload['thinking'] ?? payload['content'] ?? (ev['delta'] as string) ?? '');
          if (t) {
            hasOutput = true;
            if (!reasoningStarted) { webview.postMessage({ type: 'reasoning_start' }); reasoningStarted = true; }
            webview.postMessage({ type: 'reasoning_delta', text: t });
          }
          continue;
        }
        if (isGenericTool) {
          hasOutput = true;
          const toolName = String(payload['tool_name'] ?? payload['toolName'] ?? payload['name'] ?? (ev['tool_name'] as string) ?? 'tool');
          const toolArgs = payload['args'] ?? payload['input'] ?? payload['arguments'] ?? '';
          const argsStr = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs ?? '').slice(0, 400);
          const result = payload['result'] ?? payload['output'] ?? '';
          const resultStr = typeof result === 'string' ? result : (result ? JSON.stringify(result).slice(0, 800) : undefined);
          const status: 'running' | 'done' = resultStr ? 'done' : 'running';
          emitTool(`generic-${Date.now()}`, toolName, argsStr, status, resultStr);
          continue;
        }

        let t = String(payload['text'] ?? payload['delta'] ?? (ev['delta'] as string) ?? (ev['text'] as string) ?? payload['content'] ?? '');
        if (t.includes('muse: workspace')) {
          t = t.replace(/muse:\s*workspace[^\n]*\n?/gi, '').replace(/muse:\s*workspace trust[^\n]*\n?/gi, '').trim();
          if (!t) continue;
        }
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
        if (
          line.includes('workspace root') ||
          line.includes('workspace trust') ||
          line.includes('trusted source') ||
          line.startsWith('muse: workspace')
        ) {
          continue;
        }
        hasOutput = true;
        if (reasoningStarted) { webview.postMessage({ type: 'reasoning_end' }); reasoningStarted = false; }
        webview.postMessage({ type: 'chunk', text: line + '\n', done: false });
      }
    }
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (
      s.includes('Linux sandbox') ||
      s.includes('Bubblewrap') ||
      s.includes('workspace is untrusted') ||
      s.includes('workspace root') ||
      s.includes('workspace trust') ||
      s.includes('trusted source')
    )
      return;
    webview.postMessage({ type: 'chunk', text: s, done: false, isStderr: true });
  });

  proc.on('error', (err) => {
    webview.postMessage({ type: 'chunk', text: `spawn error: ${err.message}`, done: true, isError: true });
  });

  proc.on('close', (code) => {
    if (buf.trim()) {
      if (buf.includes('workspace root') || buf.includes('workspace trust') || buf.includes('trusted source')) {
        const cleaned = buf.replace(/muse:\s*workspace[^\n]*\n?/gi, '').trim();
        if (cleaned) {
          try {
            const ev = JSON.parse(cleaned) as Record<string, unknown>;
            const t = String((ev['delta'] as string) ?? (ev['text'] as string) ?? '');
            if (t) webview.postMessage({ type: 'chunk', text: t, done: false });
          } catch {
            webview.postMessage({ type: 'chunk', text: cleaned, done: false });
          }
        }
      } else {
        try {
          const ev = JSON.parse(buf) as Record<string, unknown>;
          const t = String((ev['delta'] as string) ?? (ev['text'] as string) ?? '');
          if (t) webview.postMessage({ type: 'chunk', text: t, done: false });
        } catch {
          webview.postMessage({ type: 'chunk', text: buf, done: false });
        }
      }
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
