import type { PlaybackSnapshot } from '../modules/dance-audio';
import type { RecoveryReport } from '@/services/RecoveryService';
import { DevelopmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import { DevelopmentLog } from '@/services/DevelopmentLog';
import {
  DiagnosticsService,
  type DiagnosticsPlaybackState,
  type DiagnosticsProjectState,
} from '@/services/DiagnosticsService';
import { type StorageEntry, type StorageFileSystem, StorageLayout } from '@/services/StorageLayout';

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 12_300,
  durationMs: 90_000,
  rate: 0.8,
  activeRangeStartMs: 6_000,
  activeRangeEndMs: 20_000,
};

class DiagnosticsStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri =
    'file:///var/mobile/Containers/Data/Application/private-id/Documents';
  readonly cacheDirectoryUri =
    'file:///var/mobile/Containers/Data/Application/private-id/Library/Caches';

  join(...parts: readonly string[]): string {
    return parts.join('/');
  }

  ensureDirectory(): void {}
  directoryExists(): boolean {
    return false;
  }
  fileExists(): boolean {
    return false;
  }
  fileSize(): number {
    return 0;
  }
  listDirectory(): readonly StorageEntry[] {
    return [];
  }
  async readText(): Promise<string> {
    throw new Error('Not implemented for diagnostics test.');
  }
  writeText(): void {}
  async copyFile(): Promise<void> {}
  async moveFile(): Promise<void> {}
  deleteFile(): void {}
  deleteDirectory(): void {}
}

function recoveryReport(): RecoveryReport {
  return {
    index: { schemaVersion: 1, projects: [] },
    removedStagingTaskIds: [],
    removedPickedSelectionIds: [],
    removedProjectIds: [],
    orphanProjectIds: ['orphan-id'],
    diagnostics: [
      {
        code: 'UNINDEXED_PROJECT_FILES',
        projectId: 'orphan-id',
      },
    ],
  };
}

function playbackState(
  overrides: Partial<DiagnosticsPlaybackState> = {},
): DiagnosticsPlaybackState {
  return {
    snapshot: READY_SNAPSHOT,
    loadedAudioUri:
      'file:///var/mobile/Containers/Data/Application/private-id/Documents/TempoLoop/Projects/project-1/audio.m4a',
    selectedProjectId: 'project-1',
    selectedSegment: 2,
    selectedRate: 0.9,
    lastError: null,
    ...overrides,
  };
}

function projectState(overrides: Partial<DiagnosticsProjectState> = {}): DiagnosticsProjectState {
  return {
    isInitialized: true,
    projects: [{}, {}],
    error:
      'Index failed at file:///var/mobile/Containers/Data/Application/private-id/Documents/TempoLoop/projects.json',
    ...overrides,
  };
}

