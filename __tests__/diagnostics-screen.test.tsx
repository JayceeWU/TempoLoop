import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { PlaybackSnapshot } from '../modules/dance-audio';
import { DiagnosticsScreen } from '@/components/DiagnosticsScreen';
import { COPY } from '@/constants/copy';
import type { DevelopmentLogEntry } from '@/services/DevelopmentLog';
import { DiagnosticsService, type DiagnosticsSnapshot } from '@/services/DiagnosticsService';

const PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  state: 'paused',
  currentTimeMs: 12_000,
  durationMs: 90_000,
  rate: 0.8,
  activeRangeStartMs: 6_000,
  activeRangeEndMs: 20_000,
};

const LOG_ENTRY: DevelopmentLogEntry = {
  sequence: 1,
  timestampIso: '2026-07-31T12:00:00.000Z',
  level: 'error',
  event: 'native.operation.failed',
  context: { code: 'E_SEEK_FAILED' },
};

function diagnosticsSnapshot(): DiagnosticsSnapshot {
  return {
    generatedAtIso: '2026-07-31T12:00:00.000Z',
    native: {
      available: true,
      apiVersion: 1,
      lastErrorCode: 'E_SEEK_FAILED',
    },
    playback: {
      state: PLAYBACK_SNAPSHOT.state,
      loadedFileUri: '<documents>/TempoLoop/Projects/project-1/audio.m4a',
      selectedProjectId: 'project-1',
      selectedSegment: 2,
      selectedRate: 0.9,
      currentTimeMs: PLAYBACK_SNAPSHOT.currentTimeMs,
      durationMs: PLAYBACK_SNAPSHOT.durationMs,
      rate: PLAYBACK_SNAPSHOT.rate,
      activeRangeStartMs: PLAYBACK_SNAPSHOT.activeRangeStartMs,
      activeRangeEndMs: PLAYBACK_SNAPSHOT.activeRangeEndMs,
    },
    storage: { availableDiskBytes: 2 * 1024 * 1024 * 1024 },
    repository: {
      projectSchemaVersion: 1,
      waveformSchemaVersion: 1,
      initialized: true,
      projectCount: 2,
      lastError: null,
      recoveryDiagnosticCodes: ['UNINDEXED_PROJECT_FILES'],
    },
    import: {
      active: false,
      lastErrorCode: 'E_VIDEO_TOO_LARGE',
    },
    logEntries: [LOG_ENTRY],
  };
}

class FakeDiagnosticsService extends DiagnosticsService {
  collectCallCount = 0;
  clearCallCount = 0;
  private entries: readonly DevelopmentLogEntry[] = [LOG_ENTRY];

  override async collect(): Promise<DiagnosticsSnapshot> {
    this.collectCallCount += 1;
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

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
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

describe('DiagnosticsScreen', () => {
  test('renders the required development diagnostics with only redacted paths', async () => {
    const service = new FakeDiagnosticsService();
    const screen = await render(<DiagnosticsScreen onClose={jest.fn()} service={service} />);

    await waitFor(() => {
      expect(screen.getByText(COPY.diagnostics.nativeSection)).toBeOnTheScreen();
    });

    expect(screen.getByText(COPY.diagnostics.playbackSection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.storageSection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.repositorySection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.importSection)).toBeOnTheScreen();
    expect(screen.getByText(COPY.diagnostics.logSection)).toBeOnTheScreen();
    expect(
      screen.getByText('<documents>/TempoLoop/Projects/project-1/audio.m4a'),
    ).toBeOnTheScreen();
    expect(screen.getByText('2048 MB')).toBeOnTheScreen();
    expect(screen.getByText('E_SEEK_FAILED')).toBeOnTheScreen();
    expect(screen.getByText('E_VIDEO_TOO_LARGE')).toBeOnTheScreen();
    expect(screen.toJSON()).not.toContain('file:///');
  });

  test('supports refresh, clear, and close actions', async () => {
    const service = new FakeDiagnosticsService();
    const onClose = jest.fn();
    const screen = await render(<DiagnosticsScreen onClose={onClose} service={service} />);

    await waitFor(() => expect(service.collectCallCount).toBe(1));

    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.refresh }));
    await waitFor(() => expect(service.collectCallCount).toBe(2));

    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.clear }));
    expect(service.clearCallCount).toBe(1);
    expect(screen.getByText(COPY.diagnostics.logEmpty)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: COPY.diagnostics.clear })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: COPY.diagnostics.back }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clears a failed state after a successful retry', async () => {
    const service = new ControlledDiagnosticsService();
    const screen = await render(<DiagnosticsScreen onClose={jest.fn()} service={service} />);
    expect(service.requests).toHaveLength(1);

    await act(async () => {
      service.requests[0]?.reject(new Error('First collection failed'));
      await Promise.resolve();
    });
    expect(screen.getByText(COPY.diagnostics.loadError)).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: COPY.diagnostics.refresh })[0]!);
    expect(service.requests).toHaveLength(2);
    await act(async () => {
      service.requests[1]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText(COPY.diagnostics.loadError)).toBeNull();
      expect(screen.getByText(COPY.diagnostics.nativeSection)).toBeOnTheScreen();
    });
  });

  test('ignores stale refresh completion and completion after unmount', async () => {
    const service = new ControlledDiagnosticsService();
    const screen = await render(<DiagnosticsScreen onClose={jest.fn()} service={service} />);
    await act(async () => {
      service.requests[0]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });

    const refreshButton = screen.getByRole('button', {
      name: COPY.diagnostics.refresh,
    });
    await fireEvent.press(refreshButton);
    await fireEvent.press(refreshButton);
    expect(service.requests).toHaveLength(3);

    await act(async () => {
      service.requests[2]?.resolve({
        ...diagnosticsSnapshot(),
        playback: {
          ...diagnosticsSnapshot().playback,
          selectedProjectId: 'newer-project',
        },
      });
      await Promise.resolve();
    });
    expect(screen.getByText('newer-project')).toBeOnTheScreen();

    await act(async () => {
      service.requests[1]?.resolve({
        ...diagnosticsSnapshot(),
        playback: {
          ...diagnosticsSnapshot().playback,
          selectedProjectId: 'stale-project',
        },
      });
      await Promise.resolve();
    });
    expect(screen.queryByText('stale-project')).toBeNull();
    expect(screen.getByText('newer-project')).toBeOnTheScreen();

    await fireEvent.press(refreshButton);
    expect(service.requests).toHaveLength(4);
    await screen.unmount();
    await act(async () => {
      service.requests[3]?.resolve(diagnosticsSnapshot());
      await Promise.resolve();
    });
    expect(service.unsubscribeCallCount).toBe(1);
  });
});
