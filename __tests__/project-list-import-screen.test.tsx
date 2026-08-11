import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { Alert } from 'react-native';

import ProjectListScreen from '../app';
import { COPY } from '@/constants/copy';
import type { DanceProject } from '@/domain/project';
import { createDefaultPracticeMarkers } from '@/domain/segment';
import {
  ImportCoordinatorError,
  type ImportProjectRequest,
  type SelectedMedia,
} from '@/services/ImportCoordinator';
import { useImportStore } from '@/stores/useImportStore';
import { useProjectStore } from '@/stores/useProjectStore';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockSelectVideoFromGallery = jest.fn<Promise<SelectedMedia | null>, []>();
const mockSelectAudio = jest.fn<Promise<SelectedMedia | null>, []>();
const mockDiscardSelection = jest.fn<void, [selection: SelectedMedia]>();
const mockImportProject = jest.fn<Promise<DanceProject>, [request: ImportProjectRequest]>();
const mockCancelActiveImport = jest.fn<Promise<boolean>, []>();
const mockIsImportActive = jest.fn(() => false);
const mockInitialize = jest.fn(async () => undefined);
const mockRenameProject = jest.fn(async () => undefined);
const mockDeleteProject = jest.fn(async () => undefined);
const mockClearProjectPlaybackSource = jest.fn<Promise<void>, [projectId: string]>(
  async () => undefined,
);

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockRouterPush(href),
    replace: (href: unknown) => mockRouterReplace(href),
  },
}));

jest.mock('@/playback/PlaybackSourceLifecycle', () => ({
  clearProjectPlaybackSource: (projectId: string) => mockClearProjectPlaybackSource(projectId),
}));

jest.mock('@/services/ImportCoordinator', () => {
  class MockImportCoordinatorError extends Error {
    readonly code: string;
    readonly details: Record<string, number>;

    constructor(mockCode: string, mockMessage: string, mockDetails: Record<string, number> = {}) {
      super(mockMessage);
      this.name = 'ImportCoordinatorError';
      this.code = mockCode;
      this.details = mockDetails;
    }
  }

  function store() {
    return jest.requireActual<typeof import('@/stores/useImportStore')>('@/stores/useImportStore')
      .useImportStore;
  }

  return {
    ImportCoordinatorError: MockImportCoordinatorError,
    importCoordinator: {
      isImportActive: () => mockIsImportActive(),
      selectVideoFromGallery: () => {
        const state = store().getState();
        if (!state.tryBeginSelection()) {
          return Promise.reject(new MockImportCoordinatorError('E_IMPORT_IN_PROGRESS', 'busy'));
        }
        return mockSelectVideoFromGallery().then(
          (selection) => {
            if (selection === null) {
              store().getState().cancelSelection();
            } else {
              store().getState().finishSelection({
                selectionId: selection.selectionId,
                sourceKindHint: selection.sourceKindHint,
                sourceUri: selection.uri,
                displayName: selection.fileName,
                sizeBytes: selection.sizeBytes,
                mimeType: selection.mimeType,
                suggestedName: selection.suggestedName,
              });
            }
            return selection;
          },
          (error) => {
            store().getState().failSelection({ code: 'E_UNKNOWN_NATIVE', userMessage: null });
            throw error;
          },
        );
      },
      selectAudio: () => {
        const state = store().getState();
        if (!state.tryBeginSelection()) {
          return Promise.reject(new MockImportCoordinatorError('E_IMPORT_IN_PROGRESS', 'busy'));
        }
        return mockSelectAudio().then((selection) => {
          if (selection === null) {
            store().getState().cancelSelection();
          } else {
            store().getState().finishSelection({
              selectionId: selection.selectionId,
              sourceKindHint: selection.sourceKindHint,
              sourceUri: selection.uri,
              displayName: selection.fileName,
              sizeBytes: selection.sizeBytes,
              mimeType: selection.mimeType,
              suggestedName: selection.suggestedName,
            });
          }
          return selection;
        });
      },
      discardSelection: (selection: SelectedMedia) => {
        mockDiscardSelection(selection);
        store().getState().discardSelection(selection.selectionId);
      },
      importProject: (request: ImportProjectRequest) => {
        const operationId = 'operation-1';
        const projectId = 'project-1';
        const state = store().getState();
        state.tryBeginImport({
          operationId,
          projectId,
          selection: {
            selectionId: request.selection.selectionId,
            sourceKindHint: request.selection.sourceKindHint,
            sourceUri: request.selection.uri,
            displayName: request.selection.fileName,
            sizeBytes: request.selection.sizeBytes,
            mimeType: request.selection.mimeType,
            suggestedName: request.selection.suggestedName,
          },
          projectName: request.name,
        });
        return mockImportProject(request).then(
          (project) => {
            store().getState().completeImport(operationId, project.id);
            return project;
          },
          (error) => {
            store()
              .getState()
              .failImport(operationId, {
                code: error instanceof MockImportCoordinatorError ? error.code : 'E_UNKNOWN_NATIVE',
                userMessage: null,
              });
            throw error;
          },
        );
      },
      cancelActiveImport: () => {
        const state = store().getState();
        if (state.operationId !== null) {
          state.requestCancel(state.operationId);
        }
        return mockCancelActiveImport();
      },
    },
  };
});

