import * as path from 'path';
import { readSettings, getSettingsPath, getWorkspace } from '../util/workspace';
import { sessionManager } from '../msp/session-manager';

function mapApprovalMode(m: string): string {
  const map: Record<string, string> = { allowAll: 'never', promptUnmatched: 'untrusted', onRequest: 'on-request', denyUnmatched: 'deny' };
  return map[m] ?? m;
}

export async function buildStatus(workspace?: string): Promise<Record<string, unknown>> {
  const settings = readSettings();
  const workdir = workspace ?? getWorkspace() ?? process.cwd();
  const workdirLabel = workdir ? path.basename(workdir) || workdir : '—';
  let model: string | null = settings.model ?? 'muse-spark-1.2-contributor';
  let effort: string | null = settings.reasoning_effort ?? 'high';
  let approvalMode: string | null = null;
  const sandbox: string = 'off';
  const trust: string = 'trusted';

  try {
    const mgr = sessionManager as unknown as { sessions: Map<string, { host: { request: (m: string, p: unknown) => Promise<unknown> }; sessionId: string }>; getHost: (w?: string) => { ensureStarted: () => Promise<void>; request: (m: string, p: unknown) => Promise<unknown> } };
    const key = workspace ?? getWorkspace() ?? '__global__';
    const sessEntry = mgr.sessions.get(key);
    if (sessEntry?.sessionId) {
      try {
        const res = (await sessEntry.host.request('session/read', { sessionId: sessEntry.sessionId } as unknown)) as { session?: { modelId?: string; workspaceRoot?: string; approvalMode?: { mode?: string } } } | null;
        const sess = (res as { session?: unknown })?.session ?? res;
        const s = sess as { modelId?: string; approvalMode?: { mode?: string } } | undefined;
        if (s?.modelId) model = s.modelId;
        if (s?.approvalMode?.mode) approvalMode = mapApprovalMode(String(s.approvalMode.mode));
      } catch {}
    } else {
      try {
        const host = mgr.getHost(workspace);
        await host.ensureStarted();
        const list = (await host.request('session/list', { workspaceRoot: workspace, limit: 1 } as unknown).catch(() => null)) as { sessions?: { modelId?: string; approvalMode?: { mode?: string } }[] } | null;
        const s = list?.sessions?.[0];
        if (s?.modelId && !sessEntry) model = s.modelId;
        if (s?.approvalMode?.mode) approvalMode = mapApprovalMode(String(s.approvalMode.mode));
      } catch {}
    }
  } catch {}

  if (!approvalMode) approvalMode = 'on-request';
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

export async function pushStatus(webview: { postMessage: (msg: unknown) => void }, workspace?: string): Promise<void> {
  const s = await buildStatus(workspace);
  webview.postMessage({ type: 'muse_status', status: s });
}
