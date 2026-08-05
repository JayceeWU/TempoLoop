import type { PlaybackSnapshot } from '@/domain/playback';
import { DevelopmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import { DevelopmentLog } from '@/services/DevelopmentLog';
import { DiagnosticsService, type DiagnosticsProjectState } from '@/services/DiagnosticsService';
import type { RecoveryReport } from '@/services/RecoveryService';
import { type StorageEntry, type StorageFileSystem, StorageLayout } from '@/services/StorageLayout';
import type { ImportStoreSnapshot } from '@/stores/useImportStore';

jest.mock('@/services/ImportCoordinator', () => ({
  importCoordinator: { isImportActive: () => false },
}));

const PLAYBACK: PlaybackSnapshot = {
  mode: 'practice',
  status: 'paused',
  projectId: 'private-project-id',
  segmentIndex: 2,
  sourcePositionMs: 12_300,
  sourceDurationMs: 90_000,
  clipStartMs: 6_000,
  clipEndMs: 20_000,
  rate: 0.8,
  commandGeneration: 9,
};

const IMPORT_SNAPSHOT: ImportStoreSnapshot = {
  status: 'importing',
  operationId: 'private-operation-id',
  projectId: 'private-project-id',
  selectionId: 'private-selection-id',
  sourceUri: 'content://private.provider/video/42',
  sourceMetadata: {
    sourceKindHint: 'video',
    displayName: 'Private Rehearsal.mov',
    sizeBytes: 1_024,
    mimeType: 'video/mp4',
  },
  suggestedName: 'Private Rehearsal',
  projectName: 'Private Rehearsal',
  cancelRequested: false,
  terminalError: null,
  stage: 'exporting',
  stageProgress: 0.5,
  overallProgress: 0.75,
};

class DiagnosticsStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri =
    'file:///data/user/0/com.tempoloop.app/files/private-container/Documents';
  readonly cacheDirectoryUri = 'file:///data/user/0/com.tempoloop.app/cache/private-container';

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
    removedImportIds: [],
    removedTemporaryFiles: [],
    corruptProjectIds: ['private-corrupt-id'],
    repairProjectIds: ['private-repair-id'],
    diagnostics: [
      { code: 'CORRUPT_PROJECT_METADATA', projectId: 'private-corrupt-id' },
      {
        code: 'PROJECT_NEEDS_REPAIR',
        projectId: 'private-repair-id',
        issues: ['WAVEFORM_MISSING'],
      },
    ],
  };
}

function projectState(overrides: Partial<DiagnosticsProjectState> = {}): DiagnosticsProjectState {
  return {
    isInitialized: true,
    projects: [{ name: 'Private Rehearsal' }, { name: 'Secret Routine' }],
    mediaStatusByProjectId: {
      ready: { state: 'ready', issues: [] },
      repair: { state: 'needs-repair', issues: ['WAVEFORM_MISSING'] },
    },
    corruptProjectIds: ['private-corrupt-id'],
    repositoryDiagnostics: [
      {
        code: 'PROJECT_NEEDS_REPAIR',
        projectId: 'private-repair-id',
        issues: ['WAVEFORM_MISSING'],
      },
    ],
    error: null,
    ...overrides,
  };
}

