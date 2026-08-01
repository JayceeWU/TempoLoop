import type { PlaybackRate } from '@/domain/playback';
import {
  PlaybackCoordinator,
  type TempoLoopAudioStatus,
  type TempoLoopPlayerPort,
} from '@/playback/PlaybackCoordinator';
import { DevelopmentLog } from '@/services/DevelopmentLog';
import {
  StructuredDevelopmentDiagnostics,
  type StructuredDiagnosticsRecorder,
} from '@/services/StructuredDevelopmentDiagnostics';

function nativeStatus(overrides: Partial<TempoLoopAudioStatus> = {}): TempoLoopAudioStatus {
  return {
    currentTime: 0,
    duration: 120,
    playing: false,
    didJustFinish: false,
    isLoaded: true,
    isBuffering: false,
    playbackRate: 1,
    error: null,
    ...overrides,
  };
}

class FakePlayer implements TempoLoopPlayerPort {
  readonly calls: string[] = [];
  autoResolveSeeks = true;
  private readonly pendingSeekResolutions: Array<() => void> = [];

  pause(): void {
    this.calls.push('pause');
  }

  play(): void {
    this.calls.push('play');
  }

  replace(sourceUri: string | null): void {
    this.calls.push(`replace:${sourceUri ?? 'null'}`);
  }

  seekTo(positionSeconds: number): Promise<void> {
    this.calls.push(`seek:${positionSeconds}`);
    if (this.autoResolveSeeks) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pendingSeekResolutions.push(resolve);
    });
  }

  setRate(rate: PlaybackRate): void {
    this.calls.push(`rate:${rate}`);
  }

  resolveSeek(index = 0): void {
    const resolution = this.pendingSeekResolutions.splice(index, 1)[0];
    if (resolution === undefined) {
      throw new Error('No pending seek exists.');
    }
    resolution();
  }
}

const activeCoordinators: PlaybackCoordinator[] = [];

function createCoordinator(
  player: FakePlayer,
  diagnostics?: StructuredDiagnosticsRecorder,
): PlaybackCoordinator {
  const coordinator = new PlaybackCoordinator(player, undefined, diagnostics);
  activeCoordinators.push(coordinator);
  return coordinator;
}

async function enterPractice(
  coordinator: PlaybackCoordinator,
  rate: PlaybackRate = 1,
): Promise<void> {
  const operation = coordinator.enterPractice(
    {
      projectId: 'project-a',
      audioUri: 'file:///documents/TempoLoop/projects/project-a/audio.m4a',
      durationMs: 120_000,
    },
    rate,
  );
  coordinator.handleNativeStatus(nativeStatus());
  await expect(operation).resolves.toBe(true);
}

