'use client';

import type { SessionOption, ApprovalRequest, UserInputRequest, DialogProcessEntry, DialogType, DialogAction } from '../context/DialogContext';

export type DialogState = {
  sessions: SessionOption[] | null;
  models: unknown[] | null;
  pendingUserInput: UserInputRequest | null;
  pendingApproval: ApprovalRequest | null;
  uiSelections: Record<string, unknown>;
  isArtifactOpen: boolean;
  isArtifactDialogOpen: boolean;
  processHistory: DialogProcessEntry[];
};

export type DialogReducerAction =
  | { type: 'SESSION_LIST'; sessions: SessionOption[] }
  | { type: 'SESSION_OPEN'; sessions: SessionOption[] }
  | { type: 'SESSION_CLOSE' }
  | { type: 'SESSION_PICK'; sessionId: string }
  | { type: 'MODEL_LIST'; models: unknown[] }
  | { type: 'MODEL_OPEN'; models: unknown[] }
  | { type: 'MODEL_CLOSE' }
  | { type: 'MODEL_PICK'; modelId: string }
  | { type: 'USER_INPUT_REQUESTED'; request: UserInputRequest }
  | { type: 'USER_INPUT_CLOSE' }
  | { type: 'USER_INPUT_CANCEL' }
  | { type: 'USER_INPUT_SUBMIT' }
  | { type: 'USER_INPUT_SELECTION'; updater: React.SetStateAction<Record<string, unknown>> }
  | { type: 'APPROVAL_REQUESTED'; request: ApprovalRequest }
  | { type: 'APPROVAL_CLOSE' }
  | { type: 'APPROVAL_CANCEL' }
  | { type: 'APPROVAL_DECIDE'; choiceId: string }
  | { type: 'ARTIFACT_OPEN'; containerWidth?: number }
  | { type: 'ARTIFACT_CLOSE' }
  | { type: 'ARTIFACT_TOGGLE'; containerWidth?: number }
  | { type: 'ARTIFACT_SET_OPEN'; open: boolean }
  | { type: 'ARTIFACT_SET_DIALOG_OPEN'; open: boolean }
  | { type: 'CLOSE_ALL' }
  | { type: 'TRACK'; dialog: DialogType; action: DialogAction; detail?: unknown }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_SESSIONS'; sessions: SessionOption[] | null }
  | { type: 'SET_MODELS'; models: unknown[] | null };

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function pushHistory(state: DialogState, dialog: DialogType, action: DialogAction, detail?: unknown): DialogState {
  const entry: DialogProcessEntry = { id: uid(), dialog, action, timestamp: nowIso(), detail };
  return { ...state, processHistory: [...state.processHistory, entry] };
}

export const dialogInitialState: DialogState = {
  sessions: null,
  models: null,
  pendingUserInput: null,
  pendingApproval: null,
  uiSelections: {},
  isArtifactOpen: false,
  isArtifactDialogOpen: false,
  processHistory: [],
};

const MOBILE_MAX_WIDTH = 767;