describe('Android DiagnosticsService', () => {
  test('collects only safe module, import, repository, and shared playback state', async () => {
    const log = new DevelopmentLog({
      enabled: true,
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    diagnosticState.recordMediaError(
      Object.assign(new Error('Private Rehearsal failed'), { code: 'E_AUDIO_LOAD_FAILED' }),
      'loadAudio',
    );
    diagnosticState.recordImportError(
      Object.assign(new Error('content://private.provider/video/42'), {
        code: 'E_VIDEO_TOO_LARGE',
      }),
      'importProject',
    );
    const service = new DiagnosticsService({
      mediaAvailability: { isAvailable: () => true },
      importCoordinator: { isImportActive: () => true },
      repository: { getLastRecoveryReport: recoveryReport },
      fileAccess: { getAvailableDiskSpace: () => 2 * 1024 * 1024 * 1024 },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      diagnosticState,
      log,
      getImportState: () => IMPORT_SNAPSHOT,
      getProjectState: () => projectState(),
      getPlaybackSnapshot: () => PLAYBACK,
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });

    const snapshot = await service.collect();

    expect(snapshot.media).toEqual({
      moduleName: 'TempoLoopMedia',
      available: true,
      contractVersion: 1,
      lastErrorCode: 'E_AUDIO_LOAD_FAILED',
    });
    expect(snapshot.playback).toMatchObject({
      mode: 'practice',
      status: 'paused',
      sourceLoaded: true,
      segmentIndex: 2,
      currentTimeMs: 12_300,
      durationMs: 90_000,
      rate: 0.8,
      activeRangeStartMs: 6_000,
      activeRangeEndMs: 20_000,
      commandGeneration: 9,
    });
    expect(snapshot.storage).toEqual({
      availableDiskBytes: 2 * 1024 * 1024 * 1024,
      rootPath: '<documents>/TempoLoop',
    });
    expect(snapshot.repository).toMatchObject({
      initialized: true,
      projectCount: 2,
      readyProjectCount: 1,
      repairProjectCount: 1,
      corruptProjectCount: 1,
      lastErrorCode: null,
      recoveryDiagnosticCodes: ['CORRUPT_PROJECT_METADATA', 'PROJECT_NEEDS_REPAIR'],
    });
    expect(snapshot.import).toEqual({
      storeStatus: 'importing',
      coordinatorActive: true,
      stage: 'exporting',
      stageProgress: 0.5,
      overallProgress: 0.75,
      cancelRequested: false,
      lastErrorCode: 'E_VIDEO_TOO_LARGE',
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Private Rehearsal');
    expect(serialized).not.toContain('Secret Routine');
    expect(serialized).not.toContain('content://');
    expect(serialized).not.toContain('private-container');
    expect(serialized).not.toContain('private-project-id');
    expect(serialized).not.toContain('.mov');
  });

  test('uses safe unavailable values and a stable repository error code', async () => {
    const service = new DiagnosticsService({
      mediaAvailability: {
        isAvailable: () => {
          throw new Error('native registry details');
        },
      },
      importCoordinator: {
        isImportActive: () => {
          throw new Error('coordinator details');
        },
      },
      repository: { getLastRecoveryReport: () => null },
      fileAccess: {
        getAvailableDiskSpace: () => {
          throw new Error('storage details');
        },
      },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      getImportState: () => ({ ...IMPORT_SNAPSHOT, status: 'idle', stage: null }),
      getProjectState: () =>
        projectState({
          error: 'Failed for Private Rehearsal at file:///private/location/project.json',
        }),
      getPlaybackSnapshot: () => ({ ...PLAYBACK, mode: 'idle', projectId: null }),
    });

    const snapshot = await service.collect();

    expect(snapshot.media.available).toBe(false);
    expect(snapshot.storage.availableDiskBytes).toBeNull();
    expect(snapshot.repository.lastErrorCode).toBe('E_PROJECT_REPOSITORY');
    expect(snapshot.playback.sourceLoaded).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Private Rehearsal');
    expect(JSON.stringify(snapshot)).not.toContain('private/location');
  });

  test('accepts the route-provided shared playback snapshot', async () => {
    const service = new DiagnosticsService({
      mediaAvailability: { isAvailable: () => true },
      importCoordinator: { isImportActive: () => false },
      repository: { getLastRecoveryReport: () => null },
      fileAccess: { getAvailableDiskSpace: () => 1_000 },
      layout: new StorageLayout(new DiagnosticsStorageFileSystem()),
      getImportState: () => ({ ...IMPORT_SNAPSHOT, status: 'idle', stage: null }),
      getProjectState: () => projectState({ projects: [] }),
      getPlaybackSnapshot: () => ({ ...PLAYBACK, status: 'error' }),
    });

    const routeSnapshot = { ...PLAYBACK, status: 'playing' as const, sourcePositionMs: 42_000 };
    const snapshot = await service.collect(routeSnapshot);

    expect(snapshot.playback.status).toBe('playing');
    expect(snapshot.playback.currentTimeMs).toBe(42_000);
  });

  test('clears only bounded in-memory diagnostic history', () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnosticState = new DevelopmentDiagnosticState({ enabled: true, log });
    diagnosticState.recordImportError(
      Object.assign(new Error('picker failure'), { code: 'E_SOURCE_UNREADABLE' }),
      'selectVideo',
    );
    const service = new DiagnosticsService({ diagnosticState, log });

    service.clearRecordedDiagnostics();

    expect(service.getLogEntries()).toEqual([]);
    expect(diagnosticState.getSnapshot()).toEqual({
      lastMediaErrorCode: null,
      lastImportErrorCode: null,
    });
  });
});
