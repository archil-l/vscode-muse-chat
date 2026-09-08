import * as cp from 'child_process';
import * as readline from 'readline';

export type JsonRpcId = number | string;

export type MspHost = {
  ensureStarted(): Promise<void>;
  onNotification(handler: (method: string, params: unknown) => void): void;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  dispose(): void;
};

export function createMspHost(musePath: string, workspace?: string): MspHost {
  let proc: cp.ChildProcess | undefined;
  let rl: readline.Interface | undefined;
  let nextId = 1;
  const pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let initialized = false;
  let notifHandler: ((method: string, params: unknown) => void) | undefined;

  function handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as { id?: JsonRpcId; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const pend = pending.get(msg.id);
        if (pend) {
          pending.delete(msg.id);
          if ((msg as { error?: unknown }).error) pend.reject((msg as { error: unknown }).error);
          else pend.resolve((msg as { result: unknown }).result);
        }
      } else if (msg.method) {
        if (notifHandler) notifHandler(msg.method, msg.params);
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
    } catch {}
  }

  function send(obj: unknown): void {
    if (!proc?.stdin?.writable) return;
    proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  async function ensureStarted(): Promise<void> {
    if (proc && !proc.killed) return;
    const args = ['serve', '--trust-workspace', '--disable-sandbox'];
    proc = cp.spawn(musePath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    rl = readline.createInterface({ input: proc.stdout! });
    rl.on('line', (line) => handleLine(line));
    proc.stderr?.on('data', (d) => {
      const s = d.toString();
      if (s.includes('muse: workspace')) return;
    });
    proc.on('exit', () => {
      initialized = false;
      proc = undefined;
    });
    await request('initialize', {
      clientInfo: { name: 'vscode-muse-chat', version: '0.1.0' },
      capabilities: {},
    });
    notify('initialized', {});
    initialized = true;
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    const p = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`msp timeout ${method}`));
        }
      }, 20000);
    });
    send({ jsonrpc: '2.0', id, method, params });
    return p;
  }

  function notify(method: string, params: unknown): void {
    send({ jsonrpc: '2.0', method, params });
  }

  function dispose(): void {
    try {
      rl?.close();
    } catch {}
    try {
      proc?.kill();
    } catch {}
    proc = undefined;
    initialized = false;
  }

  function onNotification(handler: (method: string, params: unknown) => void): void {
    notifHandler = handler;
  }

  return { ensureStarted, onNotification, request, notify, dispose };
}
