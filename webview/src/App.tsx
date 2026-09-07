'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HStack, VStack, StackItem, Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Text, Heading } from '@astryxdesign/core/Text';
import {
  ChatComposer,
  ChatComposerInput,
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
import { Token } from '@astryxdesign/core/Token';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';
import { createStaticSource } from '@astryxdesign/core/Typeahead';
import { TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { SearchableItem } from '@astryxdesign/core/Typeahead';
import type { ChatComposerTrigger } from '@astryxdesign/core/Chat';

import {
  DocumentTextIcon,
  ClipboardDocumentIcon,
  ShareIcon,
  XMarkIcon,
  ChevronRightIcon,
  SparklesIcon,
  CommandLineIcon,
  BeakerIcon,
  ClockIcon,
  PencilSquareIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

import katex from 'katex';
import { getVsCodeApi } from './vscode';

// ---------- VS Code bridge types ----------
type ToolCall = {
  id?: string;
  name: string;
  target?: string;
  status: 'running' | 'complete' | 'error';
  duration?: string;
  additions?: number;
  deletions?: number;
  node?: string;
};

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  isError?: boolean;
  isStderr?: boolean;
  toolCalls?: ToolCall[];
  thinking?: string;
  thinkingOpen?: boolean;
};

// ---------- LaTeX inline plugins for Astryx Markdown ----------
const mathPlugins = [
  {
    pattern: /\$\$([\s\S]+?)\$\$/g,
    render: (match: RegExpMatchArray, key: number) => {
      try {
        const html = katex.renderToString(match[1], { displayMode: true, throwOnError: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <span key={key}>{match[0]}</span>;
      }
    },
  },
  {
    pattern: /\$([^$\n]+?)\$/g,
    render: (match: RegExpMatchArray, key: number) => {
      try {
        const html = katex.renderToString(match[1], { displayMode: false, throwOnError: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <span key={key}>{match[0]}</span>;
      }
    },
  },
];

// ---------- Layout constants (from template) ----------
const MOBILE_MAX_WIDTH = 767;

const root: CSSProperties = {
  height: '100vh',
  width: '100%',
  containerType: 'inline-size',
  containerName: 'artifact',
};
const chatColumn: CSSProperties = { flex: 1, width: '100%', minWidth: 0, height: '100%' };
const chatLayoutStyle: CSSProperties = { flex: 1, minHeight: 0 };
const artifactScroll: CSSProperties = { flex: 1, overflowY: 'auto' };
const articleBody: CSSProperties = { maxWidth: 720, marginInline: 'auto' };
const artifactPanelWidthVar = (size: number | string): CSSProperties =>
  ({ '--artifact-panel-width': typeof size === 'number' ? `${size}px` : size }) as CSSProperties;

const AI_CHAT_CSS = `
.ai-chat-resize-handle { display: flex; }
.ai-chat-artifact-panel { overflow: hidden; display: flex; flex-direction: column; width: var(--artifact-panel-width); flex-shrink: 0; }
@container artifact (max-width: ${MOBILE_MAX_WIDTH}px) {
  .ai-chat-resize-handle { display: none; }
  .ai-chat-artifact-panel { display: none; width: 100%; flex-shrink: 1; }
}
/* Slash menu: show more than 4 items */
div[role="listbox"] { max-height: 320px !important; overflow-y: auto !important; }
div[role="listbox"] > div[role="group"] { max-height: none; }
/* Professional header + thinner typography — VS Code theme aware, no raw #fff */
#muse-header { height: 36px; min-height: 36px; display:flex; align-items:center; justify-content:space-between; padding:0 8px 0 12px; border-bottom:1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, var(--color-border, #e5e7eb))); background: var(--vscode-sideBar-background, var(--color-background, transparent)); color: var(--vscode-foreground, var(--color-foreground, inherit)); }
#muse-header-title { font-size:12.5px; font-weight:500; letter-spacing:0.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.92; color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground, currentColor)); }
#muse-header-actions { display:flex; gap:4px; }
.muse-icon-btn { width:26px; height:26px; display:grid; place-items:center; border:none; background:transparent; border-radius:6px; cursor:pointer; opacity:0.72; color: var(--vscode-icon-foreground, var(--vscode-foreground, currentColor)); }
.muse-icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, var(--color-background-lo, #f3f4f6))); opacity:1; }
.muse-icon-btn svg { width:15px; height:15px; stroke-width:1.5; }
/* thinner fonts globally */
body, .astryx-text, .astryx-heading { font-weight:380 !important; letter-spacing:0.01em; -webkit-font-smoothing:antialiased; }
.astryx-text--supporting { font-size:12px !important; }
#muse-header, .astryx-chat-composer { font-size:12.5px !important; }
/* Send button: compact */
button[aria-label="Send"], button:has(svg[data-icon="paper-airplane"]) { width:28px !important; height:28px !important; border-radius:8px !important; }
`;

// ---------- Artifact demo content (kept from template) ----------
const ARTIFACT_TITLE = 'JWT Token Refresh: Design & Rollout';
const ARTIFACT_SUBTITLE = 'Document · Updated just now';
const ARTIFACT_CONTENT = `## Overview

Our API gateway authenticates every request with a short-lived JWT access token. Until now, an expired token meant an immediate \`401\` — even when the user still held a valid refresh token. This document describes the silent-refresh flow we just shipped and how we're rolling it out.

## The Problem

Token validation ran **before** any refresh logic, so the middleware rejected expired tokens outright:

1. A request arrives with an expired access token
2. \`validateToken()\` throws \`TokenExpiredError\`
3. The catch block returns \`401\` — \`refreshToken()\` is never reached

## The Fix

The middleware now catches \`TokenExpiredError\` specifically and attempts a silent refresh before rejecting. On success it reissues an access token and continues the request; on failure it falls back to \`401\`.

- **Transparent** — valid sessions never see an interruption
- **Safe** — a missing or invalid refresh token still returns \`401\`
- **Cheap** — refresh only runs on the expiry path, not on every request

## Testing

| Scenario | Expected |
|----------|----------|
| Valid token passes through | \`200\` |
| Expired token, valid refresh | \`200\` + new access token |
| Expired token, invalid refresh | \`401\` |
| Malformed token | \`401\` |

## Rollout & Monitoring

1. Ship behind the \`silent_refresh\` flag at 5% of traffic
2. Watch the \`auth.refresh.success\` and \`auth.refresh.failure\` counters
3. Alert if the failure rate exceeds **2%** over any 5-minute window
4. Ramp to 100% once metrics hold steady for 24 hours`;

function ArtifactBody() {
  return (
    <VStack gap={2} style={{ ...artifactScroll, padding: 20, maxWidth: 720, marginInline: 'auto', overflowY: 'auto' } as CSSProperties}>
      <Heading level={1}>{ARTIFACT_TITLE}</Heading>
      <Text type="supporting" color="secondary">{ARTIFACT_SUBTITLE}</Text>
      <Markdown density="compact" inlinePlugins={mathPlugins as never}>{ARTIFACT_CONTENT}</Markdown>
    </VStack>
  );
}

function ArtifactActions({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <DropdownMenu button={{ label: 'v2', variant: 'ghost', size: 'sm' }} items={[{ label: 'v2 (current)' }, { label: 'v1' }]} />
      <Button label="Copy" variant="ghost" size="sm" icon={<Icon icon={ClipboardDocumentIcon} size="sm" />} isIconOnly />
      <Button label="Share" variant="ghost" size="sm" icon={<Icon icon={ShareIcon} size="sm" />} isIconOnly />
      {onClose && <Button label="Close" variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} isIconOnly onClick={onClose} />}
    </>
  );
}

// Helper: render assistant content with refined typography
function AssistantContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) return null;
  return (
    <Markdown
      density="default"
      headingLevelStart={3}
      contentWidth={680}
      isStreaming={isStreaming}
      inlinePlugins={mathPlugins as never}
    >
      {text}
    </Markdown>
  );
}

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
// debug: verify slash commands are loaded
if (typeof window !== 'undefined') {
  console.log('[muse-chat] SLASH_COMMANDS', SLASH_COMMANDS.map(c=>c.label));
}

export default function App() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isArtifactOpen] = useState(false);
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const [sessionPicker, setSessionPicker] = useState<any[] | null>(null);
  const [modelPicker, setModelPicker] = useState<any[] | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<any | null>(null);
  const [pendingApproval, setPendingApproval] = useState<any | null>(null);
  // per-question selection state for userInput dialog
  const [uiSelections, setUiSelections] = useState<Record<string, any>>({});
  const rootRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const listRef = useRef<HTMLDivElement>(null);

  const slashTrigger: ChatComposerTrigger = {
    character: '/',
    searchSource: slashCommandSource,
    renderItem: (item) => (
      <TypeaheadItem item={item} description={(item.auxiliaryData as { description: string })?.description} />
    ),
    onSelect: (item) => ({
      value: `/${item.label}`,
      label: `/${item.label}`,
      variant: 'yellow' as const,
    }),
  };

  const artifactResize = useResizable({ defaultSize: 560, minSizePx: 400, maxSizePx: 860, autoSaveId: 'ai-chat-artifact-panel' });

  // auto-scroll
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // VS Code message handler
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'clear') {
        setMessages([]);
        setIsBusy(false);
        return;
      }
      if (msg.type === 'session_list') {
        setSessionPicker(msg.sessions ?? []);
        return;
      }
      if (msg.type === 'model_list') {
        setModelPicker(msg.models ?? msg.modelList ?? []);
        return;
      }
      if (msg.type === 'user_input_requested') {
        setPendingUserInput(msg);
        setUiSelections({});
        return;
      }
      if (msg.type === 'approval_requested') {
        setPendingApproval(msg);
        return;
      }
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
        const incomingStatus: ToolCall['status'] =
          msg.status === 'error' ? 'error' : msg.status === 'done' ? 'complete' : 'running';
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          let toolCalls = last.toolCalls ?? [];
          const idx = toolCalls.findIndex((c) => c.id === incomingId);
          if (idx >= 0) {
            const existing = toolCalls[idx];
            const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
            const updatedCall: ToolCall = {
              ...existing,
              name: incomingName,
              target: mergedTarget,
              status: incomingStatus,
            };
            toolCalls = [...toolCalls];
            toolCalls[idx] = updatedCall;
          } else {
            // Fallback: if a running call with same name exists and incoming is complete, transition it
            const runningIdx = toolCalls.findIndex((c) => c.name === incomingName && c.status === 'running');
            if (runningIdx >= 0 && incomingStatus === 'complete' && !incomingId.startsWith('generic-')) {
              const existing = toolCalls[runningIdx];
              const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
              toolCalls = [...toolCalls];
              toolCalls[runningIdx] = { ...existing, id: incomingId, target: mergedTarget, status: 'complete' };
            } else {
              const call: ToolCall = {
                id: incomingId,
                name: incomingName,
                target: incomingTarget,
                status: incomingStatus,
              };
              toolCalls = [...toolCalls, call];
            }
          }
          next[next.length - 1] = { ...last, toolCalls };
          return next;
        });
        return;
      }
      if (msg.type === 'reasoning_start') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          next[next.length - 1] = { ...last, thinking: last.thinking ?? '', thinkingOpen: true };
          return next;
        });
        return;
      }
      if (msg.type === 'reasoning_delta') {
        const delta = String(msg.text ?? '');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          next[next.length - 1] = { ...last, thinking: (last.thinking ?? '') + delta, thinkingOpen: true };
          return next;
        });
        return;
      }
      if (msg.type === 'reasoning_end') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          next[next.length - 1] = { ...last, thinkingOpen: false };
          return next;
        });
        return;
      }
      if (msg.type === 'chunk') {
        const text = String(msg.text ?? '');
        const done = Boolean(msg.done);
        const isError = Boolean(msg.isError);
        const isStderr = Boolean(msg.isStderr);

        setMessages((prev) => {
          let next = [...prev];
          let last = next[next.length - 1];
          // Ensure assistant message exists
          if (!last || last.role !== 'assistant' || (!last.isStreaming && last.content && done)) {
            // Should have been created on send; create fallback
            last = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true };
            next.push(last);
          }
          // Mark any still-running tool calls as complete when stream ends (prevents stuck spinner)
          let toolCalls = last.toolCalls;
          if (done && toolCalls && toolCalls.some((c) => c.status === 'running')) {
            toolCalls = toolCalls.map((c) => (c.status === 'running' ? { ...c, status: 'complete' as const } : c));
          }
          // Append text to last assistant
          const updated: ChatMsg = {
            ...last,
            content: last.content + text,
            isStreaming: !done,
            isError: isError || last.isError,
            isStderr: isStderr || (last as unknown as { isStderr?: boolean }).isStderr,
            toolCalls,
            timestamp: new Date().toISOString(),
          };
          next[next.length - 1] = updated;
          return next;
        });
        if (done) setIsBusy(false);
        else setIsBusy(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    const now = new Date().toISOString();
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed, timestamp: now };
    const assistantMsg: ChatMsg = { id: `a-${Date.now() + 1}`, role: 'assistant', content: '', timestamp: now, isStreaming: true, toolCalls: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setIsBusy(true);
    setInput('');
    getVsCodeApi().postMessage({ type: 'send', text: trimmed });
  };

  const openArtifact = () => {
    const width = rootRef.current?.offsetWidth ?? Infinity;
    if (width <= MOBILE_MAX_WIDTH) setIsArtifactDialogOpen(true);
    else setIsArtifactOpen(true);
  };

  const suggestions = [
    { label: 'Explain this codebase', icon: CommandLineIcon, hint: 'Explain this codebase structure' },
    { label: 'Write a function', icon: BeakerIcon, hint: 'Write a function to debounce input in TypeScript' },
    { label: 'Debug help', icon: SparklesIcon, hint: 'Help me debug an error: `Cannot read property of undefined`' },
  ];

  // derive conversation title from first user message — v0.1.1 (Ask anything)
  const conversationTitle = messages.find(m=>m.role==='user')?.content.slice(0,48) ?? 'New conversation • v0.1.1';
  const handleNewConversation = () => {
    setMessages([]); setIsBusy(false);
    getVsCodeApi().postMessage({ type:'send', text:'/new' });
  };
  const handleHistory = () => {
    getVsCodeApi().postMessage({ type:'session_list_request' });
    // also trigger slash picker via extension
    getVsCodeApi().postMessage({ type:'send', text:'/resume' });
  };

  return (
    <VStack ref={rootRef as never} style={root}>
      <style>{AI_CHAT_CSS}</style>
      {/* Professional header: title + history + new */}
      <div id="muse-header" role="banner">
        <div style={{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1} as CSSProperties}>
          <div style={{width:5, height:5, borderRadius:5, background:'#2ea043', flexShrink:0, opacity:0.9} as CSSProperties} />
          <div id="muse-header-title" title={conversationTitle}>{conversationTitle.length>48 ? conversationTitle.slice(0,47)+'…' : conversationTitle}</div>
        </div>
        <div id="muse-header-actions">
          <button className="muse-icon-btn" aria-label="History" title="History" onClick={handleHistory}>
            <Icon icon={ClockIcon} size="sm" />
          </button>
          <button className="muse-icon-btn" aria-label="New conversation" title="New conversation" onClick={handleNewConversation}>
            <Icon icon={PencilSquareIcon} size="sm" />
          </button>
        </div>
      </div>
      <Layout height="fill" content={<LayoutContent padding={0}><HStack height="100%">
        {/* Chat column */}
        <VStack style={chatColumn}>
          <ChatLayout
            density="spacious"
            style={chatLayoutStyle}
            composer={
              <ChatComposer
                onSubmit={(value: string) => send(value)}
                placeholder="Ask anything — type / for commands"
                input={<ChatComposerInput value={input} onChange={(e: unknown) => setInput(e as string)} onSubmit={(v: string) => send(v)} triggers={[slashTrigger]} />}
              />
            }
          >
            <div ref={listRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              <ChatMessageList>
                {messages.length === 0 ? (
                  <>
                    <ChatSystemMessage variant="divider">Today</ChatSystemMessage>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 20px', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
                      <VStack gap={2} style={{ alignItems: 'center' } as CSSProperties}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--color-background-lo)', border: '1px solid var(--color-border)' }}>
                          <Icon icon={SparklesIcon} size="md" />
                        </div>
                        <Heading level={3}>How can I help?</Heading>
                        <Text type="supporting" color="secondary" style={{ textAlign: 'center' } as CSSProperties}>
                          Ask anything — code, ideas, or quick questions. Math like <span dangerouslySetInnerHTML={{ __html: katex.renderToString('E=mc^2', { throwOnError: false }) }} /> renders inline.
                        </Text>
                      </VStack>
                      <HStack gap={2} wrap="wrap" style={{ justifyContent: 'center' } as CSSProperties}>
                        {suggestions.map((s) => (
                          <Button key={s.label} label={s.label} variant="secondary" size="sm" icon={<Icon icon={s.icon} size="sm" />} onClick={() => send(s.hint)} />
                        ))}
                      </HStack>
                      <HStack gap={1} wrap="wrap" style={{ justifyContent: 'center', opacity: 0.85 } as CSSProperties}>
                        <Token label="auth-service.ts" />
                        <Token label="middleware.ts" />
                        <Text type="supporting" color="secondary">try: “review these auth files”</Text>
                      </HStack>
                    </div>
                  </>
                ) : (
                  <>
                    <ChatSystemMessage variant="divider">Today</ChatSystemMessage>
                    {messages.map((m) =>
                      m.role === 'user' ? (
                        <ChatMessage key={m.id} sender="user">
                          <ChatMessageBubble
                            metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.timestamp} format="time" />} />}
                          >
                            <Markdown density="default" headingLevelStart={3} contentWidth={640} inlinePlugins={mathPlugins as never}>{m.content}</Markdown>
                          </ChatMessageBubble>
                        </ChatMessage>
                      ) : (
                        <ChatMessage key={m.id} sender="assistant">
                          {m.thinking ? (
                            <ChatToolCalls
                              defaultIsExpanded={m.thinkingOpen}
                              calls={[{ name: 'thinking', target: m.thinking.slice(0, 80), status: m.thinkingOpen ? 'running' : 'complete' }]}
                            />
                          ) : null}
                          {m.thinking && m.thinkingOpen ? (
                            <ChatMessageBubble variant="ghost">
                              <Text type="supporting" color="secondary" style={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' } as CSSProperties}>{m.thinking}</Text>
                            </ChatMessageBubble>
                          ) : null}
                          {m.toolCalls && m.toolCalls.length > 0 && (
                            <ChatToolCalls
                              defaultIsExpanded
                              calls={m.toolCalls.map((c) => ({
                                name: c.name,
                                target: c.target ?? '',
                                status: c.status === 'running' ? 'running' : c.status === 'complete' ? 'complete' : 'error',
                                duration: c.duration,
                              }))}
                            />
                          )}
                          {m.content ? (
                            <ChatMessageBubble variant="ghost">
                              <AssistantContent text={m.content} isStreaming={m.isStreaming} />
                              {m.isError && (
                                <Text type="supporting" color="negative" style={{ marginTop: 8 } as CSSProperties}>Error</Text>
                              )}
                            </ChatMessageBubble>
                          ) : m.isStreaming ? (
                            <ChatMessageBubble variant="ghost">
                              <Text type="supporting" color="secondary">Thinking…</Text>
                            </ChatMessageBubble>
                          ) : null}
                          {!m.isStreaming && (
                            <ChatMessageMetadata
                              timestamp={<Timestamp value={m.timestamp} format="time" />}
                              footer={<Text type="supporting" color="secondary">Muse</Text>}
                            />
                          )}
                          {/* Show artifact card when assistant mentions document */}
                          {m.content.includes('ARTIFACT') || m.content.includes('design doc') ? (
                            <ChatMessageBubble variant="ghost" width="100%">
                              <Card variant="muted" padding={3} style={{ maxWidth: 380 } as CSSProperties}>
                                <HStack gap={3} vAlign="center" width="100%">
                                  <Icon icon={DocumentTextIcon} size="md" color="secondary" />
                                  <StackItem size="fill">
                                    <VStack gap={0}>
                                      <Text type="label" weight="semibold">{ARTIFACT_TITLE}</Text>
                                      <Text type="supporting" color="secondary">Document</Text>
                                    </VStack>
                                  </StackItem>
                                  <Button label="Open" variant="ghost" size="sm" icon={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />} isIconOnly onClick={openArtifact} />
                                </HStack>
                              </Card>
                            </ChatMessageBubble>
                          ) : null}
                        </ChatMessage>
                      )
                    )}
                    {/* Artifact card broadcast when artifact is available */}
                    {isArtifactOpen || messages.some((m) => m.content.includes('token-refresh')) ? null : null}
                  </>
                )}
              </ChatMessageList>
            </div>
          </ChatLayout>
        </VStack>

        {/* Desktop artifact panel */}
        {isArtifactOpen && (
          <>
            <ResizeHandle direction="horizontal" resizable={artifactResize.props} isReversed pillPlacement="start" hasDivider label="Resize artifact panel" className="ai-chat-resize-handle" />
            <Card variant="transparent" height="100%" className="ai-chat-artifact-panel" style={artifactPanelWidthVar(artifactResize.size)}>
              <Toolbar
                label="Artifact actions"
                dividers={['bottom']}
                startContent={
                  <HStack gap={3} vAlign="center">
                    <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
                    <VStack gap={0}>
                      <Text type="label" weight="semibold">{ARTIFACT_TITLE}</Text>
                      <Text type="supporting" color="secondary">{ARTIFACT_SUBTITLE}</Text>
                    </VStack>
                  </HStack>
                }
                endContent={<ArtifactActions onClose={() => setIsArtifactOpen(false)} />}
              />
              <ArtifactBody />
            </Card>
          </>
        )}
      </HStack></LayoutContent>}
      />
      {/* Mobile dialog */}
      <Dialog isOpen={isArtifactDialogOpen} onOpenChange={setIsArtifactDialogOpen} purpose="info" variant="fullscreen">
        <Layout header={<DialogHeader title={ARTIFACT_TITLE} subtitle={ARTIFACT_SUBTITLE} hasDivider onOpenChange={setIsArtifactDialogOpen} />} content={<LayoutContent padding={0}><ArtifactBody /></LayoutContent>} />
      </Dialog>

      {/* Session picker for /resume */}
      <Dialog isOpen={!!sessionPicker} onOpenChange={(o)=> !o && setSessionPicker(null)} purpose="info" variant="default">
        <Layout header={<DialogHeader title="Resume session" subtitle={`${sessionPicker?.length ?? 0} recent sessions`} hasDivider onOpenChange={(o)=> !o && setSessionPicker(null)} />} content={
          <LayoutContent padding={4}>
            <VStack gap={2}>
              {sessionPicker?.length === 0 && <Text type="supporting" color="secondary">No sessions</Text>}
              {sessionPicker?.map((s:any)=> (
                <Card key={s.sessionId} variant="muted" padding={3} style={{cursor:'pointer'} as CSSProperties} onClick={()=>{
                  getVsCodeApi().postMessage({ type:'session_pick', sessionId: s.sessionId });
                  setSessionPicker(null);
                }}>
                  <VStack gap={1}>
                    <Text type="label" weight="semibold" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'} as CSSProperties}>{s.title || 'Untitled'}</Text>
                    <Text type="supporting" color="secondary" style={{fontSize:'11px'} as CSSProperties}>{s.sessionId?.slice(0,8)} · {s.workspaceRoot ?? ''} {s.updatedAt ? '· ' + new Date(Number(String(s.updatedAt).length>10 ? s.updatedAt/1000 : s.updatedAt*1000)).toLocaleString() : ''}</Text>
                  </VStack>
                </Card>
              ))}
              <Button label="Cancel" variant="ghost" size="sm" onClick={()=> setSessionPicker(null)} />
            </VStack>
          </LayoutContent>
        } />
      </Dialog>

      {/* Model picker */}
      <Dialog isOpen={!!modelPicker} onOpenChange={(o)=> !o && setModelPicker(null)} purpose="info" variant="default">
        <Layout header={<DialogHeader title="Select model" subtitle={`${modelPicker?.length ?? 0} models`} hasDivider onOpenChange={(o)=> !o && setModelPicker(null)} />} content={
          <LayoutContent padding={4}>
            <VStack gap={2}>
              {modelPicker?.map((m:any)=> {
                const id = m.id ?? m.modelId ?? m.model_id ?? String(m);
                const label = m.displayName ?? m.label ?? id;
                return (
                  <Card key={id} variant="muted" padding={3} style={{cursor:'pointer'} as CSSProperties} onClick={()=>{
                    getVsCodeApi().postMessage({ type:'model_pick', modelId: id });
                    setModelPicker(null);
                  }}>
                    <VStack gap={0}>
                      <Text type="label" weight="semibold">{label}</Text>
                      <Text type="supporting" color="secondary">{id}</Text>
                    </VStack>
                  </Card>
                );
              })}
              <Button label="Cancel" variant="ghost" size="sm" onClick={()=> setModelPicker(null)} />
            </VStack>
          </LayoutContent>
        } />
      </Dialog>

      {/* UserInput questions — interactive prompts from model */}
      <Dialog isOpen={!!pendingUserInput} onOpenChange={(o)=> !o && setPendingUserInput(null)} purpose="info" variant="default">
        {pendingUserInput && (
          <Layout header={<DialogHeader title={pendingUserInput.toolName ? `Input: ${pendingUserInput.toolName}` : 'Question'} subtitle={pendingUserInput.questions?.length ? `${pendingUserInput.questions.length} question(s)` : undefined} hasDivider onOpenChange={(o)=> !o && setPendingUserInput(null)} />} content={
            <LayoutContent padding={4}>
              <VStack gap={4}>
                {pendingUserInput.questions?.map((q:any)=> (
                  <VStack key={q.id} gap={2} style={{border:'1px solid var(--color-border)', borderRadius:8, padding:12} as CSSProperties}>
                    <Text type="label" weight="semibold" color="secondary" style={{fontSize:'11px', letterSpacing:'0.04em', textTransform:'uppercase'} as CSSProperties}>{q.header}</Text>
                    <Text type="body" weight="medium">{q.question}</Text>
                    <VStack gap={1}>
                      {q.options?.map((opt:any)=> {
                        const isSingle = q.selection?.mode === 'single';
                        const selected = uiSelections[q.id];
                        const isSelected = isSingle ? selected === opt.label : Array.isArray(selected) && selected.includes(opt.label);
                        return (
                          <Card key={opt.label} variant={isSelected ? 'selected' as any : 'muted'} padding={2} style={{cursor:'pointer', borderColor: isSelected ? 'var(--color-border-strong)' : undefined} as CSSProperties} onClick={()=>{
                            if(isSingle){
                              setUiSelections(prev=> ({...prev, [q.id]: opt.label}));
                            } else {
                              setUiSelections(prev=> {
                                const cur:string[] = Array.isArray(prev[q.id]) ? prev[q.id] : [];
                                const next = cur.includes(opt.label) ? cur.filter(x=> x!==opt.label) : [...cur, opt.label];
                                // enforce max
                                const max = q.selection?.maxSelections;
                                if(max && next.length>max) return prev;
                                return {...prev, [q.id]: next};
                              });
                            }
                          }}>
                            <HStack gap={2} vAlign="center">
                              <div style={{width:16, height:16, borderRadius: isSingle ? 8 : 4, border:'1px solid var(--color-border)', background: isSelected ? 'var(--color-background-selected)' : 'transparent', display:'grid', placeItems:'center'} as CSSProperties}>
                                {isSelected && <span style={{width:8, height:8, borderRadius: isSingle?4:2, background:'var(--color-foreground)'} as CSSProperties} />}
                              </div>
                              <VStack gap={0} style={{flex:1} as CSSProperties}>
                                <Text type="label">{opt.label}</Text>
                                {opt.description && <Text type="supporting" color="secondary" style={{fontSize:'11px'} as CSSProperties}>{opt.description}</Text>}
                              </VStack>
                            </HStack>
                          </Card>
                        );
                      })}
                    </VStack>
                    {/* free text fallback */}
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary" style={{fontSize:'11px'} as CSSProperties}>Or free text (max 500)</Text>
                      <input
                        style={{width:'100%', padding:'8px', borderRadius:6, border:'1px solid var(--color-border)', background:'var(--color-background)', fontSize:'12px'}}
                        placeholder="Type answer…"
                        value={typeof uiSelections[q.id]==='string' && !q.options?.some((o:any)=> o.label===uiSelections[q.id]) ? uiSelections[q.id] : (Array.isArray(uiSelections[q.id]) ? '' : '')}
                        onChange={(e)=>{
                          const v=e.target.value;
                          // if options exist, free text overrides selection
                          setUiSelections(prev=> ({...prev, [q.id]: v}));
                        }}
                      />
                    </VStack>
                  </VStack>
                ))}
                <HStack gap={2} style={{justifyContent:'flex-end'} as CSSProperties}>
                  <Button label="Cancel" variant="ghost" size="sm" onClick={()=>{
                    getVsCodeApi().postMessage({ type:'user_input_answer', userInputId: pendingUserInput.userInputId, sessionId: pendingUserInput.sessionId, answers: [] });
                    // also need to handle cancel via userInput/cancel — send empty with cancel semantics
                    getVsCodeApi().postMessage({ type:'approval_decide', approvalId: pendingUserInput.userInputId, sessionId: pendingUserInput.sessionId } as any);
                    setPendingUserInput(null);
                  }} />
                  <Button label="Submit" variant="primary" size="sm" onClick={()=>{
                    const answers = pendingUserInput.questions.map((q:any)=>{
                      const sel = uiSelections[q.id];
                      if(Array.isArray(sel)){
                        return { questionId: q.id, selectedLabels: sel };
                      } else if(typeof sel === 'string' && q.options?.some((o:any)=> o.label===sel)){
                        return { questionId: q.id, selectedLabel: sel };
                      } else if(typeof sel === 'string' && sel.trim()){
                        return { questionId: q.id, freeText: sel.slice(0,500) };
                      } else {
                        // default to first option if required
                        if(q.selection?.mode==='single' && q.options?.[0]) return { questionId: q.id, selectedLabel: q.options[0].label };
                        return { questionId: q.id, freeText: '' };
                      }
                    });
                    getVsCodeApi().postMessage({ type:'user_input_answer', userInputId: pendingUserInput.userInputId, sessionId: pendingUserInput.sessionId, answers });
                    setPendingUserInput(null);
                  }} />
                </HStack>
              </VStack>
            </LayoutContent>
          } />
        )}
      </Dialog>

      {/* Approval dialog */}
      <Dialog isOpen={!!pendingApproval} onOpenChange={(o)=> !o && setPendingApproval(null)} purpose="info" variant="default">
        {pendingApproval && (
          <Layout header={<DialogHeader title={`Approval: ${pendingApproval.toolName ?? 'tool'}`} subtitle={pendingApproval.subject?.kind ? `${pendingApproval.subject.kind}${pendingApproval.subject.command ? ' — '+pendingApproval.subject.command.slice(0,80) : ''}` : undefined} hasDivider onOpenChange={(o)=> !o && setPendingApproval(null)} />} content={
            <LayoutContent padding={4}>
              <VStack gap={3}>
                {pendingApproval.subject && (
                  <Card variant="muted" padding={3}>
                    <VStack gap={1}>
                      {pendingApproval.subject.command && <Text type="body" style={{fontFamily:'var(--font-mono)', fontSize:'11px', whiteSpace:'pre-wrap'} as CSSProperties}>{pendingApproval.subject.command}</Text>}
                      {pendingApproval.subject.path && <Text type="supporting" color="secondary">Path: {pendingApproval.subject.path}</Text>}
                      {pendingApproval.subject.target && <Text type="supporting" color="secondary">Target: {pendingApproval.subject.target}</Text>}
                      {pendingApproval.subject.host && <Text type="supporting" color="secondary">Host: {pendingApproval.subject.host}{pendingApproval.subject.port ? ':'+pendingApproval.subject.port : ''}</Text>}
                    </VStack>
                  </Card>
                )}
                <VStack gap={2}>
                  {pendingApproval.choices?.map((c:any)=> (
                    <Button key={c.choiceId} label={c.label} variant={c.decision==='allow' ? 'primary' as any : 'secondary'} size="sm" onClick={()=>{
                      getVsCodeApi().postMessage({ type:'approval_decide', approvalId: pendingApproval.approvalId, choiceId: c.choiceId, sessionId: pendingApproval.sessionId });
                      setPendingApproval(null);
                    }} />
                  ))}
                  {!pendingApproval.choices?.length && <Text type="supporting" color="secondary">No choices</Text>}
                </VStack>
                <Button label="Dismiss" variant="ghost" size="sm" onClick={()=> setPendingApproval(null)} />
              </VStack>
            </LayoutContent>
          } />
        )}
      </Dialog>
    </VStack>
  );
}
