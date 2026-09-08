import * as vscode from 'vscode';
import { createMspHost, type MspHost } from './host';
import { getMusePath, getWorkspace } from '../util/workspace';
import { uuidv7 } from '../util/uuid';

type SessionEntry = { host: MspHost; sessionId: string; viewCursor?: string };

function createSessionManager() {
  const hosts = new Map<string, MspHost>();
  const sessions = new Map<string, SessionEntry>();
  const webviewBySession = new Map<string, vscode.Webview>();

  function getHost(workspace?: string): MspHost {
    const key = workspace ?? '__global__';
    let h = hosts.get(key);
    if (!h) {
      h = createMspHost(getMusePath(), workspace);
      hosts.set(key, h);
    }
    return h;
  }

  async function ensureSession(workspace?: string, webview?: vscode.Webview): Promise<SessionEntry> {
    const key = workspace ?? '__global__';
    const existing = sessions.get(key);
    if (existing && existing.sessionId) return existing;
    const host = getHost(workspace);
    await host.ensureStarted();
    const anyHost = host as unknown as Record<string, unknown>;
    if (!anyHost._bound) {
      anyHost._bound = true;
      host.onNotification((method, params) => handleNotification(method, params as Record<string, unknown>, workspace, webview));
    }
    const sessionId = uuidv7();
    const commandId = uuidv7();
    const res = (await host.request('session/start', { commandId, sessionId, workspaceRoot: workspace } as unknown)) as {
      session?: { sessionId?: string; session_id?: string };
    } | null;
    const sid = (res?.session?.sessionId ?? (res?.session as { session_id?: string })?.session_id ?? sessionId) as string;
    const entry: SessionEntry = { host, sessionId: sid };
    sessions.set(key, entry);
    if (webview) webviewBySession.set(sid, webview);
    return entry;
  }

  function handleNotification(method: string, params: Record<string, unknown>, workspace?: string, webview?: vscode.Webview): void {
    const p = params as Record<string, unknown> & {
      sessionId?: string;
      session_id?: string;
      item?: { sessionId?: string; kind?: string; content?: string; toolName?: string; tool?: string; callId?: string; itemId?: string; args?: unknown };
      userInputId?: string;
      toolName?: string;
      questions?: unknown;
      approvalId?: string;
      subject?: unknown;
      availableChoices?: unknown;
      itemId?: string;
      path?: string;
      field?: string;
      delta?: unknown;
      text?: unknown;
    };
    const targetWebviews: vscode.Webview[] = [];
    const sid = p.sessionId ?? p.session_id ?? p.item?.sessionId;
    if (sid && webviewBySession.has(sid as string)) targetWebviews.push(webviewBySession.get(sid as string)!);
    else {
      for (const v of webviewBySession.values()) targetWebviews.push(v);
    }

    const deliver = (wv: vscode.Webview): void => {
      if (method === 'userInput/requested' || method === 'userInput/request') {
        wv.postMessage({ type: 'user_input_requested', userInputId: p.userInputId, toolName: p.toolName, questions: p.questions, sessionId: p.sessionId });
      } else if (method === 'approval/requested') {
        wv.postMessage({ type: 'approval_requested', approvalId: p.approvalId, toolName: p.toolName, subject: p.subject, choices: p.availableChoices, sessionId: p.sessionId });
      } else if (method === 'item/started') {
        const item = p.item;
        if (item?.kind === 'toolCall') {
          wv.postMessage({ type: 'tool_call', id: (item.callId ?? item.itemId ?? (p as { itemId?: string }).itemId) as string, name: item.toolName ?? item.tool ?? 'tool', args: item.args ? String(item.args).slice(0, 180) : '', status: 'running' });
        } else if (item?.kind === 'reasoning') {
          wv.postMessage({ type: 'reasoning_start' });
          if (item.content) wv.postMessage({ type: 'reasoning_delta', text: item.content });
        } else if (item?.kind === 'agentMessage') {
          wv.postMessage({ type: 'chunk', text: '', done: false });
        }
      } else if (method === 'item/delta') {
        const itemId = p.itemId as string | undefined;
        const path = (p.path ?? p.field ?? '') as string;
        const delta = (p.delta ?? p.text ?? '') as unknown;
        if (typeof delta === 'string' && delta) {
          if (String(path).toLowerCase().includes('reasoning') || String(path).toLowerCase().includes('thinking')) {
            wv.postMessage({ type: 'reasoning_delta', text: String(delta) });
          } else {
            wv.postMessage({ type: 'chunk', text: String(delta), done: false });
          }
        } else if (delta && typeof delta === 'object') {
          wv.postMessage({ type: 'tool_call', id: itemId, name: 'tool', args: JSON.stringify(delta).slice(0, 180), status: 'running' });
        }
      } else if (method === 'item/completed') {
        const item = p.item;
        if (item?.kind === 'toolCall') {
          const status = (item as { status?: string }).status === 'failed' || (item as { status?: string }).status === 'error' ? 'error' : 'done';
          wv.postMessage({ type: 'tool_call', id: (item.callId ?? item.itemId) as string, name: item.toolName ?? 'tool', args: item.args ? String(item.args).slice(0, 180) : '', status });
        } else if (item?.kind === 'reasoning') {
          wv.postMessage({ type: 'reasoning_end' });
        } else if (item?.kind === 'agentMessage') {
          if (item.content) wv.postMessage({ type: 'chunk', text: String(item.content), done: false });
        }
      } else if (method === 'turn/completed') {
        wv.postMessage({ type: 'chunk', text: '', done: true });
      } else if (method === 'turn/retryScheduled') {
      } else if (method === 'session/modelChanged' || method === 'session/approvalModeChanged' || method === 'session/branchChanged') {
        const ws = workspace ?? getWorkspace();
        void import('../service/status').then(({ buildStatus: bs }) => bs(ws).then((s) => wv.postMessage({ type: 'muse_status', status: s } as unknown)));
      }
    };

    for (const wv of targetWebviews) deliver(wv);
    if (method === 'session/modelChanged' || method === 'session/approvalModeChanged') {
      const anyWv = targetWebviews[0] ?? [...webviewBySession.values()][0];
      if (anyWv && targetWebviews.length === 0) {
        const ws = workspace ?? getWorkspace();
        void import('../service/status').then(({ buildStatus: bs }) => bs(ws).then((s) => anyWv.postMessage({ type: 'muse_status', status: s } as unknown)));
      }
    }
  }

  async function handleUserInputAnswer(msg: { userInputId: string; sessionId: string; answers: unknown }, webview: vscode.Webview): Promise<void> {
    const { userInputId, sessionId, answers } = msg;
    if (!userInputId || !sessionId) return;
    const key = findWorkspaceForSession(sessionId) ?? '__global__';
    const host = hosts.get(key) ?? getHost(undefined);
    await host.ensureStarted();
    try {
      await host.request('userInput/answer', { sessionId, userInputId, commandId: uuidv7(), answers } as unknown);
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `userInput answer failed: ${err.message ?? String(e)}`, done: true, isError: true });
    }
  }

  async function handleApprovalDecide(msg: { approvalId: string; choiceId: string; sessionId: string }, webview: vscode.Webview): Promise<void> {
    const { approvalId, choiceId, sessionId } = msg;
    if (!approvalId) return;
    const workspace = getWorkspace();
    const host = getHost(workspace);
    await host.ensureStarted();
    let requirementId: unknown = undefined;
    try {
      const pending = (await host.request('approval/listPending', { sessionId } as unknown)) as { approvals?: { approvalId: string; currentRequirementId: unknown }[] } | null;
      const match = (pending?.approvals ?? []).find((a) => a.approvalId === approvalId);
      if (match) requirementId = match.currentRequirementId;
    } catch {}
    try {
      await host.request('approval/decide', { approvalId, choiceId, currentRequirementId: requirementId, sessionId } as unknown);
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `approval failed: ${err.message ?? String(e)}`, done: true, isError: true });
    }
  }

  function findWorkspaceForSession(sessionId: string): string | undefined {
    for (const [k, v] of sessions.entries()) if (v.sessionId === sessionId) return k === '__global__' ? undefined : k;
    return undefined;
  }

  async function listSessions(workspace?: string): Promise<unknown[]> {
    const host = getHost(workspace);
    await host.ensureStarted();
    const res = (await host.request('session/list', { workspaceRoot: workspace, limit: 20 } as unknown)) as { sessions?: unknown[] } | null;
    return (res as { sessions?: unknown[] })?.sessions ?? [];
  }

  async function resumeSession(sessionId: string, workspace?: string, webview?: vscode.Webview): Promise<unknown> {
    const host = getHost(workspace);
    await host.ensureStarted();
    const commandId = uuidv7();
    const res = (await host.request('session/resume', { commandId, sessionId } as unknown)) as { history?: { items?: { kind: string; displayText?: string; content?: string }[] } } | null;
    const key = workspace ?? '__global__';
    sessions.set(key, { host, sessionId });
    if (webview) webviewBySession.set(sessionId, webview);
    if ((res as { history?: { items?: unknown[] } })?.history?.items) {
      for (const item of (res as { history: { items: { kind: string; displayText?: string; content?: string }[] } }).history.items) {
        replayItem(item as { kind: string; displayText?: string; content?: string }, webview);
      }
    }
    return res;
  }

  function replayItem(item: { kind: string; displayText?: string; content?: string }, webview?: vscode.Webview): void {
    if (!webview) return;
    if (item.kind === 'userMessage') {
      webview.postMessage({ type: 'replay_user', text: item.displayText ?? item.content ?? '' });
    } else if (item.kind === 'agentMessage') {
      webview.postMessage({ type: 'chunk', text: item.content ?? '', done: false });
    }
  }

  async function startTurn(prompt: string, workspace?: string, webview?: vscode.Webview): Promise<void> {
    const { host, sessionId } = await ensureSession(workspace, webview);
    if (webview) webviewBySession.set(sessionId, webview);
    const commandId = uuidv7();
    await host.request('turn/start', { commandId, sessionId, input: [{ type: 'text', text: prompt }], displayText: prompt } as unknown);
  }

  async function setModel(modelId: string, workspace?: string): Promise<void> {
    const sess = sessions.get(workspace ?? '__global__');
    if (!sess) throw new Error('no session');
    await sess.host.request('session/setModel', { sessionId: sess.sessionId, commandId: uuidv7(), modelId } as unknown);
  }

  async function setApprovalMode(mode: string, workspace?: string): Promise<void> {
    const sess = sessions.get(workspace ?? '__global__');
    if (!sess) throw new Error('no session');
    await sess.host.request('session/setApprovalMode', { sessionId: sess.sessionId, commandId: uuidv7(), approvalMode: mode } as unknown);
  }

  async function compact(workspace?: string): Promise<void> {
    const sess = sessions.get(workspace ?? '__global__');
    if (!sess) throw new Error('no session');
    await sess.host.request('session/compact', { sessionId: sess.sessionId, commandId: uuidv7() } as unknown);
  }

  async function fork(workspace?: string, cursor?: string): Promise<unknown> {
    const sess = sessions.get(workspace ?? '__global__');
    if (!sess) throw new Error('no session');
    const res = await sess.host.request('session/fork', { sessionId: sess.sessionId, commandId: uuidv7(), cutPoint: cursor ? { cursor } as unknown : undefined } as unknown);
    return res;
  }

  function dispose(): void {
    for (const h of hosts.values()) h.dispose();
  }

  return {
    getHost,
    ensureSession,
    handleNotification,
    handleUserInputAnswer,
    handleApprovalDecide,
    listSessions,
    resumeSession,
    startTurn,
    setModel,
    setApprovalMode,
    compact,
    fork,
    dispose,
    _hosts: hosts,
    _sessions: sessions,
    sessions,
    hosts,
  };
}

export const sessionManager = createSessionManager();
export type SessionManager = ReturnType<typeof createSessionManager>;