export function dialogReducer(state: DialogState, action: DialogReducerAction): DialogState {
  switch (action.type) {
    case 'SESSION_LIST':
    case 'SESSION_OPEN':
      return pushHistory({ ...state, sessions: action.sessions }, 'session-picker', 'opened', { count: action.sessions.length });

    case 'SESSION_CLOSE':
      return pushHistory({ ...state, sessions: null }, 'session-picker', 'closed');

    case 'SESSION_PICK': {
      let next = pushHistory(state, 'session-picker', 'picked', { sessionId: action.sessionId });
      next = pushHistory({ ...next, sessions: null }, 'session-picker', 'closed');
      return next;
    }

    case 'MODEL_LIST':
    case 'MODEL_OPEN':
      return pushHistory({ ...state, models: action.models }, 'model-picker', 'opened', { count: action.models.length });

    case 'MODEL_CLOSE':
      return pushHistory({ ...state, models: null }, 'model-picker', 'closed');

    case 'MODEL_PICK': {
      let next = pushHistory(state, 'model-picker', 'picked', { modelId: action.modelId });
      next = pushHistory({ ...next, models: null }, 'model-picker', 'closed');
      return next;
    }

    case 'USER_INPUT_REQUESTED':
      return pushHistory({ ...state, pendingUserInput: action.request, uiSelections: {} }, 'user-input', 'opened', {
        userInputId: action.request.userInputId,
        questions: action.request.questions.length,
      });

    case 'USER_INPUT_CLOSE':
      return pushHistory({ ...state, pendingUserInput: null }, 'user-input', 'closed');

    case 'USER_INPUT_CANCEL': {
      if (!state.pendingUserInput) return pushHistory({ ...state, pendingUserInput: null }, 'user-input', 'closed');
      let next = pushHistory(state, 'user-input', 'cancelled', { userInputId: state.pendingUserInput.userInputId });
      next = pushHistory({ ...next, pendingUserInput: null }, 'user-input', 'closed');
      return next;
    }

    case 'USER_INPUT_SUBMIT': {
      if (!state.pendingUserInput) return state;
      let next = pushHistory(state, 'user-input', 'submitted', { userInputId: state.pendingUserInput.userInputId });
      next = pushHistory({ ...next, pendingUserInput: null }, 'user-input', 'closed');
      return next;
    }

    case 'USER_INPUT_SELECTION': {
      const nextSelections =
        typeof action.updater === 'function'
          ? (action.updater as (prev: Record<string, unknown>) => Record<string, unknown>)(state.uiSelections)
          : (action.updater as Record<string, unknown>);
      return { ...state, uiSelections: nextSelections };
    }

    case 'APPROVAL_REQUESTED':
      return pushHistory({ ...state, pendingApproval: action.request }, 'approval', 'opened', {
        approvalId: action.request.approvalId,
      });

    case 'APPROVAL_CLOSE':
      return pushHistory({ ...state, pendingApproval: null }, 'approval', 'closed');

    case 'APPROVAL_CANCEL': {
      let next = pushHistory(state, 'approval', 'cancelled', { approvalId: state.pendingApproval?.approvalId });
      next = pushHistory({ ...next, pendingApproval: null }, 'approval', 'closed');
      return next;
    }

    case 'APPROVAL_DECIDE': {
      if (!state.pendingApproval) return state;
      let next = pushHistory(state, 'approval', 'picked', {
        approvalId: state.pendingApproval.approvalId,
        choiceId: action.choiceId,
      });
      next = pushHistory({ ...next, pendingApproval: null }, 'approval', 'closed');
      return next;
    }

    case 'ARTIFACT_OPEN': {
      const width = action.containerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : Infinity);
      if (width <= MOBILE_MAX_WIDTH) {
        return pushHistory({ ...state, isArtifactDialogOpen: true }, 'artifact-dialog', 'opened', { containerWidth: width });
      }
      return pushHistory({ ...state, isArtifactOpen: true }, 'artifact-panel', 'opened', { containerWidth: width });
    }

    case 'ARTIFACT_CLOSE': {
      let next = pushHistory({ ...state, isArtifactOpen: false }, 'artifact-panel', 'closed');
      next = pushHistory({ ...next, isArtifactDialogOpen: false }, 'artifact-dialog', 'closed');
      return next;
    }

    case 'ARTIFACT_TOGGLE': {
      const isOpen = state.isArtifactOpen || state.isArtifactDialogOpen;
      if (isOpen) {
        let next = pushHistory({ ...state, isArtifactOpen: false }, 'artifact-panel', 'closed');
        next = pushHistory({ ...next, isArtifactDialogOpen: false }, 'artifact-dialog', 'closed');
        return next;
      }
      const width = action.containerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : Infinity);
      if (width <= MOBILE_MAX_WIDTH) {
        return pushHistory({ ...state, isArtifactDialogOpen: true }, 'artifact-dialog', 'opened', { containerWidth: width });
      }
      return pushHistory({ ...state, isArtifactOpen: true }, 'artifact-panel', 'opened', { containerWidth: width });
    }

    case 'ARTIFACT_SET_OPEN':
      return pushHistory({ ...state, isArtifactOpen: action.open }, 'artifact-panel', action.open ? 'opened' : 'closed');

    case 'ARTIFACT_SET_DIALOG_OPEN':
      return pushHistory({ ...state, isArtifactDialogOpen: action.open }, 'artifact-dialog', action.open ? 'opened' : 'closed');

    case 'CLOSE_ALL': {
      let next: DialogState = { ...state, sessions: null, models: null, pendingUserInput: null, pendingApproval: null, isArtifactDialogOpen: false };
      next = pushHistory(next, 'session-picker', 'closed');
      next = pushHistory(next, 'model-picker', 'closed');
      next = pushHistory(next, 'user-input', 'closed');
      next = pushHistory(next, 'approval', 'closed');
      next = pushHistory(next, 'artifact-dialog', 'closed');
      return next;
    }

    case 'TRACK':
      return pushHistory(state, action.dialog, action.action, action.detail);

    case 'CLEAR_HISTORY':
      return { ...state, processHistory: [] };

    case 'SET_SESSIONS':
      if (action.sessions) return pushHistory({ ...state, sessions: action.sessions }, 'session-picker', 'opened', { count: action.sessions.length });
      return { ...state, sessions: null };

    case 'SET_MODELS':
      if (action.models) return pushHistory({ ...state, models: action.models }, 'model-picker', 'opened', { count: action.models.length });
      return { ...state, models: null };

    default:
      return state;
  }
}

export function getActiveDialog(state: DialogState): DialogType | null {
  if (state.pendingApproval) return 'approval';
  if (state.pendingUserInput) return 'user-input';
  if (state.sessions !== null) return 'session-picker';
  if (state.models !== null) return 'model-picker';
  if (state.isArtifactDialogOpen) return 'artifact-dialog';
  if (state.isArtifactOpen) return 'artifact-panel';
  return null;
}

export function getOpenDialogCount(state: DialogState): number {
  let n = 0;
  if (state.sessions !== null) n += 1;
  if (state.models !== null) n += 1;
  if (state.pendingUserInput) n += 1;
  if (state.pendingApproval) n += 1;
  if (state.isArtifactDialogOpen) n += 1;
  return n;
}
