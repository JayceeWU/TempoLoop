import { requireOptionalNativeModule } from 'expo';

import { PROJECT_SCHEMA_VERSION, WAVEFORM_SCHEMA_VERSION } from '@/constants/app';
import type { PlaybackSnapshot } from '@/domain/playback';
import { projectRepository } from '@/repositories/ProjectRepository';
import {
  developmentDiagnosticState,
  type DevelopmentDiagnosticState,
} from '@/services/DevelopmentDiagnosticState';
import {
  developmentLog,
  type DevelopmentLog,
  type DevelopmentLogEntry,
} from '@/services/DevelopmentLog';
import { importCoordinator } from '@/services/ImportCoordinator';
import type {
  ProjectMediaStatus,
  RecoveryDiagnostic,
  RecoveryReport,
} from '@/services/RecoveryService';
import { type StorageLayout, storageLayout } from '@/services/StorageLayout';
import type { ImportStoreSnapshot, ImportStoreStatus } from '@/stores/useImportStore';
import { useImportStore } from '@/stores/useImportStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { type ImportFileAccess, importFileAccess } from '@/utils/file';
import { type DiagnosticPathPrefix, redactDiagnosticText } from '@/utils/diagnostics';

export const DEVELOPMENT_DIAGNOSTICS_ENABLED = __DEV__;
export const TEMPO_LOOP_MEDIA_MODULE_NAME = 'TempoLoopMedia';
export const TEMPO_LOOP_MEDIA_CONTRACT_VERSION = 1;

const IDLE_PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  mode: 'idle',
  status: 'idle',
  projectId: null,
  segmentIndex: null,
  sourcePositionMs: 0,
  sourceDurationMs: 0,
  clipStartMs: 0,
  clipEndMs: null,
  rate: 1,
  commandGeneration: 0,
};

export interface DiagnosticsProjectState {
  readonly isInitialized: boolean;
  readonly projects: readonly unknown[];
  readonly mediaStatusByProjectId: Readonly<Record<string, ProjectMediaStatus>>;
  readonly corruptProjectIds: readonly string[];
  readonly repositoryDiagnostics: readonly RecoveryDiagnostic[];
  readonly error: string | null;
}

export interface DiagnosticsMediaAvailabilityDependency {
  isAvailable(): boolean;
}

export interface DiagnosticsImportDependency {
  isImportActive(): boolean;
}

export interface DiagnosticsRepositoryDependency {
  getLastRecoveryReport(): RecoveryReport | null;
}

export interface DiagnosticsSnapshot {
  readonly generatedAtIso: string;
  readonly media: {
    readonly moduleName: typeof TEMPO_LOOP_MEDIA_MODULE_NAME;
    readonly available: boolean;
    readonly contractVersion: typeof TEMPO_LOOP_MEDIA_CONTRACT_VERSION;
    readonly lastErrorCode: string | null;
  };
  readonly playback: {
    readonly mode: PlaybackSnapshot['mode'];
    readonly status: PlaybackSnapshot['status'];
    readonly sourceLoaded: boolean;
    readonly segmentIndex: number | null;
    readonly currentTimeMs: number;
    readonly durationMs: number;
    readonly rate: PlaybackSnapshot['rate'];
    readonly activeRangeStartMs: number | null;
    readonly activeRangeEndMs: number | null;
    readonly commandGeneration: number;
  };
  readonly storage: {
    readonly availableDiskBytes: number | null;
    readonly rootPath: string;
  };
  readonly repository: {
    readonly projectSchemaVersion: number;
    readonly waveformSchemaVersion: number;
    readonly initialized: boolean;
    readonly projectCount: number;
    readonly readyProjectCount: number;
    readonly repairProjectCount: number;
    readonly corruptProjectCount: number;
    readonly lastErrorCode: string | null;
    readonly recoveryDiagnosticCodes: readonly string[];
  };
  readonly import: {
    readonly storeStatus: ImportStoreStatus;
    readonly coordinatorActive: boolean;
    readonly stage: ImportStoreSnapshot['stage'];
    readonly stageProgress: number | null;
    readonly overallProgress: number | null;
    readonly cancelRequested: boolean;
    readonly lastErrorCode: string | null;
  };
  readonly logEntries: readonly DevelopmentLogEntry[];
}

export interface DiagnosticsServiceDependencies {
  readonly mediaAvailability?: DiagnosticsMediaAvailabilityDependency;
  readonly importCoordinator?: DiagnosticsImportDependency;
  readonly repository?: DiagnosticsRepositoryDependency;
  readonly fileAccess?: Pick<ImportFileAccess, 'getAvailableDiskSpace'>;
  readonly layout?: StorageLayout;
  readonly diagnosticState?: DevelopmentDiagnosticState;
  readonly log?: DevelopmentLog;
  readonly getImportState?: () => ImportStoreSnapshot;
  readonly getProjectState?: () => DiagnosticsProjectState;
  readonly getPlaybackSnapshot?: () => PlaybackSnapshot;
  readonly now?: () => Date;
}

const expoMediaAvailability: DiagnosticsMediaAvailabilityDependency = {
  isAvailable: () =>
    requireOptionalNativeModule<Record<string, unknown>>(TEMPO_LOOP_MEDIA_MODULE_NAME) !== null,
};

