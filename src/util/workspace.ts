import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getWorkspace(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) return folders[0].uri.fsPath;
  return undefined;
}

export function getMusePath(): string {
  const cfg = vscode.workspace.getConfiguration('vscode-muse-chat');
  const p = cfg.get<string>('muse.path');
  if (p && p.trim()) return p.trim();
  return 'muse';
}

export function getSettingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg.trim() : path.join(process.env.HOME ?? '', '.config');
  return path.join(base, 'muse', 'settings.json');
}

export function readSettings(): { model?: string; reasoning_effort?: string } {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    return { model: j.model, reasoning_effort: j.reasoning_effort };
  } catch {
    return {};
  }
}
