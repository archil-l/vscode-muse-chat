// VS Code webview API helper — acquire once, reuse globally
declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void; getState: () => unknown; setState: (s: unknown) => void };
  }
}

let api: ReturnType<NonNullable<typeof window.acquireVsCodeApi>> | undefined;

export function getVsCodeApi() {
  if (!api) {
    if (window.acquireVsCodeApi) api = window.acquireVsCodeApi();
    else api = { postMessage: () => {}, getState: () => undefined, setState: () => {} } as unknown as typeof api;
  }
  return api!;
}
