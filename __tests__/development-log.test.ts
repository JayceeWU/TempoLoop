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

  test('never retains names, opaque source URIs, filenames, or waveform data', () => {
    const log = new DevelopmentLog({ enabled: true, now: () => FIXED_DATE });
    log.record('error', 'import.operation.failed', {
      projectName: 'Private Rehearsal',
      sourceDisplayName: 'private-video.mov',
      sourceUri: 'content://private.provider/video/42',
      fileName: 'private-video.mov',
      waveform: [0.1, 0.2, 0.3],
      samples: [0.4, 0.5],
      code: 'E_SOURCE_UNREADABLE',
    });

    const serialized = JSON.stringify(log.getEntries());
    expect(serialized).toContain('E_SOURCE_UNREADABLE');
    expect(serialized).toContain('<content-uri>');
    expect(serialized).not.toContain('Private Rehearsal');
    expect(serialized).not.toContain('private-video.mov');
    expect(serialized).not.toContain('0.1');
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
  test('tracks stable media and import codes while ignoring silent outcomes', () => {
    const log = new DevelopmentLog({
      capacity: 10,
      enabled: true,
      now: () => FIXED_DATE,
    });
    const state = new DevelopmentDiagnosticState({ enabled: true, log });

    state.recordMediaError(
      Object.assign(new Error('Private Rehearsal at content://private/video'), {
        code: 'E_AUDIO_LOAD_FAILED',
      }),
      'validateAudio',
    );
    state.recordImportError(
      Object.assign(new Error('Too large'), { code: 'E_VIDEO_TOO_LARGE' }),
      'selectVideo',
    );
    state.recordImportError(
      Object.assign(new Error('Cancelled'), { code: 'E_IMPORT_CANCELLED' }),
      'importProject',
    );

    expect(state.getSnapshot()).toEqual({
      lastMediaErrorCode: 'E_AUDIO_LOAD_FAILED',
      lastImportErrorCode: 'E_VIDEO_TOO_LARGE',
    });
    expect(log.getEntries()).toHaveLength(2);
    expect(JSON.stringify(log.getEntries())).not.toContain('Private Rehearsal');
    expect(JSON.stringify(log.getEntries())).not.toContain('content://');

    state.clear();
    expect(state.getSnapshot()).toEqual({
      lastMediaErrorCode: null,
      lastImportErrorCode: null,
    });
  });

  test('normalizes arbitrary error codes', () => {
    const entries: DevelopmentLogEntry[] = [];
    const log = new DevelopmentLog({ enabled: true });
    const state = new DevelopmentDiagnosticState({ enabled: true, log });

    state.recordMediaError({ code: '../../../secret' }, 'healthCheck');
    entries.push(...log.getEntries());

    expect(state.getSnapshot().lastMediaErrorCode).toBe('E_UNKNOWN');
    expect(entries[0]?.context).toMatchObject({ code: 'E_UNKNOWN' });
  });
});
