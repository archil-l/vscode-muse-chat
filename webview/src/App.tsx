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
import { Avatar } from '@astryxdesign/core/Avatar';
import { Card } from '@astryxdesign/core/Card';
import { Markdown } from '@astryxdesign/core/Markdown';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';

import {
  DocumentTextIcon,
  ClipboardDocumentIcon,
  ShareIcon,
  AtSymbolIcon,
  PaperClipIcon,
  XMarkIcon,
  ChevronRightIcon,
  SparklesIcon,
  CommandLineIcon,
  BeakerIcon,
} from '@heroicons/react/24/outline';

import katex from 'katex';
import { getVsCodeApi } from './vscode';

// ---------- VS Code bridge types ----------
type ToolCall = {
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

// Helper: render assistant content with Markdown + LaTeX + CodeBlock split
function AssistantContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) return null;
  // If text contains a fenced code block, render Markdown will handle it via CodeBlock automatically
  // We keep a single Markdown; Astryx Markdown already renders code blocks with styling
  return <Markdown density="compact" isStreaming={isStreaming} inlinePlugins={mathPlugins as never}>{text}</Markdown>;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [composerMode, setComposerMode] = useState<'ask' | 'edit'>('ask');
  const [isArtifactOpen, setIsArtifactOpen] = useState(false);
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const listRef = useRef<HTMLDivElement>(null);

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
      if (msg.type === 'tool_call') {
        const call: ToolCall = {
          name: String(msg.name ?? 'tool'),
          target: msg.args ? String(msg.args).slice(0, 120) : undefined,
          status: msg.status === 'error' ? 'error' : msg.status === 'done' ? 'complete' : 'running',
          duration: undefined,
        };
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          const updated: ChatMsg = {
            ...last,
            toolCalls: [...(last.toolCalls ?? []), call],
          };
          // update existing running call to done, or append
          // If last tool call with same name+target exists and is running, replace it
          const existingIdx = (last.toolCalls ?? []).findIndex((c) => c.name === call.name && c.target === call.target && c.status === 'running');
          if (existingIdx >= 0 && call.status === 'complete') {
            const tc = [...(last.toolCalls ?? [])];
            tc[existingIdx] = { ...tc[existingIdx], status: 'complete' };
            updated.toolCalls = tc;
          }
          next[next.length - 1] = updated;
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
          // Append text to last assistant
          const updated: ChatMsg = {
            ...last,
            content: last.content + text,
            isStreaming: !done,
            isError: isError || last.isError,
            isStderr: isStderr || (last as unknown as { isStderr?: boolean }).isStderr,
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

  return (
    <VStack ref={rootRef as never} style={root}>
      <style>{AI_CHAT_CSS}</style>
      <Layout height="fill" content={<LayoutContent padding={0}><HStack height="100%">
        {/* Chat column */}
        <VStack style={chatColumn}>
          <ChatLayout
            density="spacious"
            style={chatLayoutStyle}
            composer={
              <ChatComposer
                onSubmit={(value: string) => send(value)}
                placeholder="Message Muse — type / for commands"
                input={<ChatComposerInput value={input} onChange={(e: unknown) => setInput(e as string)} onSubmit={(v: string) => send(v)} />}
                headerActions={
                  <>
                    <Button label="Mention" variant="ghost" size="sm" icon={<Icon icon={AtSymbolIcon} size="sm" />} isIconOnly />
                    <Button label="Attach" variant="ghost" size="sm" icon={<Icon icon={PaperClipIcon} size="sm" />} isIconOnly />
                    {isArtifactOpen && (
                      <Button label="Show artifact" variant="ghost" size="sm" icon={<Icon icon={DocumentTextIcon} size="sm" />} onClick={openArtifact} />
                    )}
                  </>
                }
                footerActions={
                  <DropdownMenu
                    button={{ label: composerMode === 'ask' ? 'Ask' : 'Edit', variant: 'ghost', size: 'sm' }}
                    items={[
                      { label: 'Ask', onClick: () => setComposerMode('ask') },
                      { label: 'Edit', onClick: () => setComposerMode('edit') },
                    ]}
                  />
                }
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
                            metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.timestamp} format="time" />} status="delivered" />}
                          >
                            <Markdown density="compact" inlinePlugins={mathPlugins as never}>{m.content}</Markdown>
                          </ChatMessageBubble>
                        </ChatMessage>
                      ) : (
                        <ChatMessage key={m.id} sender="assistant" avatar={<Avatar name="Muse" size="md" />}>
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
    </VStack>
  );
}