const SELECTION: SelectedMedia = {
  selectionId: 'selection-1',
  sourceKindHint: 'video',
  uri: 'content://com.android.providers.media.documents/video%3A42',
  sizeBytes: 1_024,
  mimeType: 'video/quicktime',
  fileName: 'practice.mov',
  suggestedName: 'Practice Track',
};

const IMPORTED_PROJECT: DanceProject = {
  schemaVersion: 2,
  id: 'c733c86b-6877-4986-bd4d-a26392f7dc82',
  name: 'Practice Track',
  createdAtIso: '2026-07-31T12:00:00.000Z',
  updatedAtIso: '2026-07-31T12:00:00.000Z',
  audioFileName: 'audio.m4a',
  waveformFileName: 'waveform.json',
  waveformStatus: 'ready',
  durationMs: 90_000,
  sourceDisplayName: SELECTION.fileName,
  sourceSizeBytes: SELECTION.sizeBytes,
  selectedRate: 1,
  leadInMs: 6_000,
  practiceMarkers: createDefaultPracticeMarkers(90_000),
};

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: (value: Value) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function openNamingSheet(screen: Awaited<ReturnType<typeof render>>): Promise<void> {
  await press(screen.getByRole('button', { name: COPY.projectList.extractVideo }));
  await waitFor(() => {
    expect(screen.getByLabelText(COPY.import.nameInputLabel)).toHaveProp(
      'value',
      SELECTION.suggestedName,
    );
  });
}

async function press(element: TestInstance): Promise<void> {
  await fireEvent.press(element);
}

async function changeText(element: TestInstance, value: string): Promise<void> {
  await fireEvent.changeText(element, value);
}

