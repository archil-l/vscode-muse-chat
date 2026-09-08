import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getWorkspace, getMusePath } from '../util/workspace';
import { uuidv7 } from '../util/uuid';
import { sessionManager } from '../msp/session-manager';
import { listSessionsFromDb } from '../service/db';

export async function handleSessionPick(sessionId: string, webview: vscode.Webview): Promise<void> {
  const workspace = getWorkspace();
  try {
    await sessionManager.resumeSession(sessionId, workspace, webview);
    webview.postMessage({ type: 'clear' });
    webview.postMessage({ type: 'chunk', text: `Resumed session \`${sessionId.slice(0, 8)}\``, done: true });
  } catch (e: unknown) {
    const err = e as { message?: string };
    webview.postMessage({ type: 'chunk', text: `resume failed: ${err.message ?? String(e)}`, done: true, isError: true });
  }
}

export async function handleModelPick(modelId: string, webview: vscode.Webview): Promise<void> {
  try {
    await sessionManager.setModel(modelId, getWorkspace());
    webview.postMessage({ type: 'chunk', text: `Model set to \`${modelId}\``, done: true });
  } catch (e: unknown) {
    const err = e as { message?: string };
    webview.postMessage({ type: 'chunk', text: `setModel failed: ${err.message ?? String(e)}`, done: true, isError: true });
  }
}

export async function handleSend(prompt: string, webview: vscode.Webview, workspace?: string): Promise<void> {
  if (!prompt.trim()) return;
  const { handleSlash } = await import('./slash');
  if (await handleSlash(prompt, webview, workspace)) return;
  try {
    await sessionManager.startTurn(prompt, workspace, webview);
    return;
  } catch {}
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

  function emitTool(id: string, name: string, argsText: string, status: 'running' | 'done' | 'error'): void {
    webview.postMessage({ type: 'tool_call', id, name, args: argsText, status });
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
          emitTool(targetId, toolName, '', isError ? 'error' : 'done');
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
            if (!reasoningStarted) {
              webview.postMessage({ type: 'reasoning_start' });
              reasoningStarted = true;
            }
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
          const resultStr = typeof result === 'string' ? result : result ? JSON.stringify(result).slice(0, 800) : undefined;
          const status: 'running' | 'done' = resultStr ? 'done' : 'running';
          emitTool(`generic-${Date.now()}`, toolName, argsStr, status);
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
            if (reasoningStarted) {
              webview.postMessage({ type: 'reasoning_end' });
              reasoningStarted = false;
            }
            webview.postMessage({ type: 'chunk', text: t, done: false });
          }
        } else if (payload['result']) {
          const rt = typeof payload['result'] === 'string' ? String(payload['result']) : JSON.stringify(payload['result']);
          hasOutput = true;
          if (reasoningStarted) {
            webview.postMessage({ type: 'reasoning_end' });
            reasoningStarted = false;
          }
          webview.postMessage({ type: 'chunk', text: rt, done: false });
        } else if (ev['type'] === 'result' && ev['result']) {
          const rt = typeof ev['result'] === 'string' ? String(ev['result']) : JSON.stringify(ev['result']);
          hasOutput = true;
          webview.postMessage({ type: 'chunk', text: rt, done: false });
        }
      } catch {
        if (line.includes('workspace root') || line.includes('workspace trust') || line.includes('trusted source') || line.startsWith('muse: workspace')) continue;
        hasOutput = true;
        if (reasoningStarted) {
          webview.postMessage({ type: 'reasoning_end' });
          reasoningStarted = false;
        }
        webview.postMessage({ type: 'chunk', text: line + '\n', done: false });
      }
    }
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (s.includes('Linux sandbox') || s.includes('Bubblewrap') || s.includes('workspace is untrusted') || s.includes('workspace root') || s.includes('workspace trust') || s.includes('trusted source')) return;
    webview.postMessage({ type: 'chunk', text: s, done: false, isStderr: true });
  });

  proc.on('error', (err) => {
    webview.postMessage({ type: 'chunk', text: `spawn error: ${err.message}`, done: true, isError: true });
  });

  proc.on('close', () => {
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
      p2.stdout?.on('data', (d: Buffer) => {
        out += d.toString();
        webview.postMessage({ type: 'chunk', text: d.toString(), done: false });
      });
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
