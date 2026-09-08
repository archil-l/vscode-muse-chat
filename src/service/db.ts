import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function listSessionsFromDb(workspace?: string): { sessionId: string; title: string; updatedAt: number; workspaceRoot: string }[] {
  const dbPath = path.join(process.env.HOME ?? '', '.local/share/muse/session-index.db');
  if (!fs.existsSync(dbPath)) return [];
  try {
    const cmd = `sqlite3 "${dbPath}" "SELECT session_id, title, updated_at_us, workspace_root FROM sessions ${workspace ? `WHERE workspace_root='${workspace.replace(/'/g, "''")}'` : ''} ORDER BY updated_at_us DESC LIMIT 20;"`;
    const out = cp.execSync(cmd, { encoding: 'utf8' });
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sid, title, us, ws] = l.split('|');
        return { sessionId: sid, title: title || 'Untitled', updatedAt: Number(us), workspaceRoot: ws };
      });
  } catch {
    return [];
  }
}
