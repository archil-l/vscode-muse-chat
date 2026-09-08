export type ToolCall = {
  id?: string;
  name: string;
  target?: string;
  status: 'running' | 'complete' | 'error';
  duration?: string;
  additions?: number;
  deletions?: number;
  node?: string;
};

export type ChatMsg = {
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

export type MuseStatus = {
  model?: string;
  effort?: string;
  workdir?: string;
  workdirLabel?: string;
  permissions?: string;
  approvalMode?: string;
  sandbox?: string;
  trust?: string;
};
