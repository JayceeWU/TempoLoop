import * as Crypto from 'expo-crypto';

import { WAVEFORM_POINT_COUNT } from '@/constants/app';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import { StoredWaveformSchema } from '@/domain/validation';
import { projectRepository } from '@/repositories/ProjectRepository';
import { developmentLog } from '@/services/DevelopmentLog';
import {
  TempoLoopMediaService,
  TempoLoopMediaServiceError,
  tempoLoopMediaService,
} from '@/services/TempoLoopMediaService';
import { useProjectStore } from '@/stores/useProjectStore';
import { waveformStateController } from '@/stores/useWaveformStore';
import type { TempoLoopMediaSubscription } from '../../modules/tempoloop-media';

export interface WaveformGenerationRepository {
  get(projectId: string): DanceProject | null;
  resolveAudioUri(project: DanceProject): string;
  completeWaveform(projectId: string, waveform: StoredWaveform): Promise<void>;
  updateWaveformStatus(projectId: string, status: 'pending' | 'failed'): Promise<void>;
}

export interface WaveformGenerationCoordinatorOptions {
  repository?: WaveformGenerationRepository;
  media?: Pick<
    TempoLoopMediaService,
    'generateWaveform' | 'cancelWaveform' | 'addWaveformProgressListener'
  >;
  refreshProjects?: () => Promise<void>;
  randomUuid?: () => string;
}

export class WaveformGenerationCoordinator {
  private readonly repository: WaveformGenerationRepository;
  private readonly media: Pick<
    TempoLoopMediaService,
    'generateWaveform' | 'cancelWaveform' | 'addWaveformProgressListener'
  >;
  private readonly refreshProjects: () => Promise<void>;
  private readonly randomUuid: () => string;
  private readonly queue: string[] = [];
  private active: { projectId: string; operationId: string } | null = null;
  private foreground = true;
  private drainTask: Promise<void> | null = null;
  private readonly discardedProjectIds = new Set<string>();

  constructor(options: WaveformGenerationCoordinatorOptions = {}) {
    this.repository = options.repository ?? projectRepository;
    this.media = options.media ?? tempoLoopMediaService;
    this.refreshProjects = options.refreshProjects ?? (() => useProjectStore.getState().refresh());
    this.randomUuid = options.randomUuid ?? Crypto.randomUUID;
  }

  hasPendingWork(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  syncPendingProjects(projects: readonly DanceProject[]): void {
    const pendingIds = new Set(
      projects.filter((project) => project.waveformStatus === 'pending').map(({ id }) => id),
    );
    for (const project of projects) {
      if (
        project.waveformStatus === 'pending' &&
        this.active?.projectId !== project.id &&
        !this.queue.includes(project.id)
      ) {
        this.queue.push(project.id);
      }
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (!pendingIds.has(this.queue[index]!)) this.queue.splice(index, 1);
    }
    this.publishQueue();
    this.startDrain();
  }

  enqueueProject(project: DanceProject): void {
    if (
      project.waveformStatus !== 'pending' ||
      this.active?.projectId === project.id ||
      this.queue.includes(project.id)
    ) {
      return;
    }
    this.discardedProjectIds.delete(project.id);
    this.queue.push(project.id);
    this.publishQueue();
    this.startDrain();
  }

  async retry(projectId: string): Promise<void> {
    const project = this.repository.get(projectId);
    if (project === null) return;
    if (project.waveformStatus !== 'pending') {
      await this.repository.updateWaveformStatus(projectId, 'pending');
      await this.refreshProjects();
    }
    if (this.active?.projectId !== projectId && !this.queue.includes(projectId)) {
      this.queue.push(projectId);
      this.publishQueue();
    }
    this.startDrain();
  }

  setForeground(isForeground: boolean): void {
    this.foreground = isForeground;
    if (!isForeground) {
      const active = this.active;
      if (active !== null)
        void this.media.cancelWaveform(active.operationId).catch(() => undefined);
      return;
    }
    this.startDrain();
  }

  async cancelProject(projectId: string): Promise<void> {
    this.discardedProjectIds.add(projectId);
    const queueIndex = this.queue.indexOf(projectId);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    this.publishQueue();
    if (this.active?.projectId === projectId) {
      await this.media.cancelWaveform(this.active.operationId).catch(() => undefined);
    }
  }

  private startDrain(): void {
    if (!this.foreground || this.drainTask !== null || this.queue.length === 0) return;
    this.drainTask = this.drain()
      .catch((error: unknown) => {
        developmentLog.record('error', 'waveform.queue.failed', {
          code:
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : 'E_WAVEFORM_FAILED',
        });
      })
      .finally(() => {
        this.drainTask = null;
        if (this.foreground && this.queue.length > 0) this.startDrain();
      });
  }

  private async drain(): Promise<void> {
    while (this.foreground && this.queue.length > 0) {
      const projectId = this.queue.shift()!;
      this.publishQueue();
      const project = this.repository.get(projectId);
      if (project === null || project.waveformStatus !== 'pending') continue;
      await this.generate(project);
    }
  }

  private async generate(project: DanceProject): Promise<void> {
    const operationId = this.randomUuid();
    this.active = { projectId: project.id, operationId };
    waveformStateController.start(project.id);
    let subscription: TempoLoopMediaSubscription | null = null;
    let waveformCommitted = false;

    try {
      subscription = this.media.addWaveformProgressListener((event) => {
        if (this.active?.operationId === event.operationId) {
          waveformStateController.progress(project.id, event.progress);
        }
      });
      const result = await this.media.generateWaveform({
        operationId,
        audioUri: this.repository.resolveAudioUri(project),
        durationMs: project.durationMs,
        waveformBinCount: WAVEFORM_POINT_COUNT,
      });
      const waveform = StoredWaveformSchema.parse({
        schemaVersion: 1,
        durationMs: result.durationMs,
        sampleCount: result.sampleCount,
        samples: result.samples,
      });
      await this.repository.completeWaveform(project.id, waveform);
      waveformCommitted = true;
      developmentLog.record('info', 'waveform.completed', {
        operationId,
        elapsedMs: result.elapsedMs,
        decodedFrameCount: result.decodedFrameCount,
        sampledFrameCount: result.sampledFrameCount,
        sampleBudget: WAVEFORM_POINT_COUNT * 256,
      });
      await this.refreshProjects().catch(() => undefined);
    } catch (error) {
      const cancelled =
        error instanceof TempoLoopMediaServiceError && error.code === 'E_IMPORT_CANCELLED';
      if (cancelled && this.discardedProjectIds.has(project.id)) {
        // Deletion owns the project directory; do not rewrite its metadata.
      } else if (cancelled && !this.foreground) {
        this.queue.unshift(project.id);
        this.publishQueue();
      } else if (!waveformCommitted) {
        developmentLog.record('error', 'waveform.failed', {
          operationId,
          code:
            typeof error === 'object' && error !== null && 'code' in error
              ? String(error.code)
              : 'E_WAVEFORM_FAILED',
        });
        await this.repository.updateWaveformStatus(project.id, 'failed').catch(() => undefined);
        await this.refreshProjects().catch(() => undefined);
      }
    } finally {
      try {
        subscription?.remove();
      } catch {
        // Operation identity rejects stale events even if emitter cleanup fails.
      }
      if (this.active?.operationId === operationId) this.active = null;
      this.discardedProjectIds.delete(project.id);
      waveformStateController.finish(project.id);
    }
  }

  private publishQueue(): void {
    waveformStateController.setQueue(this.queue);
  }
}

export const waveformGenerationCoordinator = new WaveformGenerationCoordinator();
