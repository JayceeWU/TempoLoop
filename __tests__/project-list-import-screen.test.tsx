import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ProjectListScreen from '../app';
import { COPY } from '@/constants/copy';
import type { DanceProject } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';
import type { ImportProjectRequest, SelectedVideo } from '@/services/ImportCoordinator';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppError } from '@/utils/errors';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockSelectVideo = jest.fn<Promise<SelectedVideo | null>, []>();
const mockDiscardSelection = jest.fn<void, [selection: SelectedVideo]>();
const mockImportProject = jest.fn<Promise<DanceProject>, [request: ImportProjectRequest]>();
const mockCancelActiveImport = jest.fn<Promise<boolean>, []>();
const mockIsImportActive = jest.fn(() => false);
const mockInitialize = jest.fn(async () => undefined);
const mockRefresh = jest.fn(async () => undefined);
let mockEmptyAction: (() => void) | null = null;
let mockConfirmImportAction: (() => void) | null = null;
let mockCancelImportAction: (() => void) | null = null;

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockRouterPush(href),
    replace: (href: unknown) => mockRouterReplace(href),
  },
}));

jest.mock('@/components/EmptyState', () => ({
  EmptyState: ({ actionLabel, onAction }: { actionLabel: string; onAction(): void }) => {
    const { AppButton: NativeAppButton } =
      jest.requireActual<typeof import('@/components/AppButton')>('@/components/AppButton');
    mockEmptyAction = onAction;

    return <NativeAppButton label={actionLabel} onPress={onAction} />;
  },
}));

jest.mock('@/services/ImportCoordinator', () => {
  const actual = jest.requireActual<typeof import('@/services/ImportCoordinator')>(
    '@/services/ImportCoordinator',
  );

  return {
    ...actual,
    importCoordinator: {
      isImportActive: () => mockIsImportActive(),
      selectVideo: () => mockSelectVideo(),
      discardSelection: (selection: SelectedVideo) => mockDiscardSelection(selection),
      importProject: (request: ImportProjectRequest) => mockImportProject(request),
      cancelActiveImport: () => mockCancelActiveImport(),
    },
  };
});

jest.mock('@/components/ProjectNameSheet', () => ({
  ProjectNameSheet: ({
    visible,
    onCancel,
    onConfirm,
  }: {
    visible: boolean;
    onCancel(): void;
    onConfirm(name: string): void;
  }) => {
    const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
    const { AppButton: NativeAppButton } =
      jest.requireActual<typeof import('@/components/AppButton')>('@/components/AppButton');

    if (!visible) {
      return null;
    }

    const confirmImport = () => onConfirm('Practice Track');
    mockConfirmImportAction = confirmImport;

    return (
      <NativeView>
        <NativeAppButton label="Confirm test import" onPress={confirmImport} />
        <NativeAppButton label="Cancel test naming" onPress={onCancel} />
      </NativeView>
    );
  },
}));

jest.mock('@/components/ImportProgressSheet', () => ({
  ImportProgressSheet: ({ visible, onCancel }: { visible: boolean; onCancel(): void }) => {
    const { AppButton: NativeAppButton } =
      jest.requireActual<typeof import('@/components/AppButton')>('@/components/AppButton');

    if (!visible) {
      return null;
    }

    mockCancelImportAction = onCancel;
    return <NativeAppButton label="Cancel test import" onPress={onCancel} />;
  },
}));

const SELECTION: SelectedVideo = {
  selectionId: 'selection-1',
  uri: 'file:///cache/TempoLoop/Picked/selection-1/source.mov',
  sourceExtension: 'mov',
  sizeBytes: 1_024,
  fileName: 'practice.mov',
  suggestedName: 'Practice Track',
};