beforeEach(() => {
  jest.clearAllMocks();
  useImportStore.getState().reset();
  mockIsImportActive.mockReturnValue(false);
  mockSelectVideoFromGallery.mockResolvedValue(SELECTION);
  mockSelectAudio.mockResolvedValue({
    ...SELECTION,
    sourceKindHint: 'audio',
    mimeType: 'audio/mpeg',
    fileName: 'practice.mp3',
  });
  mockCancelActiveImport.mockResolvedValue(true);
  mockRenameProject.mockResolvedValue(undefined);
  mockDeleteProject.mockResolvedValue(undefined);
  mockClearProjectPlaybackSource.mockResolvedValue(undefined);
  useProjectStore.setState({
    projects: [],
    mediaStatusByProjectId: {},
    corruptProjectIds: [],
    repositoryDiagnostics: [],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    renameProject: mockRenameProject,
    deleteProject: mockDeleteProject,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await cleanup();
  useImportStore.getState().reset();
  jest.restoreAllMocks();
});

describe('Android project list', () => {
  it('hides ready waveform and updated-time rows while opening ready projects', async () => {
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: { [IMPORTED_PROJECT.id]: { state: 'ready', issues: [] } },
    });
    const screen = await render(<ProjectListScreen />);

    expect(screen.queryByText('Waveform ready')).toBeNull();
    expect(screen.queryByText(COPY.projectList.updated('Jul 31, 2026'))).toBeNull();
    await press(
      screen.getByRole('button', {
        name: new RegExp(`^${IMPORTED_PROJECT.name}\\.`),
      }),
    );

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]',
      params: { projectId: IMPORTED_PROJECT.id },
    });
  });

  it('keeps a repair project visible, blocks opening it, and offers deletion', async () => {
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: {
        [IMPORTED_PROJECT.id]: {
          state: 'needs-repair',
          issues: ['AUDIO_MISSING_OR_EMPTY', 'WAVEFORM_MISSING'],
        },
      },
    });
    const screen = await render(<ProjectListScreen />);

    expect(screen.getByText(IMPORTED_PROJECT.name)).toBeTruthy();
    expect(screen.getByText(COPY.projectList.repairStatus)).toBeTruthy();
    expect(
      screen.getByText(
        `${COPY.projectList.repairAudioMissing} ${COPY.projectList.repairWaveformMissing}`,
      ),
    ).toBeTruthy();

    await press(
      screen.getByRole('button', {
        name: COPY.projectList.repairDeleteAccessibilityLabel(IMPORTED_PROJECT.name),
      }),
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.projectList.deleteTitle(IMPORTED_PROJECT.name),
      COPY.projectList.deleteMessage,
      expect.any(Array),
      expect.objectContaining({ cancelable: true }),
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('uses an Android modal to rename a project', async () => {
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: { [IMPORTED_PROJECT.id]: { state: 'ready', issues: [] } },
    });
    const screen = await render(<ProjectListScreen />);

    await press(
      screen.getByRole('button', {
        name: COPY.projectList.projectMenuAccessibilityLabel(IMPORTED_PROJECT.name),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.common.rename })).toBeTruthy(),
    );
    expect(screen.getByRole('header', { name: IMPORTED_PROJECT.name })).toBeTruthy();
    expect(screen.queryByText(`Actions for ${IMPORTED_PROJECT.name}`)).toBeNull();
    await press(screen.getByRole('button', { name: COPY.common.rename }));
    await waitFor(() => expect(screen.getByLabelText(COPY.import.nameInputLabel)).toBeTruthy());
    await changeText(screen.getByLabelText(COPY.import.nameInputLabel), 'Evening Practice');
    await press(screen.getByRole('button', { name: COPY.common.rename }));

    await waitFor(() => {
      expect(mockRenameProject).toHaveBeenCalledWith(IMPORTED_PROJECT.id, 'Evening Practice');
    });
  });

  it('clears a loaded source before deleting project files', async () => {
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: { [IMPORTED_PROJECT.id]: { state: 'ready', issues: [] } },
    });
    const screen = await render(<ProjectListScreen />);

    await press(
      screen.getByRole('button', {
        name: COPY.projectList.projectMenuAccessibilityLabel(IMPORTED_PROJECT.name),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.common.delete })).toBeTruthy(),
    );
    await press(screen.getByRole('button', { name: COPY.common.delete }));
    const deleteAlert = (Alert.alert as jest.MockedFunction<typeof Alert.alert>).mock.calls.at(-1);
    const deleteButton = deleteAlert?.[2]?.find((button) => button.text === COPY.common.delete);
    await act(async () => {
      deleteButton?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledWith(IMPORTED_PROJECT.id));
    expect(mockClearProjectPlaybackSource).toHaveBeenCalledWith(IMPORTED_PROJECT.id);
    expect(mockClearProjectPlaybackSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteProject.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('keeps a project and allows delete retry when player cleanup fails once', async () => {
    mockClearProjectPlaybackSource.mockRejectedValueOnce(
      Object.assign(new Error('native source cleanup failed'), { code: 'E_AUDIO_LOAD_FAILED' }),
    );
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: { [IMPORTED_PROJECT.id]: { state: 'ready', issues: [] } },
    });
    const screen = await render(<ProjectListScreen />);

    const confirmDelete = async () => {
      await press(
        screen.getByRole('button', {
          name: COPY.projectList.projectMenuAccessibilityLabel(IMPORTED_PROJECT.name),
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: COPY.common.delete })).toBeTruthy(),
      );
      await press(screen.getByRole('button', { name: COPY.common.delete }));
      const alert = (Alert.alert as jest.MockedFunction<typeof Alert.alert>).mock.calls.at(-1);
      const button = alert?.[2]?.find((candidate) => candidate.text === COPY.common.delete);
      await act(async () => {
        button?.onPress?.();
        await Promise.resolve();
      });
    };

    await confirmDelete();
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        COPY.projectList.actionErrorTitle,
        COPY.projectList.actionErrorMessage,
      ),
    );
    expect(mockDeleteProject).not.toHaveBeenCalled();

    await confirmDelete();
    await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledWith(IMPORTED_PROJECT.id));
    expect(mockClearProjectPlaybackSource).toHaveBeenCalledTimes(2);
  });
});