describe('PlaybackCoordinator', () => {
  afterEach(() => {
    for (const coordinator of activeCoordinators.splice(0)) {
      coordinator.dispose();
    }
  });

  it('loads one local source and enters editor mode at exactly 1.0x', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    const operation = coordinator.enterEditor({
      projectId: 'project-a',
      audioUri: 'file:///documents/TempoLoop/projects/project-a/audio.m4a',
      durationMs: 120_000,
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'editor',
      status: 'loading',
      rate: 1,
      commandGeneration: 1,
    });
    coordinator.handleNativeStatus(nativeStatus({ currentTime: 1.234 }));
    await expect(operation).resolves.toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'ready',
      sourcePositionMs: 1_234,
      sourceDurationMs: 120_000,
    });
    expect(player.calls).toEqual([
      'pause',
      'rate:1',
      'replace:file:///documents/TempoLoop/projects/project-a/audio.m4a',
    ]);
  });

  it('plays a practice clip and atomically resets to its lead-in at the end', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator, 0.8);
    await expect(
      coordinator.preparePracticeSegment({
        segmentIndex: 2,
        clipStartMs: 10_000,
        clipEndMs: 20_000,
        rate: 0.8,
      }),
    ).resolves.toBe(true);
    await expect(coordinator.togglePractice()).resolves.toBe(true);

    coordinator.handleNativeStatus(
      nativeStatus({ currentTime: 19.971, playing: true, playbackRate: 0.8 }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'practice',
      status: 'ready',
      segmentIndex: 2,
      sourcePositionMs: 10_000,
      clipStartMs: 10_000,
      clipEndMs: 20_000,
      rate: 0.8,
    });
    expect(player.calls.slice(-2)).toEqual(['pause', 'seek:10']);
  });

  it('does not let segment A seek completion overwrite a newer segment B command', async () => {
    const player = new FakePlayer();
    const log = new DevelopmentLog({ enabled: true });
    const diagnostics = new StructuredDevelopmentDiagnostics({ enabled: true, log });
    const coordinator = createCoordinator(player, diagnostics);
    await enterPractice(coordinator);
    player.autoResolveSeeks = false;

    const segmentA = coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    const segmentB = coordinator.preparePracticeSegment({
      segmentIndex: 1,
      clipStartMs: 14_000,
      clipEndMs: 30_000,
      rate: 1,
    });

    player.resolveSeek(0);
    await expect(segmentA).resolves.toBe(false);
    expect(log.getEntries()).toContainEqual(
      expect.objectContaining({
        event: 'playback.command.stale',
        context: expect.objectContaining({
          command: 'seek',
          code: 'E_PLAYBACK_COMMAND_STALE',
        }),
      }),
    );
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'loading', segmentIndex: 1 });

    player.resolveSeek(0);
    await expect(segmentB).resolves.toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'ready',
      segmentIndex: 1,
      sourcePositionMs: 14_000,
    });
  });

  it('allows only the newest of two rapid Play preparations to start audio', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    player.autoResolveSeeks = false;

    const firstPlay = coordinator.togglePractice();
    const secondPlay = coordinator.togglePractice();
    player.resolveSeek(0);
    await expect(firstPlay).resolves.toBe(false);
    player.resolveSeek(0);
    await expect(secondPlay).resolves.toBe(true);

    expect(player.calls.filter((call) => call === 'play')).toHaveLength(1);
    expect(coordinator.getSnapshot().status).toBe('playing');
  });

  it('does not let a seek from the previous project mutate the replacement project', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    player.autoResolveSeeks = false;
    const staleSegment = coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });

    const replacement = coordinator.enterPractice(
      {
        projectId: 'project-b',
        audioUri: 'file:///documents/TempoLoop/projects/project-b/audio.m4a',
        durationMs: 60_000,
      },
      0.9,
    );
    player.resolveSeek(0);
    await expect(staleSegment).resolves.toBe(false);
    coordinator.handleNativeStatus(nativeStatus({ duration: 60 }));
    await expect(replacement).resolves.toBe(true);

    expect(coordinator.getSnapshot()).toMatchObject({
      projectId: 'project-b',
      segmentIndex: null,
      sourceDurationMs: 60_000,
      status: 'ready',
    });
  });

  it('keeps the route inactive when a preparation seek finishes after exit', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    player.autoResolveSeeks = false;
    const preparation = coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });

    coordinator.deactivate();
    player.resolveSeek(0);
    await expect(preparation).resolves.toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'idle',
      status: 'idle',
      projectId: null,
    });
  });

  it('lets manual segment selection win a race with the automatic reset seek', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    await coordinator.togglePractice();
    player.autoResolveSeeks = false;

    coordinator.handleNativeStatus(nativeStatus({ currentTime: 19.971, playing: true }));
    const manualSelection = coordinator.preparePracticeSegment({
      segmentIndex: 1,
      clipStartMs: 24_000,
      clipEndMs: 40_000,
      rate: 1,
    });
    player.resolveSeek(0);
    await Promise.resolve();
    player.resolveSeek(0);
    await expect(manualSelection).resolves.toBe(true);

    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'ready',
      segmentIndex: 1,
      sourcePositionMs: 24_000,
      clipStartMs: 24_000,
      clipEndMs: 40_000,
    });
  });

  it('cancels a pending replay seek when pause wins a rapid command race', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });

    coordinator.handleNativeStatus(nativeStatus({ currentTime: 21 }));
    player.autoResolveSeeks = false;
    const play = coordinator.togglePractice();
    coordinator.pause();
    player.resolveSeek(0);

    await expect(play).resolves.toBe(false);
    expect(player.calls.at(-1)).not.toBe('play');
    expect(coordinator.getSnapshot().status).toBe('paused');
  });

  it('changes practice rate without seeking or replacing the source', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    await coordinator.togglePractice();
    const callCount = player.calls.length;

    expect(coordinator.setRate(0.7)).toBe(true);
    expect(player.calls.slice(callCount)).toEqual(['rate:0.7']);
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'playing', rate: 0.7 });
  });

  it('clears a retained source by its project id after route deactivation', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    coordinator.deactivate();

    expect(coordinator.clearSource('project-a')).toBe(true);
    expect(coordinator.getActiveSourceUri()).toBeNull();
    expect(player.calls.at(-1)).toBe('replace:null');
  });

  it('clears idle coordinator state without mutating the native player', () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    const generation = coordinator.getSnapshot().commandGeneration;

    expect(coordinator.clearSource()).toBe(true);

    expect(player.calls).toEqual([]);
    expect(coordinator.getActiveSourceUri()).toBeNull();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'idle',
      status: 'idle',
      commandGeneration: generation + 1,
    });
  });

  it('rejects Android focus-gain auto-resume after an interruption', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    await coordinator.togglePractice();
    coordinator.handleNativeStatus(nativeStatus({ currentTime: 5, playing: true }));

    // Native focus loss pauses first; expo-audio subsequently reports a
    // focus-gain restart without a TempoLoop play command.
    coordinator.handleNativeStatus(nativeStatus({ currentTime: 5, playing: false }));
    const callsBeforeRestart = player.calls.length;
    coordinator.handleNativeStatus(nativeStatus({ currentTime: 5, playing: true }));

    expect(player.calls.slice(callsBeforeRestart)).toEqual(['pause']);
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'paused',
      sourcePositionMs: 5_000,
    });
  });

  it('rejects a native restart after an explicit lifecycle pause', async () => {
    const player = new FakePlayer();
    const coordinator = createCoordinator(player);
    await enterPractice(coordinator);
    await coordinator.preparePracticeSegment({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      rate: 1,
    });
    await coordinator.togglePractice();
    coordinator.pause();
    const callsBeforeRestart = player.calls.length;

    coordinator.handleNativeStatus(nativeStatus({ currentTime: 5, playing: true }));

    expect(player.calls.slice(callsBeforeRestart)).toEqual(['pause']);
    expect(coordinator.getSnapshot().status).toBe('paused');
  });
});
