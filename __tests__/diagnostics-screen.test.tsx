import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DiagnosticsScreen } from '@/components/DiagnosticsScreen';
import { COPY } from '@/constants/copy';
import type { PlaybackSnapshot } from '@/domain/playback';
import type { DevelopmentLogEntry } from '@/services/DevelopmentLog';
import { DiagnosticsService, type DiagnosticsSnapshot } from '@/services/DiagnosticsService';

jest.mock('@/services/ImportCoordinator', () => ({
  importCoordinator: { isImportActive: () => false },
}));

const PLAYBACK: PlaybackSnapshot = {
  mode: 'practice',
  status: 'paused',
  projectId: 'private-project-id',
  segmentIndex: 2,
  sourcePositionMs: 12_000,
  sourceDurationMs: 90_000,
  clipStartMs: 6_000,
  clipEndMs: 20_000,
  rate: 0.8,
  commandGeneration: 4,
};

const LOG_ENTRY: DevelopmentLogEntry = {
  sequence: 1,
  timestampIso: '2026-07-31T12:00:00.000Z',
  level: 'error',
  event: 'media.operation.failed',
  context: { code: 'E_AUDIO_LOAD_FAILED', operation: 'loadAudio' },
};

function diagnosticsSnapshot(commandGeneration = 4): DiagnosticsSnapshot {
  return {
    generatedAtIso: '2026-07-31T12:00:00.000Z',
    media: {
      moduleName: 'TempoLoopMedia',
      available: true,
      contractVersion: 1,
      lastErrorCode: 'E_AUDIO_LOAD_FAILED',
    },
    playback: {
      mode: 'practice',
      status: 'paused',
      sourceLoaded: true,
      segmentIndex: 2,
      currentTimeMs: 12_000,
      durationMs: 90_000,
      rate: 0.8,
      activeRangeStartMs: 6_000,
      activeRangeEndMs: 20_000,
      commandGeneration,
    },
    storage: {
      availableDiskBytes: 2 * 1024 * 1024 * 1024,
      rootPath: '<documents>/TempoLoop',
    },
    repository: {
      projectSchemaVersion: 1,
      waveformSchemaVersion: 1,
      initialized: true,
      projectCount: 2,
      readyProjectCount: 1,
      repairProjectCount: 1,
      corruptProjectCount: 1,
      lastErrorCode: null,
      recoveryDiagnosticCodes: ['CORRUPT_PROJECT_METADATA'],
    },
    import: {
      storeStatus: 'importing',
      coordinatorActive: true,
      stage: 'waveform',
      stageProgress: 0.5,
      overallProgress: 0.75,
      cancelRequested: false,
      lastErrorCode: 'E_VIDEO_TOO_LARGE',
    },
    logEntries: [LOG_ENTRY],
  };
}

class FakeDiagnosticsService extends DiagnosticsService {
  collectCallCount = 0;
  clearCallCount = 0;
  receivedPlayback: PlaybackSnapshot | undefined;
  private entries: readonly DevelopmentLogEntry[] = [LOG_ENTRY];

  override async collect(playback?: PlaybackSnapshot): Promise<DiagnosticsSnapshot> {
    this.collectCallCount += 1;
    this.receivedPlayback = playback;
    return { ...diagnosticsSnapshot(), logEntries: this.entries };
  }

  override clearRecordedDiagnostics(): void {
    this.clearCallCount += 1;
    this.entries = [];
  }

  override subscribeToLog(): () => void {
    return () => undefined;
  }

  override getLogEntries(): readonly DevelopmentLogEntry[] {
    return this.entries;
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise!: (value: Value) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class ControlledDiagnosticsService extends DiagnosticsService {
  readonly requests: Deferred<DiagnosticsSnapshot>[] = [];
  unsubscribeCallCount = 0;

  override collect(): Promise<DiagnosticsSnapshot> {
    const request = deferred<DiagnosticsSnapshot>();
    this.requests.push(request);
    return request.promise;
  }

  override subscribeToLog(): () => void {
    return () => {
      this.unsubscribeCallCount += 1;
    };
  }

  override getLogEntries(): readonly DevelopmentLogEntry[] {
    return [];
  }
}

describe('Android DiagnosticsScreen', () => {
  test('renders safe TempoLoopMedia, import, repository, and expo-audio state', async () => {
    const service = new FakeDiagnosticsService();
    const screen = await render(
      <DiagnosticsScreen onClose={jest.fn()} playbackSnapshot={PLAYBACK} service={service} />,
    );

    await waitFor(() => expect(screen.getAllByText(COPY.diagnostics.mediaSection)).toHaveLength(2));
    expect(service.receivedPlayback).toBe(PLAYBACK);
    expect(screen.getByText(COPY.diagnostics.playbackSection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.repositorySection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.importSection)).toBeOnTheScreen();
    expect(screen.getByText('<documents>/TempoLoop')).toBeOnTheScreen();
    expect(screen.getByText('2048 MB')).toBeOnTheScreen();
    expect(screen.getByText('E_AUDIO_LOAD_FAILED')).toBeOnTheScreen();
    expect(screen.getByText('E_VIDEO_TOO_LARGE')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('private-project-id');
    expect(JSON.stringify(screen.toJSON())).not.toContain('content://');
  });

  test('supports refresh, clear, and close actions', async () => {
    const service = new FakeDiagnosticsService();
    const onClose = jest.fn();
    const screen = await render(
      <DiagnosticsScreen onClose={onClose} playbackSnapshot={PLAYBACK} service={service} />,
    );

    await waitFor(() => expect(service.collectCallCount).toBe(1));
    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.refresh }));
    await waitFor(() => expect(service.collectCallCount).toBe(2));
    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.clear }));
    expect(service.clearCallCount).toBe(1);
    expect(screen.getByText(COPY.diagnostics.logEmpty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.back }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clears a failed state after a successful retry', async () => {
    const service = new ControlledDiagnosticsService();
    const screen = await render(<DiagnosticsScreen onClose={jest.fn()} service={service} />);

    await act(async () => {
      service.requests[0]?.reject(new Error('First collection failed'));
      await Promise.resolve();
    });
    expect(screen.getByText(COPY.diagnostics.loadError)).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: COPY.diagnostics.refresh })[0]!);
    await act(async () => {
      service.requests[1]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText(COPY.diagnostics.loadError)).toBeNull());
  });

  test('ignores stale refresh completion and completion after unmount', async () => {
    const service = new ControlledDiagnosticsService();
    const screen = await render(<DiagnosticsScreen onClose={jest.fn()} service={service} />);
    await act(async () => {
      service.requests[0]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });

    const refreshButton = screen.getByRole('button', { name: COPY.diagnostics.refresh });
    await fireEvent.press(refreshButton);
    await fireEvent.press(refreshButton);
    await act(async () => {
      service.requests[2]?.resolve(diagnosticsSnapshot(12));
      await Promise.resolve();
    });
    expect(screen.getByText('12')).toBeOnTheScreen();

    await act(async () => {
      service.requests[1]?.resolve(diagnosticsSnapshot(11));
      await Promise.resolve();
    });
    expect(screen.queryByText('11')).toBeNull();

    await fireEvent.press(refreshButton);
    await screen.unmount();
    await act(async () => {
      service.requests[3]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });
    expect(service.unsubscribeCallCount).toBe(1);
  });
});