describe('Android import flow', () => {
  it('allows another selection when the existing project waveform is ready', async () => {
    useProjectStore.setState({
      projects: [IMPORTED_PROJECT],
      mediaStatusByProjectId: { [IMPORTED_PROJECT.id]: { state: 'ready', issues: [] } },
    });
    const screen = await render(<ProjectListScreen />);

    await press(screen.getByRole('button', { name: COPY.projectList.importAudio }));

    await waitFor(() => expect(mockSelectAudio).toHaveBeenCalledTimes(1));
  });

  it('shows separate video and audio import buttons and opens the requested source', async () => {
    const screen = await render(<ProjectListScreen />);

    expect(screen.getByRole('button', { name: COPY.projectList.extractVideo })).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.projectList.importAudio })).toBeTruthy();
    await press(screen.getByRole('button', { name: COPY.projectList.importAudio }));

    await waitFor(() => expect(mockSelectAudio).toHaveBeenCalledTimes(1));
    expect(mockSelectVideoFromGallery).not.toHaveBeenCalled();
    expect(screen.getByLabelText(COPY.import.nameInputLabel)).toBeTruthy();
  });

  it('returns to the project list when gallery selection is cancelled', async () => {
    mockSelectVideoFromGallery.mockResolvedValueOnce(null);
    const screen = await render(<ProjectListScreen />);

    await press(screen.getByRole('button', { name: COPY.projectList.extractVideo }));

    await waitFor(() => expect(useImportStore.getState().status).toBe('idle'));
    expect(screen.queryByLabelText(COPY.import.nameInputLabel)).toBeNull();
    expect(screen.getByRole('button', { name: COPY.projectList.extractVideo })).not.toBeDisabled();
  });

  it('opens the picker once, then asks for a valid name before starting native import', async () => {
    mockImportProject.mockResolvedValueOnce(IMPORTED_PROJECT);
    const screen = await render(<ProjectListScreen />);
    await openNamingSheet(screen);

    expect(mockSelectVideoFromGallery).toHaveBeenCalledTimes(1);
    expect(mockImportProject).not.toHaveBeenCalled();
    await changeText(screen.getByLabelText(COPY.import.nameInputLabel), 'Practice/Unsafe');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.import.confirmLabel })).toBeDisabled(),
    );
    await changeText(screen.getByLabelText(COPY.import.nameInputLabel), 'Practice Track');
    await press(screen.getByRole('button', { name: COPY.import.confirmLabel }));

    await waitFor(() => expect(mockImportProject).toHaveBeenCalledTimes(1));
    expect(mockImportProject.mock.calls[0]?.[0]).toMatchObject({ name: 'Practice Track' });
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/project/[projectId]',
        params: { projectId: IMPORTED_PROJECT.id },
      }),
    );
  });

  it('shows native stage progress and requests cancellation only once', async () => {
    const importResult = deferred<DanceProject>();
    const cancelResult = deferred<boolean>();
    mockImportProject.mockReturnValueOnce(importResult.promise);
    mockCancelActiveImport.mockReturnValueOnce(cancelResult.promise);
    const screen = await render(<ProjectListScreen />);
    await openNamingSheet(screen);
    await press(screen.getByRole('button', { name: COPY.import.confirmLabel }));

    await waitFor(() => expect(useImportStore.getState().status).toBe('importing'));

    await act(async () => {
      useImportStore.getState().updateProgress('operation-1', {
        stage: 'exporting',
        stageProgress: 0.4,
        overallProgress: 0.7,
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByLabelText(`${COPY.import.exporting} 70 percent`)).toBeTruthy(),
    );

    const cancel = screen.getByRole('button', { name: COPY.import.cancelLabel });
    await fireEvent.press(cancel);
    await fireEvent.press(cancel);
    expect(mockCancelActiveImport).toHaveBeenCalledTimes(1);

    await act(async () => {
      cancelResult.resolve(true);
      importResult.reject({ code: 'E_IMPORT_CANCELLED' });
      await Promise.allSettled([cancelResult.promise, importResult.promise]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(useImportStore.getState().status).toBe('failed'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('uses synchronous guards to block duplicate selection and import requests', async () => {
    const selectionResult = deferred<SelectedMedia | null>();
    const importResult = deferred<DanceProject>();
    mockSelectVideoFromGallery.mockReturnValueOnce(selectionResult.promise);
    mockImportProject.mockReturnValueOnce(importResult.promise);
    const screen = await render(<ProjectListScreen />);

    const importButton = screen.getByRole('button', { name: COPY.projectList.extractVideo });
    await fireEvent.press(importButton);
    await fireEvent.press(importButton);
    expect(mockSelectVideoFromGallery).toHaveBeenCalledTimes(1);

    await act(async () => {
      selectionResult.resolve(SELECTION);
      await selectionResult.promise;
    });
    const confirm = screen.getByRole('button', { name: COPY.import.confirmLabel });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(mockImportProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      importResult.resolve(IMPORTED_PROJECT);
      await importResult.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(useImportStore.getState().status).toBe('completed'));
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/project/[projectId]',
        params: { projectId: IMPORTED_PROJECT.id },
      }),
    );
  });

  it('distinguishes a committed-project refresh failure from an import rollback', async () => {
    mockImportProject.mockRejectedValueOnce(
      new ImportCoordinatorError(
        'E_POST_COMMIT_REFRESH_FAILED',
        'technical repository refresh details',
      ),
    );
    const screen = await render(<ProjectListScreen />);
    await openNamingSheet(screen);
    await press(screen.getByRole('button', { name: COPY.import.confirmLabel }));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        COPY.import.postCommitTitle,
        COPY.import.postCommitMessage,
      );
    });
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});
