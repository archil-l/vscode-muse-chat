import * as vscode from 'vscode';
import { getWebviewHtml } from '../util/webview-html';
import { pushStatus } from '../service/status';
import { getWorkspace } from '../util/workspace';
import { handleSend } from '../handler/chat';
import { handleSlash } from '../handler/slash';
import { handleSessionPick, handleModelPick } from '../handler/chat';
import { sessionManager } from '../msp/session-manager';

export function createChatViewProvider(extensionUri: vscode.Uri): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(view: vscode.WebviewView) {
      view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
      view.webview.html = getWebviewHtml(view.webview, extensionUri);
      void pushStatus(view.webview, getWorkspace());
      view.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'send') await handleSend(msg.text, view.webview, getWorkspace());
        else if (msg.type === 'user_input_answer') await sessionManager.handleUserInputAnswer(msg, view.webview);
        else if (msg.type === 'approval_decide') await sessionManager.handleApprovalDecide(msg, view.webview);
        else if (msg.type === 'session_pick') await handleSessionPick(msg.sessionId, view.webview);
        else if (msg.type === 'model_pick') await handleModelPick(msg.modelId, view.webview);
        else if (msg.type === 'session_list_request') await handleSlash('/resume', view.webview, getWorkspace());
        else if (msg.type === 'get_status' || msg.type === 'request_status') await pushStatus(view.webview, getWorkspace());
      });
    },
  };
}
