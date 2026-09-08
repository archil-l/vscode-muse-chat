'use client';

import React, { useEffect, useRef, useState, useReducer, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import 'katex/dist/katex.min.css';
import './global.css';
import { HStack, VStack, Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from '@astryxdesign/core/Chat';
import { Card } from '@astryxdesign/core/Card';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Icon } from '@astryxdesign/core/Icon';
import { Button } from '@astryxdesign/core/Button';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';
import { createStaticSource } from '@astryxdesign/core/Typeahead';
import { TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { SearchableItem } from '@astryxdesign/core/Typeahead';
import type { ChatComposerTrigger } from '@astryxdesign/core/Chat';
import { DocumentTextIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

import { getVsCodeApi } from './vscode';
import type { ChatMsg, MuseStatus } from './components/types';
import { root, chatColumn, chatLayoutStyle, artifactPanelWidthVar, ARTIFACT_TITLE, ARTIFACT_SUBTITLE } from './components/constants';
import { chatReducer, chatInitialState } from './reducers/chatReducer';
import './styles/chat.css';
import { mathPlugins } from './components/math-plugins';
import { MuseHeader } from './components/muse-header';
import { ChatEmptyState } from './components/chat-empty-state';
import { ArtifactBody, ArtifactActions } from './components/artifact';
import { AssistantContent } from './components/assistant-content';
import { MuseComposer } from './components/muse-composer';
import { SessionPickerDialog } from './components/dialogs/session-picker-dialog';
import { ModelPickerDialog } from './components/dialogs/model-picker-dialog';
import { UserInputDialog } from './components/dialogs/user-input-dialog';
import { ApprovalDialog } from './components/dialogs/approval-dialog';
import { DialogProvider, useDialog } from './context/DialogContext';

const SLASH_COMMANDS: SearchableItem<{ description: string }>[] = [
  { id: 'clear', label: 'clear', auxiliaryData: { description: 'Clear the chat log' } },
  { id: 'help', label: 'help', auxiliaryData: { description: 'Show available commands' } },
  { id: 'resume', label: 'resume', auxiliaryData: { description: 'Resume a session (shows picker)' } },
  { id: 'resume-last', label: 'resume --last', auxiliaryData: { description: 'Resume the most recent session' } },
  { id: 'new', label: 'new', auxiliaryData: { description: 'Start a new session' } },
  { id: 'compact', label: 'compact', auxiliaryData: { description: 'Compact session context' } },
  { id: 'fork', label: 'fork', auxiliaryData: { description: 'Fork session at cursor' } },
  { id: 'model', label: 'model', auxiliaryData: { description: 'List or set model' } },
  { id: 'approval-mode', label: 'approval-mode', auxiliaryData: { description: 'Set approval mode (untrusted|on-request|never)' } },
  { id: 'sessions', label: 'sessions', auxiliaryData: { description: 'List recent sessions' } },
  { id: 'skills', label: 'skills', auxiliaryData: { description: 'List enabled skills' } },
  { id: 'export', label: 'export', auxiliaryData: { description: 'Export transcript' } },
  { id: 'trace', label: 'trace', auxiliaryData: { description: 'Inspect last trace' } },
];

const slashCommandSource = createStaticSource(SLASH_COMMANDS);

if (typeof window !== 'undefined') {
  console.log('[muse-chat] SLASH_COMMANDS', SLASH_COMMANDS.map((c) => c.label));
}

const AppContent = () => {
  const [{ messages, isBusy }, dispatchChat] = useReducer(chatReducer, chatInitialState);
  const [input, setInput] = useState('');
  const [museStatus, setMuseStatus] = useState<MuseStatus | null>(null);
  const { isArtifactOpen, setIsArtifactOpen, isArtifactDialogOpen, setIsArtifactDialogOpen, openArtifact: openArtifactViaDialog } = useDialog();
  const rootRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const listRef = useRef<HTMLDivElement>(null);

  const slashTrigger: ChatComposerTrigger = {
    character: '/',
    searchSource: slashCommandSource,
    renderItem: (item) => <TypeaheadItem item={item} description={(item.auxiliaryData as { description: string })?.description} />,
    onSelect: (item) => ({
      value: `/${item.label}`,
      label: `/${item.label}`,
      variant: 'yellow' as const,
    }),
  };

  const artifactResize = useResizable({ defaultSize: 560, minSizePx: 400, maxSizePx: 860, autoSaveId: 'ai-chat-artifact-panel' });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    getVsCodeApi().postMessage({ type: 'get_status' });
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'muse_status') { setMuseStatus(msg.status ?? null); return; }
      if (msg.type === 'clear') { dispatchChat({ type: 'CLEAR' }); return; }
      if (msg.type === 'replay_user') {
        dispatchChat({ type: 'REPLAY_USER', text: String(msg.text ?? '') });
        return;
      }
      if (msg.type === 'tool_call') {
        const incomingId = String(msg.id ?? msg.name ?? 'tool');
        const incomingName = String(msg.name ?? 'tool');
        const rawTarget = msg.args ? String(msg.args) : '';
        const incomingTarget = rawTarget ? rawTarget.slice(0, 180) : undefined;
        const status = msg.status === 'error' ? 'error' : msg.status === 'done' ? 'complete' : 'running';
        dispatchChat({ type: 'TOOL_CALL', id: incomingId, name: incomingName, target: incomingTarget, status });
        return;
      }
      if (msg.type === 'reasoning_start') {
        dispatchChat({ type: 'REASONING_START' });
        return;
      }
      if (msg.type === 'reasoning_delta') {
        dispatchChat({ type: 'REASONING_DELTA', delta: String(msg.text ?? '') });
        return;
      }
      if (msg.type === 'reasoning_end') {
        dispatchChat({ type: 'REASONING_END' });
        return;
      }
      if (msg.type === 'chunk') {
        dispatchChat({
          type: 'CHUNK',
          text: String(msg.text ?? ''),
          done: Boolean(msg.done),
          isError: Boolean(msg.isError),
          isStderr: Boolean(msg.isStderr),
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const send = (text: string) => {
    const trimmed = text.trim(); if (!trimmed || isBusy) return;
    const now = new Date().toISOString();
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed, timestamp: now };
    const assistantMsg: ChatMsg = { id: `a-${Date.now() + 1}`, role: 'assistant', content: '', timestamp: now, isStreaming: true, toolCalls: [] };
    dispatchChat({ type: 'SEND', userMsg, assistantMsg });
    setInput('');
    getVsCodeApi().postMessage({ type: 'send', text: trimmed });
  };

  const openArtifact = () => {
    const width = rootRef.current?.offsetWidth;
    openArtifactViaDialog(width);
  };

  const conversationTitle = messages.find((m) => m.role === 'user')?.content.slice(0, 48) ?? 'New conversation • v0.1.1';
  const handleNewConversation = () => { dispatchChat({ type: 'CLEAR' }); getVsCodeApi().postMessage({ type: 'send', text: '/new' }); };
  const handleHistory = () => { getVsCodeApi().postMessage({ type: 'session_list_request' }); getVsCodeApi().postMessage({ type: 'send', text: '/resume' }); };

  return (
    <VStack ref={rootRef as never} style={root}>
      <MuseHeader title={conversationTitle} onHistory={handleHistory} onNewConversation={handleNewConversation} />
      <Layout height="fill" content={<LayoutContent padding={0}><HStack height="100%">
        <VStack style={chatColumn}>
          <ChatLayout
            density="spacious"
            style={chatLayoutStyle}
            composer={<MuseComposer museStatus={museStatus} input={input} onInputChange={(v) => setInput(v)} onSubmit={send} triggers={[slashTrigger]} />}
          >
            <VStack ref={listRef as never} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } as CSSProperties}>
              <ChatMessageList>
                {messages.length === 0 ? (
                  <>
                    <VStack style={{ flex: '0 0 18vh', minHeight: 'var(--spacing-16, 64px)' } as CSSProperties} aria-hidden />
                    <VStack style={{ paddingBlockStart: 'var(--spacing-2, 8px)' } as CSSProperties}>
                      <ChatSystemMessage variant="divider">Today</ChatSystemMessage>
                    </VStack>
                    <ChatEmptyState onSuggestionClick={send} />
                  </>
                ) : (
                  <>
                    <VStack style={{ paddingBlockStart: 'var(--spacing-2, 8px)' } as CSSProperties}>
                      <ChatSystemMessage variant="divider">Today</ChatSystemMessage>
                    </VStack>
                    {messages.map((m) =>
                      m.role === 'user' ? (
                        <ChatMessage key={m.id} sender="user">
                          <ChatMessageBubble metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.timestamp} format="time" />} />}>
                            <Markdown density="default" headingLevelStart={3} contentWidth={640} inlinePlugins={mathPlugins as never}>{m.content}</Markdown>
                          </ChatMessageBubble>
                        </ChatMessage>
                      ) : (
                        <ChatMessage key={m.id} sender="assistant">
                          {m.thinking ? <ChatToolCalls defaultIsExpanded={m.thinkingOpen} calls={[{ name: 'thinking', target: m.thinking.slice(0, 80), status: m.thinkingOpen ? 'running' : 'complete' }]} /> : null}
                          {m.thinking && m.thinkingOpen ? <ChatMessageBubble variant="ghost"><Text type="supporting" color="secondary" style={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' } as CSSProperties}>{m.thinking}</Text></ChatMessageBubble> : null}
                          {m.toolCalls && m.toolCalls.length > 0 && <ChatToolCalls defaultIsExpanded calls={m.toolCalls.map((c) => ({ name: c.name, target: c.target ?? '', status: c.status === 'running' ? 'running' : c.status === 'complete' ? 'complete' : 'error', duration: c.duration }))} />}
                          {m.content ? <ChatMessageBubble variant="ghost"><AssistantContent text={m.content} isStreaming={m.isStreaming} />{m.isError && <Text type="supporting" style={{ marginTop: 8, color: 'var(--color-error, #d32f2f)' } as CSSProperties}>Error</Text>}</ChatMessageBubble> : m.isStreaming ? <ChatMessageBubble variant="ghost"><Text type="supporting" color="secondary">Thinking…</Text></ChatMessageBubble> : null}
                          {!m.isStreaming && <ChatMessageMetadata timestamp={<Timestamp value={m.timestamp} format="time" />} footer={<Text type="supporting" color="secondary">Muse</Text>} />}
                          {(m.content.includes('ARTIFACT') || m.content.includes('design doc')) ? (
                            <ChatMessageBubble variant="ghost" width="100%">
                              <Card variant="muted" padding={3} style={{ maxWidth: 380 } as CSSProperties}>
                                <HStack gap={3} vAlign="center" width="100%">
                                  <Icon icon={DocumentTextIcon} size="md" color="secondary" />
                                  <VStack gap={0} style={{ flex: 1 } as CSSProperties}>
                                    <Text type="label" weight="semibold">{ARTIFACT_TITLE}</Text>
                                    <Text type="supporting" color="secondary">Document</Text>
                                  </VStack>
                                  <Button label="Open" variant="ghost" size="sm" icon={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />} isIconOnly onClick={openArtifact} />
                                </HStack>
                              </Card>
                            </ChatMessageBubble>
                          ) : null}
                        </ChatMessage>
                      )
                    )}
                  </>
                )}
              </ChatMessageList>
            </VStack>
          </ChatLayout>
        </VStack>
        {isArtifactOpen && (
          <>
            <ResizeHandle direction="horizontal" resizable={artifactResize.props} isReversed pillPlacement="start" hasDivider label="Resize artifact panel" className="ai-chat-resize-handle" />
            <Card variant="transparent" height="100%" className="ai-chat-artifact-panel" style={artifactPanelWidthVar(artifactResize.size)}>
              <Toolbar label="Artifact actions" dividers={['bottom']} startContent={<HStack gap={3} vAlign="center"><Icon icon={DocumentTextIcon} size="sm" color="secondary" /><VStack gap={0}><Text type="label" weight="semibold">{ARTIFACT_TITLE}</Text><Text type="supporting" color="secondary">{ARTIFACT_SUBTITLE}</Text></VStack></HStack>} endContent={<ArtifactActions onClose={() => setIsArtifactOpen(false)} />} />
              <ArtifactBody />
            </Card>
          </>
        )}
      </HStack></LayoutContent>}
      />
      <Dialog isOpen={isArtifactDialogOpen} onOpenChange={setIsArtifactDialogOpen} purpose="info" variant="fullscreen">
        <Layout header={<DialogHeader title={ARTIFACT_TITLE} subtitle={ARTIFACT_SUBTITLE} hasDivider onOpenChange={setIsArtifactDialogOpen} />} content={<LayoutContent padding={0}><ArtifactBody /></LayoutContent>} />
      </Dialog>
      <SessionPickerDialog />
      <ModelPickerDialog />
      <UserInputDialog />
      <ApprovalDialog />
    </VStack>
  );
};

const App = () => (
  <DialogProvider>
    <AppContent />
  </DialogProvider>
);

export default App;

const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
if (rootEl && !rootEl.hasAttribute('data-mounted')) {
  rootEl.setAttribute('data-mounted', 'true');
  createRoot(rootEl).render(
    <React.StrictMode>
      <Theme theme={neutralTheme}>
        <App />
      </Theme>
    </React.StrictMode>
  );
}
