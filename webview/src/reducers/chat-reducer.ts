'use client';

import type { ChatMsg, ToolCall } from '../types/chat';

export type ChatState = {
  messages: ChatMsg[];
  isBusy: boolean;
};

export type ChatAction =
  | { type: 'CLEAR' }
  | { type: 'REPLAY_USER'; text: string }
  | { type: 'TOOL_CALL'; id: string; name: string; target?: string; status: ToolCall['status'] }
  | { type: 'REASONING_START' }
  | { type: 'REASONING_DELTA'; delta: string }
  | { type: 'REASONING_END' }
  | { type: 'CHUNK'; text: string; done: boolean; isError?: boolean; isStderr?: boolean }
  | { type: 'SEND'; userMsg: ChatMsg; assistantMsg: ChatMsg }
  | { type: 'SET_BUSY'; busy: boolean };

export const chatInitialState: ChatState = {
  messages: [],
  isBusy: false,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'CLEAR':
      return { messages: [], isBusy: false };

    case 'REPLAY_USER': {
      const now = new Date().toISOString();
      return {
        ...state,
        messages: [...state.messages, { id: `u-replay-${Date.now()}`, role: 'user', content: action.text, timestamp: now }],
      };
    }

    case 'TOOL_CALL': {
      const { id: incomingId, name: incomingName, target: incomingTarget, status: incomingStatus } = action;
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const next = [...state.messages];
      let toolCalls = last.toolCalls ?? [];
      const idx = toolCalls.findIndex((c) => c.id === incomingId);
      if (idx >= 0) {
        const existing = toolCalls[idx];
        const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
        toolCalls = [...toolCalls];
        toolCalls[idx] = { ...existing, name: incomingName, target: mergedTarget, status: incomingStatus };
      } else {
        const runningIdx = toolCalls.findIndex((c) => c.name === incomingName && c.status === 'running');
        if (runningIdx >= 0 && incomingStatus === 'complete' && !incomingId.startsWith('generic-')) {
          const existing = toolCalls[runningIdx];
          const mergedTarget = incomingTarget && incomingTarget.length > 0 ? incomingTarget : existing.target;
          toolCalls = [...toolCalls];
          toolCalls[runningIdx] = { ...existing, id: incomingId, target: mergedTarget, status: 'complete' };
        } else {
          toolCalls = [...toolCalls, { id: incomingId, name: incomingName, target: incomingTarget, status: incomingStatus }];
        }
      }
      next[next.length - 1] = { ...last, toolCalls };
      return { ...state, messages: next };
    }

    case 'REASONING_START': {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const next = [...state.messages];
      next[next.length - 1] = { ...last, thinking: last.thinking ?? '', thinkingOpen: true };
      return { ...state, messages: next };
    }

    case 'REASONING_DELTA': {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const next = [...state.messages];
      next[next.length - 1] = { ...last, thinking: (last.thinking ?? '') + action.delta, thinkingOpen: true };
      return { ...state, messages: next };
    }

    case 'REASONING_END': {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const next = [...state.messages];
      next[next.length - 1] = { ...last, thinkingOpen: false };
      return { ...state, messages: next };
    }

    case 'CHUNK': {
      const { text, done, isError, isStderr } = action;
      let next = [...state.messages];
      let last = next[next.length - 1];
      if (!last || last.role !== 'assistant' || (!last.isStreaming && last.content && done)) {
        last = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true };
        next.push(last);
      }
      let toolCalls = last.toolCalls;
      if (done && toolCalls && toolCalls.some((c) => c.status === 'running')) {
        toolCalls = toolCalls.map((c) => (c.status === 'running' ? { ...c, status: 'complete' as const } : c));
      }
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
      return { messages: next, isBusy: !done };
    }

    case 'SEND':
      return {
        messages: [...state.messages, action.userMsg, action.assistantMsg],
        isBusy: true,
      };

    case 'SET_BUSY':
      return { ...state, isBusy: action.busy };

    default:
      return state;
  }
}
