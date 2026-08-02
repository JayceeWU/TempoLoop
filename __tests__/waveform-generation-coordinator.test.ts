import { createEmptySegments } from '@/domain/segment';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import {
  WaveformGenerationCoordinator,
  type WaveformGenerationRepository,
} from '@/services/WaveformGenerationCoordinator';
import { TempoLoopMediaServiceError } from '@/services/TempoLoopMediaService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function project(waveformStatus: DanceProject['waveformStatus'] = 'pending'): DanceProject {
  return {
    schemaVersion: 1,
    id: PROJECT_ID,
    name: 'Practice',
    createdAtIso: '2026-08-01T12:00:00.000Z',
    updatedAtIso: '2026-08-01T12:00:00.000Z',
    audioFileName: 'audio.m4a',
    waveformFileName: 'waveform.json',
    waveformStatus,
    durationMs: 90_000,
    sourceDisplayName: null,
    sourceSizeBytes: null,
    selectedRate: 1,
    leadInMs: 6_000,
    segments: createEmptySegments(),
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for waveform coordinator.');
}

function createHarness(initialStatus: DanceProject['waveformStatus'] = 'pending') {
  let storedProject = project(initialStatus);
  let storedWaveform: StoredWaveform | null = null;
  const repository: WaveformGenerationRepository = {
    get: jest.fn(() => storedProject),
    resolveAudioUri: jest.fn(() => 'file:///data/user/0/com.tempoloop.app/files/audio.m4a'),
    completeWaveform: jest.fn(async (_projectId, waveform) => {
      storedWaveform = waveform;
      storedProject = { ...storedProject, waveformStatus: 'ready' };
    }),
    updateWaveformStatus: jest.fn(async (_projectId, status) => {
      storedProject = { ...storedProject, waveformStatus: status };
    }),
  };
  const samples = Array.from({ length: 2_048 }, (_, index) => (index % 32) / 31);
  const generateWaveform = jest.fn(async () => ({
    durationMs: 90_000,
    sampleCount: 2_048,
    samples,
    decodedFrameCount: 4_320_000,
    sampledFrameCount: 524_288,
    elapsedMs: 350,
  }));
  const media = {
    generateWaveform,
    cancelWaveform: jest.fn(async () => undefined),
    addWaveformProgressListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  const refreshProjects = jest.fn(async () => undefined);
  const coordinator = new WaveformGenerationCoordinator({
    repository,
    media,
    refreshProjects,
    randomUuid: () => '22222222-2222-4222-8222-222222222222',
  });
  return {
    coordinator,
    generateWaveform,
    refreshProjects,
    repository,
    media,
    getProject: () => storedProject,
    getWaveform: () => storedWaveform,
  };
}

describe('WaveformGenerationCoordinator', () => {
  it('serially completes a pending waveform without blocking project availability', async () => {
    const harness = createHarness();
    harness.coordinator.syncPendingProjects([harness.getProject()]);

    expect(harness.coordinator.hasPendingWork()).toBe(true);
    await waitUntil(() => !harness.coordinator.hasPendingWork());

    expect(harness.generateWaveform).toHaveBeenCalledWith(
      expect.objectContaining({ waveformBinCount: 2_048, durationMs: 90_000 }),
    );
    expect(harness.getProject().waveformStatus).toBe('ready');
    expect(harness.getWaveform()?.samples).toHaveLength(2_048);
  });

  it('marks failures without deleting audio and can retry the same project', async () => {
    const harness = createHarness();
    harness.generateWaveform.mockRejectedValueOnce(
      new TempoLoopMediaServiceError('E_WAVEFORM_FAILED', 'decoder failed'),
    );
    harness.coordinator.enqueueProject(harness.getProject());
    await waitUntil(() => !harness.coordinator.hasPendingWork());

    expect(harness.getProject().waveformStatus).toBe('failed');
    expect(harness.repository.completeWaveform).not.toHaveBeenCalled();

    await harness.coordinator.retry(PROJECT_ID);
    await waitUntil(() => !harness.coordinator.hasPendingWork());

    expect(harness.generateWaveform).toHaveBeenCalledTimes(2);
    expect(harness.getProject().waveformStatus).toBe('ready');
  });
});
