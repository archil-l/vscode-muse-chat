import * as vscode from 'vscode';
import { createChatViewProvider } from './provider/chat-view';
import { createOrShowChatPanel } from './provider/chat-panel';
import { sessionManager } from './msp/session-manager';

export function activate(context: vscode.ExtensionContext): void {
  const viewProvider = createChatViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('vscode-muse-chat.chatView', viewProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-muse-chat.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.muse-chat');
      createOrShowChatPanel(context.extensionUri);
    }),
  );
}

export function deactivate(): void {
  sessionManager.dispose();
}
