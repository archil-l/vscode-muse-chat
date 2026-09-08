'use client';

import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
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
import type { ChatMsg, ToolCall, MuseStatus } from './components/types';
import { root, chatColumn, chatLayoutStyle, artifactScroll, artifactPanelWidthVar, ARTIFACT_TITLE, ARTIFACT_SUBTITLE } from './components/constants';
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

const App = () => {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [museStatus, setMuseStatus] = useState<MuseStatus | null>(null);
  const [isArtifactOpen] = useState(false);
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const [sessionPicker, setSessionPicker] = useState<unknown[] | null>(null);
  const [modelPicker, setModelPicker] = useState<unknown[] | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<unknown | null>(null);
  const [pendingApproval, setPendingApproval] = useState<unknown | null>(null);
  const [uiSelections, setUiSelections] = useState<Record<string, unknown>>({});
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
      if (msg.type === 'clear') { setMessages([]); setIsBusy(false); return; }
      if (msg.type === 'session_list') { setSessionPicker(msg.sessions ?? []); return; }
      if (msg.type === 'model_list') { setModelPicker(msg.models ?? msg.modelList ?? []); return; }
      if (msg.type === 'user_input_requested') { setPendingUserInput(msg); setUiSelections({}); return; }
      if (msg.type === 'approval_requested') { setPendingApproval(msg); return; }
      if (msg.type === 'replay_user') {
        const now = new Date().toISOString();
        setMessages((prev) => [...prev, { id: `u-replay-${Date.now()}`, role: 'user', content: String(msg.text ?? ''), timestamp: now }]);
        return;
      }
      if (msg.type === 'tool_call') {
        const incomingId = String(msg.id ?? msg.name ?? 'tool');
        const incomingName = String(msg.name ?? 'tool');
        const rawTarget = msg.args ? String(msg.args) : '';
        const incomingTarget = rawTarget ? rawTarget.slice(0, 180) : undefined;
        const incomingStatus: ToolCall['status'] = msg.status === 'error' ? 'error' : msg.status === 'done' ? 'complete' : 'running';
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          let toolCalls = last.toolCalls ?? [];
          const idx = toolCalls.findIndex((c) => c.id === incomingId);
          if (idx >= 0) {
            const existing = toolCalls[idx];
            const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
            toolCalls = [...toolCalls]; toolCalls[idx] = { ...existing, name: incomingName, target: mergedTarget, status: incomingStatus };
          } else {
            const runningIdx = toolCalls.findIndex((c) => c.name === incomingName && c.status === 'running');
            if (runningIdx >= 0 && incomingStatus === 'complete' && !incomingId.startsWith('generic-')) {
              const existing = toolCalls[runningIdx]; const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
              toolCalls = [...toolCalls]; toolCalls[runningIdx] = { ...existing, id: incomingId, target: mergedTarget, status: 'complete' };
            } else {
              toolCalls = [...toolCalls, { id: incomingId, name: incomingName, target: incomingTarget, status: incomingStatus }];
            }
          }
          next[next.length - 1] = { ...last, toolCalls };
          return next;
        });
        return;
      }
      if (msg.type === 'reasoning_start') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]; if (!last || last.role !== 'assistant') return prev;
          const next = [...prev]; next[next.length - 1] = { ...last, thinking: last.thinking ?? '', thinkingOpen: true }; return next;
        }); return;
      }
      if (msg.type === 'reasoning_delta') {
        const delta = String(msg.text ?? '');
        setMessages((prev) => {
          const last = prev[prev.length - 1]; if (!last || last.role !== 'assistant') return prev;
          const next = [...prev]; next[next.length - 1] = { ...last, thinking: (last.thinking ?? '') + delta, thinkingOpen: true }; return next;
        }); return;
      }
      if (msg.type === 'reasoning_end') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]; if (!last || last.role !== 'assistant') return prev;
          const next = [...prev]; next[next.length - 1] = { ...last, thinkingOpen: false }; return next;
        }); return;
      }
      if (msg.type === 'chunk') {
        const text = String(msg.text ?? ''); const done = Boolean(msg.done); const isError = Boolean(msg.isError); const isStderr = Boolean(msg.isStderr);
        setMessages((prev) => {
          let next = [...prev]; let last = next[next.length - 1];
          if (!last || last.role !== 'assistant' || (!last.isStreaming && last.content && done)) {
            last = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true };
            next.push(last);
          }
          let toolCalls = last.toolCalls;
          if (done && toolCalls && toolCalls.some((c) => c.status === 'running')) toolCalls = toolCalls.map((c) => (c.status === 'running' ? { ...c, status: 'complete' as const } : c));
          const updated: ChatMsg = { ...last, content: last.content + text, isStreaming: !done, isError: isError || last.isError, isStderr: isStderr || (last as unknown as { isStderr?: boolean }).isStderr, toolCalls, timestamp: new Date().toISOString() };
          next[next.length - 1] = updated; return next;
        });
        if (done) setIsBusy(false); else setIsBusy(true);
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
    setMessages((m) => [...m, userMsg, assistantMsg]); setIsBusy(true); setInput('');
    getVsCodeApi().postMessage({ type: 'send', text: trimmed });
  };

  const openArtifact = () => {
    const width = rootRef.current?.offsetWidth ?? Infinity;
    if (width <= MOBILE_MAX_WIDTH) setIsArtifactDialogOpen(true);
    else setIsArtifactOpen(true);
  };

  const conversationTitle = messages.find((m) => m.role === 'user')?.content.slice(0, 48) ?? 'New conversation • v0.1.1';
  const handleNewConversation = () => { setMessages([]); setIsBusy(false); getVsCodeApi().postMessage({ type: 'send', text: '/new' }); };
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
                          {m.content ? <ChatMessageBubble variant="ghost"><AssistantContent text={m.content} isStreaming={m.isStreaming} />{m.isError && <Text type="supporting" color="negative" style={{ marginTop: 8 } as CSSProperties}>Error</Text>}</ChatMessageBubble> : m.isStreaming ? <ChatMessageBubble variant="ghost"><Text type="supporting" color="secondary">Thinking…</Text></ChatMessageBubble> : null}
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
      <SessionPickerDialog sessions={sessionPicker as unknown as { sessionId: string; title?: string; updatedAt?: number; workspaceRoot?: string }[] | null} onClose={() => setSessionPicker(null)} />
      <ModelPickerDialog models={modelPicker} onClose={() => setModelPicker(null)} />
      <UserInputDialog pendingUserInput={pendingUserInput as unknown as Parameters<typeof UserInputDialog>[0]['pendingUserInput']} uiSelections={uiSelections} setUiSelections={setUiSelections} onClose={() => setPendingUserInput(null)} />
      <ApprovalDialog pendingApproval={pendingApproval as unknown as Parameters<typeof ApprovalDialog>[0]['pendingApproval']} onClose={() => setPendingApproval(null)} />
    </VStack>
  );
};

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
