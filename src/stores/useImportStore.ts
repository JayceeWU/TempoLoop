import { create } from 'zustand';

import type { ImportStage, SourceMediaKind } from '../../modules/tempoloop-media';

export type ImportStoreStatus =
  'idle' | 'selecting' | 'selected' | 'importing' | 'cancelling' | 'completed' | 'failed';

export interface ImportSourceMetadata {
  readonly sourceKindHint: SourceMediaKind;
  readonly displayName: string | null;
  readonly sizeBytes: number | null;
  readonly mimeType: string | null;
}

export interface ImportSelectionState extends ImportSourceMetadata {
  readonly selectionId: string;
  readonly sourceUri: string;
  readonly suggestedName: string;
}

export interface ImportTerminalError {
  readonly code: string;
  readonly userMessage: string | null;
}

export interface ImportProgressState {
  readonly stage: ImportStage | null;
  readonly stageProgress: number | null;
  readonly overallProgress: number | null;
}

export interface ImportStoreSnapshot extends ImportProgressState {
  readonly status: ImportStoreStatus;
  readonly operationId: string | null;
  readonly projectId: string | null;
  readonly selectionId: string | null;
  readonly sourceUri: string | null;
  readonly sourceMetadata: ImportSourceMetadata | null;
  readonly suggestedName: string | null;
  readonly projectName: string | null;
  readonly cancelRequested: boolean;
  readonly terminalError: ImportTerminalError | null;
}

export interface ImportStoreActions {
  tryBeginSelection(): boolean;
  finishSelection(selection: ImportSelectionState): void;
  cancelSelection(): void;
  failSelection(error: ImportTerminalError): void;
  discardSelection(selectionId?: string): void;
  tryBeginImport(input: {
    operationId: string;
    projectId: string;
    selection: ImportSelectionState;
    projectName: string;
  }): boolean;
  updateProgress(
    operationId: string,
    progress: {
      stage: ImportStage;
      stageProgress: number | null;
      overallProgress: number | null;
    },
  ): void;
  requestCancel(operationId: string): void;
  completeImport(operationId: string, projectId: string): void;
  failImport(operationId: string, error: ImportTerminalError): void;
  reset(): void;
}

export type ImportStoreState = ImportStoreSnapshot & ImportStoreActions;

const EMPTY_PROGRESS: ImportProgressState = {
  stage: null,
  stageProgress: null,
  overallProgress: null,
};

const INITIAL_SNAPSHOT: ImportStoreSnapshot = {
  status: 'idle',
  operationId: null,
  projectId: null,
  selectionId: null,
  sourceUri: null,
  sourceMetadata: null,
  suggestedName: null,
  projectName: null,
  cancelRequested: false,
  terminalError: null,
  ...EMPTY_PROGRESS,
};

function isTerminalOrIdle(status: ImportStoreStatus): boolean {
  return status === 'idle' || status === 'completed' || status === 'failed';
}

function normalizeProgress(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function monotonicProgress(previous: number | null, next: number | null): number | null {
  const normalized = normalizeProgress(next);
  if (normalized === null) {
    return previous;
  }
  return previous === null ? normalized : Math.max(previous, normalized);
}

export const useImportStore = create<ImportStoreState>((set, get) => ({
  ...INITIAL_SNAPSHOT,

  tryBeginSelection: () => {
    if (!isTerminalOrIdle(get().status)) {
      return false;
    }
    set({ ...INITIAL_SNAPSHOT, status: 'selecting' });
    return true;
  },

  finishSelection: (selection) => {
    if (get().status !== 'selecting') {
      return;
    }
    set({
      status: 'selected',
      selectionId: selection.selectionId,
      sourceUri: selection.sourceUri,
      sourceMetadata: {
        sourceKindHint: selection.sourceKindHint,
        displayName: selection.displayName,
        sizeBytes: selection.sizeBytes,
        mimeType: selection.mimeType,
      },
      suggestedName: selection.suggestedName,
      terminalError: null,
    });
  },

  cancelSelection: () => {
    if (get().status === 'selecting') {
      set(INITIAL_SNAPSHOT);
    }
  },

  failSelection: (error) => {
    if (get().status !== 'selecting') {
      return;
    }
    set({ ...INITIAL_SNAPSHOT, status: 'failed', terminalError: error });
  },

  discardSelection: (selectionId) => {
    const state = get();
    if (
      state.status !== 'selected' ||
      (selectionId !== undefined && state.selectionId !== selectionId)
    ) {
      return;
    }
    set(INITIAL_SNAPSHOT);
  },

  tryBeginImport: ({ operationId, projectId, selection, projectName }) => {
    const state = get();
    if (
      state.status !== 'selected' ||
      state.selectionId !== selection.selectionId ||
      state.sourceUri !== selection.sourceUri
    ) {
      return false;
    }
    set({
      status: 'importing',
      operationId,
      projectId,
      selectionId: selection.selectionId,
      sourceUri: selection.sourceUri,
      sourceMetadata: {
        sourceKindHint: selection.sourceKindHint,
        displayName: selection.displayName,
        sizeBytes: selection.sizeBytes,
        mimeType: selection.mimeType,
      },
      suggestedName: selection.suggestedName,
      projectName,
      cancelRequested: false,
      terminalError: null,
      ...EMPTY_PROGRESS,
    });
    return true;
  },

  updateProgress: (operationId, progress) => {
    const state = get();
    if (
      state.operationId !== operationId ||
      (state.status !== 'importing' && state.status !== 'cancelling')
    ) {
      return;
    }
    set({
      stage: progress.stage,
      stageProgress: normalizeProgress(progress.stageProgress),
      overallProgress: monotonicProgress(state.overallProgress, progress.overallProgress),
    });
  },

  requestCancel: (operationId) => {
    const state = get();
    if (state.operationId !== operationId || state.status === 'cancelling') {
      return;
    }
    if (state.status === 'importing') {
      set({ status: 'cancelling', cancelRequested: true });
    }
  },

  completeImport: (operationId, projectId) => {
    if (get().operationId !== operationId) {
      return;
    }
    set({
      ...INITIAL_SNAPSHOT,
      status: 'completed',
      operationId,
      projectId,
    });
  },

  failImport: (operationId, error) => {
    if (get().operationId !== operationId) {
      return;
    }
    set({
      ...INITIAL_SNAPSHOT,
      status: 'failed',
      operationId,
      terminalError: error,
    });
  },

  reset: () => set(INITIAL_SNAPSHOT),
}));

export type ImportStateController = Pick<
  ImportStoreState,
  | 'tryBeginSelection'
  | 'finishSelection'
  | 'cancelSelection'
  | 'failSelection'
  | 'discardSelection'
  | 'tryBeginImport'
  | 'updateProgress'
  | 'requestCancel'
  | 'completeImport'
  | 'failImport'
>;

export function importStateController(): ImportStateController {
  return useImportStore.getState();
}
