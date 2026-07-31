import type { HealthCheckResult, PlaybackSnapshot } from '../../modules/dance-audio';
import { PROJECT_SCHEMA_VERSION, WAVEFORM_SCHEMA_VERSION } from '@/constants/app';
import type { SegmentNumber } from '@/domain/segment';
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
import { nativeAudioService } from '@/services/NativeAudioService';
import { type RecoveryReport } from '@/services/RecoveryService';
import { type StorageLayout, storageLayout } from '@/services/StorageLayout';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { type ImportFileAccess, importFileAccess } from '@/utils/file';
import { type DiagnosticPathPrefix, redactDiagnosticText } from '@/utils/diagnostics';

export const DEVELOPMENT_DIAGNOSTICS_ENABLED = __DEV__;

export interface DiagnosticsPlaybackState {
  readonly snapshot: PlaybackSnapshot;
  readonly loadedAudioUri: string | null;
  readonly selectedProjectId: string | null;
  readonly selectedSegment: SegmentNumber | null;
  readonly selectedRate: PlaybackSnapshot['rate'];
  readonly lastError: { readonly code: string } | null;
}

export interface DiagnosticsProjectState {
  readonly isInitialized: boolean;
  readonly projects: readonly unknown[];
  readonly error: string | null;
}

export interface DiagnosticsNativeAudioDependency {
  healthCheck(): Promise<HealthCheckResult>;
}

export interface DiagnosticsImportDependency {
  isImportActive(): boolean;
}

export interface DiagnosticsRepositoryDependency {
  getLastRecoveryReport(): RecoveryReport | null;
}

export interface DiagnosticsSnapshot {
  readonly generatedAtIso: string;
  readonly native: {
    readonly available: boolean;
    readonly apiVersion: number | null;
    readonly lastErrorCode: string | null;
  };
  readonly playback: {
    readonly state: PlaybackSnapshot['state'];
    readonly loadedFileUri: string | null;
    readonly selectedProjectId: string | null;
    readonly selectedSegment: SegmentNumber | null;
    readonly selectedRate: PlaybackSnapshot['rate'];
    readonly currentTimeMs: number;
    readonly durationMs: number;
    readonly rate: PlaybackSnapshot['rate'];
    readonly activeRangeStartMs: number | null;
    readonly activeRangeEndMs: number | null;
  };
  readonly storage: {
    readonly availableDiskBytes: number | null;
  };
  readonly repository: {
    readonly projectSchemaVersion: number;
    readonly waveformSchemaVersion: number;
    readonly initialized: boolean;
    readonly projectCount: number;
    readonly lastError: string | null;
    readonly recoveryDiagnosticCodes: readonly string[];
  };
  readonly import: {
    readonly active: boolean;
    readonly lastErrorCode: string | null;
  };
  readonly logEntries: readonly DevelopmentLogEntry[];
}

export interface DiagnosticsServiceDependencies {
  readonly nativeAudio?: DiagnosticsNativeAudioDependency;
  readonly importCoordinator?: DiagnosticsImportDependency;
  readonly repository?: DiagnosticsRepositoryDependency;
  readonly fileAccess?: Pick<ImportFileAccess, 'getAvailableDiskSpace'>;
  readonly layout?: StorageLayout;
  readonly diagnosticState?: DevelopmentDiagnosticState;
  readonly log?: DevelopmentLog;
  readonly getPlaybackState?: () => DiagnosticsPlaybackState;
  readonly getProjectState?: () => DiagnosticsProjectState;
  readonly now?: () => Date;
}

function finiteNonNegativeInteger(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export class DiagnosticsService {
  private readonly nativeAudio: DiagnosticsNativeAudioDependency;
  private readonly importCoordinator: DiagnosticsImportDependency;
  private readonly repository: DiagnosticsRepositoryDependency;
  private readonly fileAccess: Pick<ImportFileAccess, 'getAvailableDiskSpace'>;
  private readonly layout: StorageLayout;
  private readonly diagnosticState: DevelopmentDiagnosticState;
  private readonly log: DevelopmentLog;
  private readonly getPlaybackState: () => DiagnosticsPlaybackState;
  private readonly getProjectState: () => DiagnosticsProjectState;
  private readonly now: () => Date;

  constructor(dependencies: DiagnosticsServiceDependencies = {}) {
    this.nativeAudio = dependencies.nativeAudio ?? nativeAudioService;
    this.importCoordinator = dependencies.importCoordinator ?? importCoordinator;
    this.repository = dependencies.repository ?? projectRepository;
    this.fileAccess = dependencies.fileAccess ?? importFileAccess;
    this.layout = dependencies.layout ?? storageLayout;
    this.diagnosticState = dependencies.diagnosticState ?? developmentDiagnosticState;
    this.log = dependencies.log ?? developmentLog;
    this.getPlaybackState = dependencies.getPlaybackState ?? (() => usePlaybackStore.getState());
    this.getProjectState = dependencies.getProjectState ?? (() => useProjectStore.getState());
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(): Promise<DiagnosticsSnapshot> {
    const playbackState = this.getPlaybackState();
    const projectState = this.getProjectState();
    const nativeHealth = await this.readNativeHealth();
    const recordedErrors = this.diagnosticState.getSnapshot();
    const recoveryReport = this.repository.getLastRecoveryReport();

    return {
      generatedAtIso: this.now().toISOString(),
      native: {
        available: nativeHealth?.available === true,
        apiVersion: nativeHealth?.apiVersion ?? null,
        lastErrorCode: playbackState.lastError?.code ?? recordedErrors.lastNativeErrorCode,
      },
      playback: {
        state: playbackState.snapshot.state,
        loadedFileUri:
          playbackState.loadedAudioUri === null
            ? null
            : redactDiagnosticText(playbackState.loadedAudioUri, this.pathPrefixes()),
        selectedProjectId: playbackState.selectedProjectId,
        selectedSegment: playbackState.selectedSegment,
        selectedRate: playbackState.selectedRate,
        currentTimeMs: playbackState.snapshot.currentTimeMs,
        durationMs: playbackState.snapshot.durationMs,
        rate: playbackState.snapshot.rate,
        activeRangeStartMs: playbackState.snapshot.activeRangeStartMs,
        activeRangeEndMs: playbackState.snapshot.activeRangeEndMs,
      },
      storage: {
        availableDiskBytes: this.readAvailableDiskSpace(),
      },
      repository: {
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        waveformSchemaVersion: WAVEFORM_SCHEMA_VERSION,
        initialized: projectState.isInitialized,
        projectCount: projectState.projects.length,
        lastError:
          projectState.error === null
            ? null
            : redactDiagnosticText(projectState.error, this.pathPrefixes()),
        recoveryDiagnosticCodes:
          recoveryReport?.diagnostics.map((diagnostic) => diagnostic.code) ?? [],
      },
      import: {
        active: this.importCoordinator.isImportActive(),
        lastErrorCode: recordedErrors.lastImportErrorCode,
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

  private async readNativeHealth(): Promise<HealthCheckResult | null> {
    const lastLogSequenceBeforeCheck = this.log.getEntries().at(-1)?.sequence ?? null;
    try {
      const result = await this.nativeAudio.healthCheck();
      return result.available === true && result.apiVersion === 1 ? result : null;
    } catch (error) {
      if ((this.log.getEntries().at(-1)?.sequence ?? null) === lastLogSequenceBeforeCheck) {
        this.diagnosticState.recordNativeError(error, 'healthCheck');
      }
      return null;
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