describe('DiagnosticsService', () => {
  test('collects health, playback, storage, repository, import, and redacted paths', async () => {
    const log = new DevelopmentLog({
      enabled: true,
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    diagnosticState.recordNativeError(
      Object.assign(new Error('Previous failure'), { code: 'E_SEEK_FAILED' }),
      'seek',
    );
    diagnosticState.recordImportError(
      Object.assign(new Error('Previous import failure'), {
        code: 'E_VIDEO_TOO_LARGE',
      }),
      'selectVideo',
    );

    const service = new DiagnosticsService({
      nativeAudio: {
        healthCheck: async () => ({ available: true, apiVersion: 1 }),
      },
      importCoordinator: { isImportActive: () => true },
      repository: { getLastRecoveryReport: recoveryReport },
      fileAccess: { getAvailableDiskSpace: () => 2_147_483_648.9 },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      diagnosticState,
      log,
      getPlaybackState: () => playbackState(),
      getProjectState: () => projectState(),
      now: () => new Date('2026-07-31T12:30:00.000Z'),
    });

    const snapshot = await service.collect();

    expect(snapshot).toMatchObject({
      generatedAtIso: '2026-07-31T12:30:00.000Z',
      native: {
        available: true,
        apiVersion: 1,
        lastErrorCode: 'E_SEEK_FAILED',
      },
      playback: {
        state: 'ready',
        loadedFileUri: '<documents>/TempoLoop/Projects/project-1/audio.m4a',
        selectedProjectId: 'project-1',
        selectedSegment: 2,
        selectedRate: 0.9,
        currentTimeMs: 12_300,
        durationMs: 90_000,
        rate: 0.8,
      },
      storage: { availableDiskBytes: 2_147_483_648 },
      repository: {
        projectSchemaVersion: 1,
        waveformSchemaVersion: 1,
        initialized: true,
        projectCount: 2,
        lastError: 'Index failed at <documents>/TempoLoop/projects.json',
        recoveryDiagnosticCodes: ['UNINDEXED_PROJECT_FILES'],
      },
      import: {
        active: true,
        lastErrorCode: 'E_VIDEO_TOO_LARGE',
      },
    });
    expect(snapshot.logEntries).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('private-id');
  });

  test('handles unavailable native health and unsafe disk values without failing collection', async () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    const service = new DiagnosticsService({
      nativeAudio: {
        healthCheck: async () => {
          throw Object.assign(new Error('Module unavailable'), {
            code: 'E_INTERNAL',
          });
        },
      },
      importCoordinator: { isImportActive: () => false },
      repository: { getLastRecoveryReport: () => null },
      fileAccess: { getAvailableDiskSpace: () => Number.POSITIVE_INFINITY },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      diagnosticState,
      log,
      getPlaybackState: () =>
        playbackState({
          snapshot: {
            ...READY_SNAPSHOT,
            state: 'idle',
            currentTimeMs: 0,
            durationMs: 0,
          },
          loadedAudioUri: null,
          selectedProjectId: null,
          selectedSegment: null,
        }),
      getProjectState: () => projectState({ error: null, projects: [] }),
    });

    const snapshot = await service.collect();

    expect(snapshot.native).toEqual({
      available: false,
      apiVersion: null,
      lastErrorCode: 'E_INTERNAL',
    });
    expect(snapshot.storage.availableDiskBytes).toBeNull();
    expect(snapshot.playback.loadedFileUri).toBeNull();
    expect(log.getEntries()).toHaveLength(1);
  });

  test('does not duplicate a native-service health failure already recorded at its boundary', async () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    const nativeFailure = Object.assign(new Error('Module unavailable'), {
      code: 'E_INTERNAL',
    });
    const service = new DiagnosticsService({
      nativeAudio: {
        healthCheck: async () => {
          diagnosticState.recordNativeError(nativeFailure, 'healthCheck');
          throw nativeFailure;
        },
      },
      importCoordinator: { isImportActive: () => false },
      repository: { getLastRecoveryReport: () => null },
      fileAccess: { getAvailableDiskSpace: () => 1_000 },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      diagnosticState,
      log,
      getPlaybackState: () => playbackState(),
      getProjectState: () => projectState({ error: null }),
    });

    await service.collect();

    expect(log.getEntries()).toHaveLength(1);
    expect(log.getEntries()[0]?.event).toBe('native.operation.failed');
  });

  test('clears only in-memory diagnostic history', async () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    diagnosticState.recordImportError(
      Object.assign(new Error('Picker failure'), { code: 'E_PICKER_RESULT_INVALID' }),
      'selectVideo',
    );
    const service = new DiagnosticsService({
      nativeAudio: {
        healthCheck: async () => ({ available: true, apiVersion: 1 }),
      },
      importCoordinator: { isImportActive: () => false },
      repository: { getLastRecoveryReport: () => null },
      fileAccess: { getAvailableDiskSpace: () => 1_000 },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      diagnosticState,
      log,
      getPlaybackState: () => playbackState(),
      getProjectState: () => projectState(),
    });

    service.clearRecordedDiagnostics();

    expect(service.getLogEntries()).toEqual([]);
    expect(diagnosticState.getSnapshot()).toEqual({
      lastNativeErrorCode: null,
      lastImportErrorCode: null,
    });
  });
});
