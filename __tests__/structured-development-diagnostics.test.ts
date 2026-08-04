import { DevelopmentLog } from '@/services/DevelopmentLog';
import { StructuredDevelopmentDiagnostics } from '@/services/StructuredDevelopmentDiagnostics';

describe('StructuredDevelopmentDiagnostics', () => {
  test('records safe load, stale-command, and optional overshoot events', () => {
    const log = new DevelopmentLog({ enabled: true, capacity: 20 });
    const diagnostics = new StructuredDevelopmentDiagnostics({
      enabled: true,
      log,
      segmentOvershootEnabled: true,
    });

    diagnostics.recordProjectLoadFailure({
      projectId: 'project-1',
      error: { code: 'E_PROJECT_CORRUPT', message: 'content://private/video' },
    });
    diagnostics.recordAudioLoadFailure({
      projectId: 'project-1',
      error: {
        code: 'E_AUDIO_LOAD_FAILED',
        loadFailureStage: 'native-status',
        path: 'file:///private/audio.m4a',
      },
    });
    diagnostics.recordStalePlaybackCommand({
      command: 'seek',
      commandGeneration: 4,
      currentGeneration: 5,
    });
    diagnostics.recordSegmentEndOvershoot({
      projectId: 'project-1',
      segmentIndex: 2,
      commandGeneration: 5,
      rate: 0.8,
      overshootMs: 17,
    });

    expect(log.getEntries().map((entry) => entry.event)).toEqual([
      'project.load.failed',
      'audio.load.failed',
      'playback.command.stale',
      'playback.segment.overshoot',
    ]);
    const serialized = JSON.stringify(log.getEntries());
    expect(serialized).toContain('E_PROJECT_CORRUPT');
    expect(serialized).toContain('E_AUDIO_LOAD_FAILED');
    expect(serialized).toContain('native-status');
    expect(serialized).toContain('E_PLAYBACK_COMMAND_STALE');
    expect(serialized).not.toContain('content://');
    expect(serialized).not.toContain('private/audio');
  });

  test('allows Preview builds to disable the helper completely', () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnostics = new StructuredDevelopmentDiagnostics({ enabled: false, log });

    diagnostics.recordImportStarted({ operationId: 'operation-1', projectId: 'project-1' });
    diagnostics.recordImportFailed({
      operationId: 'operation-1',
      projectId: 'project-1',
      stage: 'exporting',
      error: { code: 'E_OUTPUT_WRITE_FAILED' },
    });

    expect(log.getEntries()).toEqual([]);
  });

  test('records shared-player cleanup as an audio load failure stage', () => {
    const log = new DevelopmentLog({ enabled: true });
    const diagnostics = new StructuredDevelopmentDiagnostics({ enabled: true, log });

    diagnostics.recordAudioLoadFailure({
      operationId: 'operation-cleanup',
      error: {
        code: 'E_AUDIO_LOAD_FAILED',
        loadFailureStage: 'cleanup',
        message: 'private native cleanup details',
      },
    });

    expect(log.getEntries()).toHaveLength(1);
    expect(log.getEntries()[0]).toMatchObject({
      event: 'audio.load.failed',
      context: expect.objectContaining({ failureStage: 'cleanup' }),
    });
  });
});