function finiteNonNegativeInteger(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableStoreErrorCode(error: string | null): string | null {
  return error === null ? null : 'E_PROJECT_REPOSITORY';
}

function importIsActive(status: ImportStoreStatus): boolean {
  return (
    status === 'selecting' ||
    status === 'selected' ||
    status === 'importing' ||
    status === 'cancelling'
  );
}

export class DiagnosticsService {
  private readonly mediaAvailability: DiagnosticsMediaAvailabilityDependency;
  private readonly importCoordinator: DiagnosticsImportDependency;
  private readonly repository: DiagnosticsRepositoryDependency;
  private readonly fileAccess: Pick<ImportFileAccess, 'getAvailableDiskSpace'>;
  private readonly layout: StorageLayout;
  private readonly diagnosticState: DevelopmentDiagnosticState;
  private readonly log: DevelopmentLog;
  private readonly getImportState: () => ImportStoreSnapshot;
  private readonly getProjectState: () => DiagnosticsProjectState;
  private readonly getPlaybackSnapshot: () => PlaybackSnapshot;
  private readonly now: () => Date;

  constructor(dependencies: DiagnosticsServiceDependencies = {}) {
    this.mediaAvailability = dependencies.mediaAvailability ?? expoMediaAvailability;
    this.importCoordinator = dependencies.importCoordinator ?? importCoordinator;
    this.repository = dependencies.repository ?? projectRepository;
    this.fileAccess = dependencies.fileAccess ?? importFileAccess;
    this.layout = dependencies.layout ?? storageLayout;
    this.diagnosticState = dependencies.diagnosticState ?? developmentDiagnosticState;
    this.log = dependencies.log ?? developmentLog;
    this.getImportState = dependencies.getImportState ?? (() => useImportStore.getState());
    this.getProjectState = dependencies.getProjectState ?? (() => useProjectStore.getState());
    this.getPlaybackSnapshot = dependencies.getPlaybackSnapshot ?? (() => IDLE_PLAYBACK_SNAPSHOT);
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(playbackOverride?: PlaybackSnapshot): Promise<DiagnosticsSnapshot> {
    const playback = playbackOverride ?? this.getPlaybackSnapshot();
    const projectState = this.getProjectState();
    const importState = this.getImportState();
    const recordedErrors = this.diagnosticState.getSnapshot();
    const recoveryReport = this.repository.getLastRecoveryReport();
    const mediaStatuses = Object.values(projectState.mediaStatusByProjectId);
    const repairProjectCount = mediaStatuses.filter(
      (status) => status.state === 'needs-repair',
    ).length;
    const recoveryDiagnosticCodes = uniqueSorted([
      ...(recoveryReport?.diagnostics.map((diagnostic) => diagnostic.code) ?? []),
      ...projectState.repositoryDiagnostics.map((diagnostic) => diagnostic.code),
    ]);

    return {
      generatedAtIso: this.now().toISOString(),
      media: {
        moduleName: TEMPO_LOOP_MEDIA_MODULE_NAME,
        available: this.readMediaAvailability(),
        contractVersion: TEMPO_LOOP_MEDIA_CONTRACT_VERSION,
        lastErrorCode: recordedErrors.lastMediaErrorCode,
      },
      playback: {
        mode: playback.mode,
        status: playback.status,
        sourceLoaded: playback.projectId !== null && playback.mode !== 'idle',
        segmentIndex: playback.segmentIndex,
        currentTimeMs: finiteNonNegativeInteger(playback.sourcePositionMs) ?? 0,
        durationMs: finiteNonNegativeInteger(playback.sourceDurationMs) ?? 0,
        rate: playback.rate,
        activeRangeStartMs: playback.clipEndMs === null ? null : playback.clipStartMs,
        activeRangeEndMs: playback.clipEndMs,
        commandGeneration: finiteNonNegativeInteger(playback.commandGeneration) ?? 0,
      },
      storage: {
        availableDiskBytes: this.readAvailableDiskSpace(),
        rootPath: redactDiagnosticText(this.layout.documentsRootUri, this.pathPrefixes()),
      },
      repository: {
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        waveformSchemaVersion: WAVEFORM_SCHEMA_VERSION,
        initialized: projectState.isInitialized,
        projectCount: projectState.projects.length,
        readyProjectCount: Math.max(0, projectState.projects.length - repairProjectCount),
        repairProjectCount,
        corruptProjectCount: projectState.corruptProjectIds.length,
        lastErrorCode: stableStoreErrorCode(projectState.error),
        recoveryDiagnosticCodes,
      },
      import: {
        storeStatus: importState.status,
        coordinatorActive: this.readCoordinatorActive() || importIsActive(importState.status),
        stage: importState.stage,
        stageProgress: importState.stageProgress,
        overallProgress: importState.overallProgress,
        cancelRequested: importState.cancelRequested,
        lastErrorCode: importState.terminalError?.code ?? recordedErrors.lastImportErrorCode,
      },
      logEntries: this.log.getEntries(),
    };
  }

  clearRecordedDiagnostics(): void {
    this.log.clear();
    this.diagnosticState.clear();
  }

  subscribeToLog(listener: () => void): () => void {
    return this.log.subscribe(listener);
  }

  getLogEntries(): readonly DevelopmentLogEntry[] {
    return this.log.getEntries();
  }

  private readMediaAvailability(): boolean {
    try {
      return this.mediaAvailability.isAvailable();
    } catch {
      return false;
    }
  }

  private readCoordinatorActive(): boolean {
    try {
      return this.importCoordinator.isImportActive();
    } catch {
      return false;
    }
  }

  private readAvailableDiskSpace(): number | null {
    try {
      return finiteNonNegativeInteger(this.fileAccess.getAvailableDiskSpace());
    } catch {
      return null;
    }
  }

  private pathPrefixes(): readonly DiagnosticPathPrefix[] {
    return [
      {
        prefix: this.layout.fileSystem.documentDirectoryUri.replace(/\/+$/, ''),
        replacement: '<documents>',
      },
      {
        prefix: this.layout.fileSystem.cacheDirectoryUri.replace(/\/+$/, ''),
        replacement: '<cache>',
      },
    ];
  }
}

export const diagnosticsService = new DiagnosticsService();
