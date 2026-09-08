'use client';

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import { getVsCodeApi } from '../lib/vscode-api';
import { dialogReducer, dialogInitialState, getActiveDialog, getOpenDialogCount } from '../reducers/dialog-reducer';

export type SessionOption = {
  sessionId: string;
  title?: string;
  updatedAt?: number;
  workspaceRoot?: string;
};

export type ApprovalRequest = {
  approvalId: string;
  sessionId: string;
  toolName?: string;
  subject?: { kind?: string; command?: string; path?: string; target?: string; host?: string; port?: string | number };
  choices?: { choiceId: string; label: string; decision?: string }[];
};

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  selection?: { mode: string; maxSelections?: number };
  options?: { label: string; description?: string }[];
};

export type UserInputRequest = {
  userInputId: string;
  sessionId: string;
  toolName?: string;
  questions: UserInputQuestion[];
};

export type DialogType = 'session-picker' | 'model-picker' | 'user-input' | 'approval' | 'artifact-dialog' | 'artifact-panel';

export type DialogAction = 'opened' | 'closed' | 'submitted' | 'cancelled' | 'picked';

export type DialogProcessEntry = {
  id: string;
  dialog: DialogType;
  action: DialogAction;
  timestamp: string;
  detail?: unknown;
};

type DialogContextValue = {
  sessions: SessionOption[] | null;
  models: unknown[] | null;
  pendingUserInput: UserInputRequest | null;
  pendingApproval: ApprovalRequest | null;
  uiSelections: Record<string, unknown>;
  isArtifactOpen: boolean;
  isArtifactDialogOpen: boolean;
  processHistory: DialogProcessEntry[];
  activeDialog: DialogType | null;
  openDialogCount: number;

  setSessions: (sessions: SessionOption[] | null) => void;
  setModels: (models: unknown[] | null) => void;
  setUiSelections: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  setIsArtifactOpen: (open: boolean) => void;
  setIsArtifactDialogOpen: (open: boolean) => void;

  openSessionPicker: (sessions: SessionOption[]) => void;
  closeSessionPicker: () => void;
  pickSession: (sessionId: string) => void;

  openModelPicker: (models: unknown[]) => void;
  closeModelPicker: () => void;
  pickModel: (modelId: string) => void;

  openUserInput: (req: UserInputRequest) => void;
  closeUserInput: () => void;
  submitUserInput: (answers: unknown[]) => void;
  cancelUserInput: () => void;

  openApproval: (req: ApprovalRequest) => void;
  closeApproval: () => void;
  decideApproval: (choiceId: string) => void;
  dismissApproval: () => void;

  openArtifact: (containerWidth?: number) => void;
  closeArtifact: () => void;
  toggleArtifact: (containerWidth?: number) => void;
  closeAllDialogs: () => void;

  track: (dialog: DialogType, action: DialogAction, detail?: unknown) => void;
  clearHistory: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(dialogReducer, dialogInitialState);
  const { sessions, models, pendingUserInput, pendingApproval, uiSelections, isArtifactOpen, isArtifactDialogOpen, processHistory } = state;

  const track = useCallback((dialog: DialogType, action: DialogAction, detail?: unknown) => {
    dispatch({ type: 'TRACK', dialog, action, detail });
  }, []);

  const setSessions = useCallback((next: SessionOption[] | null) => {
    dispatch({ type: 'SET_SESSIONS', sessions: next });
  }, []);

  const setModels = useCallback((next: unknown[] | null) => {
    dispatch({ type: 'SET_MODELS', models: next });
  }, []);

  const setUiSelections: React.Dispatch<React.SetStateAction<Record<string, unknown>>> = useCallback(
    (updater) => dispatch({ type: 'USER_INPUT_SELECTION', updater: updater as React.SetStateAction<Record<string, unknown>> }),
    [],
  );

  const openSessionPicker = useCallback((opts: SessionOption[]) => dispatch({ type: 'SESSION_OPEN', sessions: opts }), []);
  const closeSessionPicker = useCallback(() => dispatch({ type: 'SESSION_CLOSE' }), []);
  const pickSession = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: 'session_pick', sessionId });
    dispatch({ type: 'SESSION_PICK', sessionId });
  }, []);

  const openModelPicker = useCallback((opts: unknown[]) => dispatch({ type: 'MODEL_OPEN', models: opts }), []);
  const closeModelPicker = useCallback(() => dispatch({ type: 'MODEL_CLOSE' }), []);
  const pickModel = useCallback((modelId: string) => {
    getVsCodeApi().postMessage({ type: 'model_pick', modelId });
    dispatch({ type: 'MODEL_PICK', modelId });
  }, []);

  const openUserInput = useCallback((req: UserInputRequest) => dispatch({ type: 'USER_INPUT_REQUESTED', request: req }), []);
  const closeUserInput = useCallback(() => dispatch({ type: 'USER_INPUT_CLOSE' }), []);
  const cancelUserInput = useCallback(() => {
    if (!state.pendingUserInput) {
      dispatch({ type: 'USER_INPUT_CLOSE' });
      return;
    }
    getVsCodeApi().postMessage({
      type: 'user_input_answer',
      userInputId: state.pendingUserInput.userInputId,
      sessionId: state.pendingUserInput.sessionId,
      answers: [],
    });
    getVsCodeApi().postMessage({
      type: 'approval_decide',
      approvalId: state.pendingUserInput.userInputId,
      sessionId: state.pendingUserInput.sessionId,
    } as unknown as Record<string, unknown>);
    dispatch({ type: 'USER_INPUT_CANCEL' });
  }, [state.pendingUserInput]);

  const submitUserInput = useCallback(
    (answers: unknown[]) => {
      if (!state.pendingUserInput) return;
      getVsCodeApi().postMessage({
        type: 'user_input_answer',
        userInputId: state.pendingUserInput.userInputId,
        sessionId: state.pendingUserInput.sessionId,
        answers,
      });
      dispatch({ type: 'USER_INPUT_SUBMIT' });
    },
    [state.pendingUserInput],
  );

  const openApproval = useCallback((req: ApprovalRequest) => dispatch({ type: 'APPROVAL_REQUESTED', request: req }), []);
  const closeApproval = useCallback(() => dispatch({ type: 'APPROVAL_CLOSE' }), []);
  const dismissApproval = useCallback(() => dispatch({ type: 'APPROVAL_CANCEL' }), []);
  const decideApproval = useCallback(
    (choiceId: string) => {
      if (!state.pendingApproval) return;
      getVsCodeApi().postMessage({
        type: 'approval_decide',
        approvalId: state.pendingApproval.approvalId,
        choiceId,
        sessionId: state.pendingApproval.sessionId,
      });
      dispatch({ type: 'APPROVAL_DECIDE', choiceId });
    },
    [state.pendingApproval],
  );

  const setIsArtifactOpen = useCallback((open: boolean) => dispatch({ type: 'ARTIFACT_SET_OPEN', open }), []);
  const setIsArtifactDialogOpen = useCallback((open: boolean) => dispatch({ type: 'ARTIFACT_SET_DIALOG_OPEN', open }), []);
  const openArtifact = useCallback((containerWidth?: number) => dispatch({ type: 'ARTIFACT_OPEN', containerWidth }), []);
  const closeArtifact = useCallback(() => dispatch({ type: 'ARTIFACT_CLOSE' }), []);
  const toggleArtifact = useCallback((containerWidth?: number) => dispatch({ type: 'ARTIFACT_TOGGLE', containerWidth }), []);
  const closeAllDialogs = useCallback(() => dispatch({ type: 'CLOSE_ALL' }), []);
  const clearHistory = useCallback(() => dispatch({ type: 'CLEAR_HISTORY' }), []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'session_list') {
        dispatch({ type: 'SESSION_LIST', sessions: (msg.sessions ?? []) as SessionOption[] });
        return;
      }
      if (msg.type === 'model_list') {
        dispatch({ type: 'MODEL_LIST', models: (msg.models ?? msg.modelList ?? []) as unknown[] });
        return;
      }
      if (msg.type === 'user_input_requested') {
        const req: UserInputRequest = {
          userInputId: String(msg.userInputId ?? msg.user_input_id ?? ''),
          sessionId: String(msg.sessionId ?? ''),
          toolName: msg.toolName,
          questions: (msg.questions ?? []) as UserInputQuestion[],
        };
        dispatch({ type: 'USER_INPUT_REQUESTED', request: req });
        return;
      }
      if (msg.type === 'approval_requested') {
        const req: ApprovalRequest = {
          approvalId: String(msg.approvalId ?? msg.approval_id ?? ''),
          sessionId: String(msg.sessionId ?? ''),
          toolName: msg.toolName,
          subject: msg.subject,
          choices: msg.choices ?? msg.availableChoices,
        };
        dispatch({ type: 'APPROVAL_REQUESTED', request: req });
        return;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const activeDialog = useMemo(() => getActiveDialog(state), [state]);
  const openDialogCount = useMemo(() => getOpenDialogCount(state), [state]);

  const value: DialogContextValue = {
    sessions,
    models,
    pendingUserInput,
    pendingApproval,
    uiSelections,
    isArtifactOpen,
    isArtifactDialogOpen,
    processHistory,
    activeDialog,
    openDialogCount,
    setSessions,
    setModels,
    setUiSelections,
    setIsArtifactOpen,
    setIsArtifactDialogOpen,
    openSessionPicker,
    closeSessionPicker,
    pickSession,
    openModelPicker,
    closeModelPicker,
    pickModel,
    openUserInput,
    closeUserInput,
    submitUserInput,
    cancelUserInput,
    openApproval,
    closeApproval,
    decideApproval,
    dismissApproval,
    openArtifact,
    closeArtifact,
    toggleArtifact,
    closeAllDialogs,
    track,
    clearHistory,
  };

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
};

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

