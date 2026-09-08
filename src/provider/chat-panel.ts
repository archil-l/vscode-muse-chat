import * as vscode from 'vscode';
import { getWebviewHtml } from '../util/webview-html';
import { pushStatus } from '../service/status';
import { getWorkspace } from '../util/workspace';
import { handleSend } from '../handler/chat';
import { handleSlash } from '../handler/slash';
import { handleSessionPick, handleModelPick } from '../handler/chat';
import { sessionManager } from '../msp/session-manager';

export function createChatPanel(extensionUri: vscode.Uri): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'vscode-muse-chat.panel',
    'Muse Chat',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] },
  );
  panel.webview.html = getWebviewHtml(panel.webview, extensionUri);
  bindWebview(panel.webview);
  return panel;
}

function bindWebview(webview: vscode.Webview): void {
  void pushStatus(webview, getWorkspace());
  const disposables: vscode.Disposable[] = [];
  webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'send') await handleSend(msg.text, webview, getWorkspace());
    else if (msg.type === 'user_input_answer') await sessionManager.handleUserInputAnswer(msg, webview);
    else if (msg.type === 'approval_decide') await sessionManager.handleApprovalDecide(msg, webview);
    else if (msg.type === 'session_pick') await handleSessionPick(msg.sessionId, webview);
    else if (msg.type === 'model_pick') await handleModelPick(msg.modelId, webview);
    else if (msg.type === 'session_list_request') await handleSlash('/resume', webview, getWorkspace());
    else if (msg.type === 'get_status' || msg.type === 'request_status') await pushStatus(webview, getWorkspace());
  });
}

let currentPanel: vscode.WebviewPanel | undefined;

export function createOrShowChatPanel(extensionUri: vscode.Uri): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }
  currentPanel = createChatPanel(extensionUri);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
}
