import { DevelopmentLog, type DevelopmentLogEntry } from '@/services/DevelopmentLog';
import { DevelopmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import { sanitizeDiagnosticValue } from '@/utils/diagnostics';

const FIXED_DATE = new Date('2026-07-31T12:00:00.000Z');

describe('DevelopmentLog', () => {
  test('keeps only the newest bounded entries and supports clearing', () => {
    const log = new DevelopmentLog({
      capacity: 3,
      enabled: true,
      now: () => FIXED_DATE,
    });
    const listener = jest.fn();
    const unsubscribe = log.subscribe(listener);

    for (let index = 1; index <= 5; index += 1) {
      log.record('info', `event-${index}`, { index });
    }

    expect(log.getEntries().map((entry) => entry.sequence)).toEqual([3, 4, 5]);
    expect(log.getEntries().map((entry) => entry.event)).toEqual(['event-3', 'event-4', 'event-5']);
    expect(listener).toHaveBeenCalledTimes(5);

    log.clear();
    expect(log.getEntries()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(6);

    unsubscribe();
    log.record('info', 'after-unsubscribe');
    expect(listener).toHaveBeenCalledTimes(6);
  });

  test('redacts known container prefixes and unknown absolute paths recursively', () => {
    const log = new DevelopmentLog({
      enabled: true,
      now: () => FIXED_DATE,
      pathPrefixes: [
        {
          prefix: 'file:///var/mobile/Containers/Data/Application/secret/Documents',
          replacement: '<documents>',
        },
      ],
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    log.record('error', 'audio.failed', {
      loadedUri:
        'file:///var/mobile/Containers/Data/Application/secret/Documents/TempoLoop/Projects/id/audio.m4a',
      unknownUri: 'failed at file:///private/var/mobile/secret.mov',
      windowsPath: 'C:\\Users\\person\\TempoLoop\\audio.m4a',
      posixPath: '/var/mobile/Containers/private/audio.m4a',
      nonFinite: Number.NaN,
      circular,
    });

    const serialized = JSON.stringify(log.getEntries());
    expect(serialized).toContain('<documents>/TempoLoop/Projects/id/audio.m4a');
    expect(serialized).toContain('<local-file>');
    expect(serialized).toContain('<absolute-path>');
    expect(serialized).toContain('[non-finite]');
    expect(serialized).toContain('[circular]');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('Users');
  });

  test('bounds nested diagnostic collections and depth', () => {
    const sanitized = sanitizeDiagnosticValue({
      list: Array.from({ length: 30 }, (_, index) => index),
      deep: { one: { two: { three: { four: 'hidden' } } } },
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('[truncated]');
    expect(serialized).not.toContain('29');
  });

  test('is inert when development logging is disabled', () => {
    const log = new DevelopmentLog({ enabled: false });
    const listener = jest.fn();
    log.subscribe(listener);
    log.record('error', 'should-not-exist', {
      path: 'file:///private/secret.mov',
    });
    log.clear();

    expect(log.getEntries()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  test('rejects an unbounded or invalid capacity', () => {
    expect(() => new DevelopmentLog({ capacity: 0 })).toThrow(RangeError);
    expect(() => new DevelopmentLog({ capacity: 1.5 })).toThrow(RangeError);
    expect(() => new DevelopmentLog({ capacity: 501 })).toThrow(RangeError);
  });
});

describe('DevelopmentDiagnosticState', () => {
  test('tracks stable native and import codes while ignoring cancellation', () => {
    const log = new DevelopmentLog({
      capacity: 10,
      enabled: true,
      now: () => FIXED_DATE,
    });
    const state = new DevelopmentDiagnosticState({ enabled: true, log });

    state.recordNativeError(
      Object.assign(new Error('Failed at file:///private/audio.m4a'), {
        code: 'E_PLAYBACK_FAILED',
      }),
      'playRange',
    );
    state.recordImportError(
      Object.assign(new Error('Too large'), { code: 'E_VIDEO_TOO_LARGE' }),
      'selectVideo',
    );
    state.recordImportError(
      Object.assign(new Error('Cancelled'), { code: 'E_CANCELLED' }),
      'importProject',
    );
    state.recordNativeError(Object.assign(new Error('Cancelled'), { code: 'E_CANCELLED' }), 'seek');

    expect(state.getSnapshot()).toEqual({
      lastNativeErrorCode: 'E_PLAYBACK_FAILED',
      lastImportErrorCode: 'E_VIDEO_TOO_LARGE',
    });
    expect(log.getEntries()).toHaveLength(2);
    expect(JSON.stringify(log.getEntries())).not.toContain('private/audio');

    state.clear();
    expect(state.getSnapshot()).toEqual({
      lastNativeErrorCode: null,
      lastImportErrorCode: null,
    });
  });

  test('normalizes arbitrary error codes', () => {
    const entries: DevelopmentLogEntry[] = [];
    const log = new DevelopmentLog({ enabled: true });
    const state = new DevelopmentDiagnosticState({ enabled: true, log });

    state.recordNativeError({ code: '../../../secret' }, 'healthCheck');
    entries.push(...log.getEntries());

    expect(state.getSnapshot().lastNativeErrorCode).toBe('E_UNKNOWN');
    expect(entries[0]?.context).toMatchObject({ code: 'E_UNKNOWN' });
  });
});