export function useDialogProcess() {
  const { processHistory, activeDialog, openDialogCount, clearHistory, track } = useDialog();
  const byDialog = useCallback(
    (type: DialogType) => processHistory.filter((e) => e.dialog === type),
    [processHistory],
  );
  const lastEntry = processHistory[processHistory.length - 1] ?? null;
  const lastActionFor = useCallback(
    (type: DialogType) => {
      for (let i = processHistory.length - 1; i >= 0; i -= 1) {
        if (processHistory[i].dialog === type) return processHistory[i];
      }
      return null;
    },
    [processHistory],
  );
  return { processHistory, activeDialog, openDialogCount, lastEntry, byDialog, lastActionFor, clearHistory, track };
}

export function useArtifactDialog() {
  const { isArtifactOpen, isArtifactDialogOpen, openArtifact, closeArtifact, toggleArtifact, setIsArtifactOpen, setIsArtifactDialogOpen } = useDialog();
  const isOpen = isArtifactOpen || isArtifactDialogOpen;
  return { isArtifactOpen, isArtifactDialogOpen, isOpen, openArtifact, closeArtifact, toggleArtifact, setIsArtifactOpen, setIsArtifactDialogOpen };
}

export function useSessionPicker() {
  const { sessions, openSessionPicker, closeSessionPicker, pickSession } = useDialog();
  return { sessions, open: openSessionPicker, close: closeSessionPicker, pick: pickSession, isOpen: sessions !== null };
}

export function useModelPicker() {
  const { models, openModelPicker, closeModelPicker, pickModel } = useDialog();
  return { models, open: openModelPicker, close: closeModelPicker, pick: pickModel, isOpen: models !== null };
}

export function useApprovalDialog() {
  const { pendingApproval, openApproval, closeApproval, decideApproval, dismissApproval } = useDialog();
  return { pendingApproval, open: openApproval, close: closeApproval, decide: decideApproval, dismiss: dismissApproval, isOpen: !!pendingApproval };
}

export function useUserInputDialog() {
  const { pendingUserInput, uiSelections, setUiSelections, openUserInput, closeUserInput, submitUserInput, cancelUserInput } = useDialog();
  return {
    pendingUserInput,
    uiSelections,
    setUiSelections,
    open: openUserInput,
    close: closeUserInput,
    submit: submitUserInput,
    cancel: cancelUserInput,
    isOpen: !!pendingUserInput,
  };
}