const IMPORTED_PROJECT: DanceProject = {
  schemaVersion: 1,
  id: 'project-1',
  name: 'Practice Track',
  createdAtIso: '2026-07-31T12:00:00.000Z',
  updatedAtIso: '2026-07-31T12:00:00.000Z',
  durationMs: 90_000,
  sourceVideoBytes: SELECTION.sizeBytes,
  audioRelativePath: 'Projects/project-1/audio.m4a',
  waveformRelativePath: 'Projects/project-1/waveform.json',
  preferredRate: 1,
  lastSelectedSegment: null,
  segments: createEmptySegments(),
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

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function openNamingSheet(screen: Awaited<ReturnType<typeof render>>): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', {
      name: COPY.projectList.emptyAction,
    }),
  );
  await waitFor(() => {
    expect(
      screen.getByRole('button', {
        name: 'Confirm test import',
      }),
    ).toBeTruthy();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEmptyAction = null;
  mockConfirmImportAction = null;
  mockCancelImportAction = null;
  mockIsImportActive.mockReturnValue(false);
  mockSelectVideo.mockResolvedValue(SELECTION);
  mockCancelActiveImport.mockResolvedValue(true);
  mockRefresh.mockResolvedValue(undefined);
  useProjectStore.setState({
    projects: [],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    refresh: mockRefresh,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('project list import completion semantics', () => {
  it('states that no project was saved when the import transaction itself fails', async () => {
    mockImportProject.mockRejectedValueOnce(new Error('native extraction failed'));
    const screen = await render(<ProjectListScreen />);
    await openNamingSheet(screen);

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Confirm test import',
      }),
    );

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        COPY.import.failureTitle,
        COPY.import.failureMessage,
      );
    });
    expect(COPY.import.failureMessage).toContain('No project was saved');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'navigation'] as const)(
    'uses the post-commit message when %s fails after repository commit',
    async (failurePoint) => {
      mockImportProject.mockResolvedValueOnce(IMPORTED_PROJECT);
      if (failurePoint === 'refresh') {
        mockRefresh.mockRejectedValueOnce(new Error('refresh failed'));
      } else {
        mockRouterReplace.mockImplementationOnce(() => {
          throw new Error('navigation failed');
        });
      }

      const screen = await render(<ProjectListScreen />);
      await openNamingSheet(screen);
      await fireEvent.press(
        screen.getByRole('button', {
          name: 'Confirm test import',
        }),
      );

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          COPY.import.postCommitTitle,
          COPY.import.postCommitMessage,
        );
      });
      const alertMessages = (Alert.alert as jest.MockedFunction<typeof Alert.alert>).mock.calls.map(
        (call) => call[1],
      );
      expect(alertMessages).not.toContain(COPY.import.failureMessage);
      expect(alertMessages.some((message) => message?.includes('No project was saved'))).toBe(
        false,
      );
      expect(mockImportProject).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledTimes(failurePoint === 'navigation' ? 1 : 0);
    },
  );

  it('uses synchronous refs to reject duplicate picker, import, and cancel calls', async () => {
    const selectionResult = deferred<SelectedVideo | null>();
    const importResult = deferred<DanceProject>();
    const cancellationResult = deferred<boolean>();
    mockSelectVideo.mockReturnValueOnce(selectionResult.promise);
    mockImportProject.mockReturnValueOnce(importResult.promise);
    mockCancelActiveImport.mockReturnValueOnce(cancellationResult.promise);
    const screen = await render(<ProjectListScreen />);

    expect(mockEmptyAction).not.toBeNull();
    await act(async () => {
      mockEmptyAction?.();
      mockEmptyAction?.();
      await Promise.resolve();
    });
    expect(mockSelectVideo).toHaveBeenCalledTimes(1);

    await act(async () => {
      selectionResult.resolve(SELECTION);
      await selectionResult.promise;
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Confirm test import',
        }),
      ).toBeTruthy(),
    );
    expect(mockConfirmImportAction).not.toBeNull();
    await act(async () => {
      mockConfirmImportAction?.();
      mockConfirmImportAction?.();
      await Promise.resolve();
    });
    expect(mockImportProject).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Cancel test import',
        }),
      ).toBeTruthy(),
    );
    expect(mockCancelImportAction).not.toBeNull();
    await act(async () => {
      mockCancelImportAction?.();
      mockCancelImportAction?.();
      await Promise.resolve();
    });
    expect(mockCancelActiveImport).toHaveBeenCalledTimes(1);

    await act(async () => {
      cancellationResult.resolve(true);
      importResult.reject(new AppError('E_CANCELLED', 'Import was cancelled by the user.'));
      await Promise.allSettled([cancellationResult.promise, importResult.promise]);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
