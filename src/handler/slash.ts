import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getMusePath, getWorkspace } from '../util/workspace';
import { uuidv7 } from '../util/uuid';
import { sessionManager } from '../msp/session-manager';
import { listSessionsFromDb } from '../service/db';
import { handleSessionPick, handleModelPick } from './chat';

export type SlashHandler = (args: string[], webview: vscode.Webview, workspace: string | undefined, raw: string) => Promise<boolean>;

export const slashRegistry: Record<string, SlashHandler> = {
  '/clear': async (_args, webview) => {
    webview.postMessage({ type: 'clear' });
    return true;
  },
  '/help': async (_args, webview) => {
    const help =
      `**Muse Chat — slash commands**\n\n` +
      `- \`/clear\` — clear the chat log\n` +
      `- \`/help\` — this help\n` +
      `- \`/resume [--last|<id>]\` — resume a session (no arg shows picker)\n` +
      `- \`/new\` or \`/start\` — start a new session\n` +
      `- \`/sessions\` — list recent sessions\n` +
      `- \`/compact\` — compact session context (summary)\n` +
      `- \`/fork [cursor]\` — fork session at cursor\n` +
      `- \`/model [id]\` — list or set model (e.g. \`/model muse-spark-1.2-contributor\`)\n` +
      `- \`/approval-mode <mode>\` — set approval mode (untrusted|on-request|never)\n` +
      `- \`/export [path]\` — export transcript (coming soon)\n` +
      `- \`/trace\` — inspect last trace (coming soon)\n` +
      `- \`/skills\` — list enabled skills\n` +
      `\nAlso: follow-up questions and approval prompts are interactive dialogs handled automatically during turns.`;
    webview.postMessage({ type: 'chunk', text: help, done: false });
    webview.postMessage({ type: 'chunk', text: '', done: true });
    return true;
  },
  '/resume': async (args, webview, workspace) => {
    if (args[0] === '--last') {
      const sessions = await sessionManager.listSessions(workspace).catch(() => []);
      const latest = sessions[0] as { sessionId?: string; session_id?: string; id?: string } | undefined;
      if (!latest) {
        webview.postMessage({ type: 'chunk', text: 'No previous sessions', done: true, isError: true });
        return true;
      }
      const sid = latest.sessionId ?? latest.session_id ?? latest.id;
      if (!sid) {
        webview.postMessage({ type: 'chunk', text: 'No previous sessions', done: true, isError: true });
        return true;
      }
      await handleSessionPick(sid as string, webview);
      return true;
    }
    if (args[0] && !args[0].startsWith('-')) {
      await handleSessionPick(args[0], webview);
      return true;
    }
    try {
      const sessions = await sessionManager.listSessions(workspace);
      if (!sessions.length) {
        webview.postMessage({ type: 'chunk', text: 'No sessions found for this workspace', done: true });
        return true;
      }
      webview.postMessage({
        type: 'session_list',
        sessions: (sessions as { sessionId?: string; session_id?: string; title?: string; firstUserPrompt?: string; updatedAt?: number; updated_at_us?: number; workspaceRoot?: string; workspace_root?: string }[]).map((s) => ({
          sessionId: s.sessionId ?? s.session_id,
          title: s.title ?? s.firstUserPrompt ?? 'Untitled',
          updatedAt: s.updatedAt ?? s.updated_at_us,
          workspaceRoot: s.workspaceRoot ?? s.workspace_root,
        })),
      });
      return true;
    } catch (e: unknown) {
      const err = e as { message?: string };
      try {
        const dbSessions = listSessionsFromDb(workspace);
        webview.postMessage({ type: 'session_list', sessions: dbSessions });
      } catch {
        webview.postMessage({ type: 'chunk', text: `resume list failed: ${err.message ?? String(e)}`, done: true, isError: true });
      }
      return true;
    }
  },
  '/sessions': async (args, webview, workspace) => slashRegistry['/resume'](args, webview, workspace, ''),
  '/new': async (_args, webview, workspace) => {
    const host = sessionManager.getHost(workspace);
    await host.ensureStarted();
    const sid = uuidv7();
    await host.request('session/start', { commandId: uuidv7(), sessionId: sid, workspaceRoot: workspace } as unknown);
    (sessionManager as unknown as { sessions: Map<string, unknown> }).sessions.set(workspace ?? '__global__', { host, sessionId: sid });
    webview.postMessage({ type: 'clear' });
    webview.postMessage({ type: 'chunk', text: `Started new session \`${sid.slice(0, 8)}\``, done: true });
    return true;
  },
  '/start': async (a, b, c) => slashRegistry['/new'](a, b, c, ''),
  '/compact': async (_args, webview, workspace) => {
    try {
      await sessionManager.compact(workspace);
      webview.postMessage({ type: 'chunk', text: 'Session compacted', done: true });
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `compact failed: ${err.message}`, done: true, isError: true });
    }
    return true;
  },
  '/fork': async (args, webview, workspace) => {
    try {
      const res = (await sessionManager.fork(workspace, args[0])) as { sessionId?: string; session?: { sessionId?: string } } | null;
      webview.postMessage({ type: 'chunk', text: `Forked to \`${(res?.sessionId ?? res?.session?.sessionId ?? '').slice(0, 8)}\``, done: true });
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `fork failed: ${err.message}`, done: true, isError: true });
    }
    return true;
  },
  '/model': async (args, webview, workspace) => {
    if (!args[0]) {
      const host = sessionManager.getHost(workspace);
      await host.ensureStarted();
      try {
        const res = (await host.request('model/list', {} as unknown)) as { models?: unknown[] } | unknown[] | null;
        const models = (res as { models?: unknown[] })?.models ?? (res as unknown[]) ?? [];
        webview.postMessage({ type: 'model_list', models });
      } catch (e: unknown) {
        const err = e as { message?: string };
        webview.postMessage({ type: 'chunk', text: `model list failed: ${err.message}`, done: true, isError: true });
      }
      return true;
    }
    await handleModelPick(args[0], webview);
    return true;
  },
  '/approval-mode': async (args, webview, workspace) => {
    if (!args[0]) {
      webview.postMessage({ type: 'chunk', text: 'Usage: /approval-mode <untrusted|on-request|never>', done: true, isError: true });
      return true;
    }
    try {
      await sessionManager.setApprovalMode(args[0], workspace);
      webview.postMessage({ type: 'chunk', text: `Approval mode set to \`${args[0]}\``, done: true });
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `setApprovalMode failed: ${err.message}`, done: true, isError: true });
    }
    return true;
  },
  '/skills': async (_args, webview) => {
    const proc = cp.spawn(getMusePath(), ['skills', 'list', '--enabled-only', '--json'], {});
    let out = '';
    proc.stdout?.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      try {
        const j = JSON.parse(out) as { skills?: { id: string; display_name?: string; name?: string }[] };
        const list = (j.skills ?? []).map((s) => `- \`${s.id}\` — ${s.display_name ?? s.name}`).join('\n');
        webview.postMessage({ type: 'chunk', text: `**Enabled skills**\n\n${list || '_none_'}`, done: false });
        webview.postMessage({ type: 'chunk', text: '', done: true });
      } catch {
        webview.postMessage({ type: 'chunk', text: out || '(no output)', done: true });
      }
    });
    return true;
  },
  '/export': async (_args, webview, workspace) => {
    const sess = (sessionManager as unknown as { sessions: Map<string, { host: { request: (m: string, p: unknown) => Promise<unknown> }; sessionId: string }> }).sessions.get(workspace ?? '__global__');
    if (!sess) {
      webview.postMessage({ type: 'chunk', text: 'No active session to export', done: true, isError: true });
      return true;
    }
    const host = sess.host;
    try {
      const res = await host.request('view/page', { sessionId: sess.sessionId, limit: 200 } as unknown);
      const text = JSON.stringify(res, null, 2).slice(0, 8000);
      webview.postMessage({ type: 'chunk', text: `\`\`\`json\n${text}\n\`\`\``, done: true });
    } catch (e: unknown) {
      const err = e as { message?: string };
      webview.postMessage({ type: 'chunk', text: `export failed: ${err.message}`, done: true, isError: true });
    }
    return true;
  },
  '/trace': async (_args, webview, workspace) => {
    const sess = (sessionManager as unknown as { sessions: Map<string, { sessionId: string }> }).sessions.get(workspace ?? '__global__');
    const sid = sess?.sessionId;
    const args = sid ? ['trace', 'inspect', '--session-id', sid, '--render-mode', 'compact'] : ['trace', 'inspect', '--render-mode', 'compact'];
    const proc = cp.spawn(getMusePath(), args, { cwd: workspace } as unknown as cp.SpawnOptions);
    let out = '';
    proc.stdout?.on('data', (d) => (out += d.toString()));
    proc.stderr?.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      webview.postMessage({ type: 'chunk', text: out || '(no trace)', done: true });
    });
    return true;
  },
};

export async function handleSlash(prompt: string, webview: vscode.Webview, workspace?: string): Promise<boolean> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return false;
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const handler = slashRegistry[cmd];
  if (handler) {
    await handler(args, webview, workspace, trimmed);
    return true;
  }
  webview.postMessage({ type: 'chunk', text: `Unknown command \`${cmd}\`. Try \`/help\` for available commands.`, done: true, isError: true });
  return true;
}
