import { requireNativeModule } from 'expo';

import DanceAudio, {
  NATIVE_ERROR_CODES,
  NATIVE_PLAYBACK_RATES,
  NATIVE_PLAYBACK_STATES,
  type DanceAudioEvents,
  type DanceAudioNativeModule,
  type DanceAudioModuleContract,
  type ExtractAudioResult,
  type HealthCheckResult,
  type ImportProgressEvent,
  type PlaybackEvent,
  type PlaybackSnapshot,
} from '../modules/dance-audio';

jest.mock('expo', () => ({
  requireNativeModule: jest.fn(() => ({})),
}));

type IsExactly<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends <Value>() => Value extends Expected ? 1 : 2
    ? true
    : false;

type Assert<Condition extends true> = Condition;

type ExpectedMethodNames =
  | 'healthCheck'
  | 'extractAudio'
  | 'generateWaveform'
  | 'cancelTask'
  | 'loadAudio'
  | 'playRange'
  | 'playFrom'
  | 'pause'
  | 'resume'
  | 'seek'
  | 'setRate'
  | 'stopAndSeek'
  | 'getPlaybackSnapshot'
  | 'unload';

type HasExactMethodNames = Assert<IsExactly<keyof DanceAudioModuleContract, ExpectedMethodNames>>;
type HasExactHealthCheckResult = Assert<
  IsExactly<ReturnType<DanceAudioModuleContract['healthCheck']>, Promise<HealthCheckResult>>
>;
type HasExactExtractResult = Assert<
  IsExactly<ReturnType<DanceAudioModuleContract['extractAudio']>, Promise<ExtractAudioResult>>
>;
type HasExactSnapshot = Assert<
  IsExactly<Awaited<ReturnType<DanceAudioModuleContract['getPlaybackSnapshot']>>, PlaybackSnapshot>
>;
type HasExactEventNames = Assert<
  IsExactly<keyof DanceAudioEvents, 'onImportProgress' | 'onPlaybackChanged'>
>;
type HasExactImportEvent = Assert<
  IsExactly<Parameters<DanceAudioEvents['onImportProgress']>, [ImportProgressEvent]>
>;
type HasExactPlaybackEvent = Assert<
  IsExactly<Parameters<DanceAudioEvents['onPlaybackChanged']>, [PlaybackEvent]>
>;
type HasOptionalCommandGeneration = Assert<
  IsExactly<Pick<PlaybackEvent, 'commandGeneration'>, { commandGeneration?: number }>
>;
type HasTypedEventSubscription = Assert<
  IsExactly<
    Parameters<DanceAudioNativeModule['addListener']>[0],
    'onImportProgress' | 'onPlaybackChanged'
  >
>;

const TYPE_ASSERTIONS: [
  HasExactMethodNames,
  HasExactHealthCheckResult,
  HasExactExtractResult,
  HasExactSnapshot,
  HasExactEventNames,
  HasExactImportEvent,
  HasExactPlaybackEvent,
  HasOptionalCommandGeneration,
  HasTypedEventSubscription,
] = [true, true, true, true, true, true, true, true, true];

describe('DanceAudio TypeScript contract', () => {
  it('requires the custom native module without a JavaScript fallback', () => {
    expect(requireNativeModule).toHaveBeenCalledTimes(1);
    expect(requireNativeModule).toHaveBeenCalledWith('DanceAudio');
    expect(DanceAudio).toBeDefined();
  });

  it('exposes only the four supported playback rates', () => {
    expect(NATIVE_PLAYBACK_RATES).toEqual([1, 0.9, 0.8, 0.7]);
  });

  it('exposes the complete native playback state machine', () => {
    expect(NATIVE_PLAYBACK_STATES).toEqual([
      'idle',
      'loading',
      'ready',
      'playing',
      'paused',
      'seeking',
      'completed',
      'failed',
    ]);
  });

  it('exposes every stable native error code', () => {
    expect(NATIVE_ERROR_CODES).toEqual([
      'E_INVALID_URI',
      'E_FILE_NOT_FOUND',
      'E_NO_AUDIO_TRACK',
      'E_EXPORT_UNSUPPORTED',
      'E_EXPORT_FAILED',
      'E_WAVEFORM_FAILED',
      'E_INVALID_POINT_COUNT',
      'E_INVALID_RANGE',
      'E_AUDIO_NOT_LOADED',
      'E_SEEK_FAILED',
      'E_PLAYBACK_FAILED',
      'E_CANCELLED',
      'E_AUDIO_SESSION_FAILED',
      'E_INSUFFICIENT_STORAGE',
      'E_INTERNAL',
    ]);
  });

  it('keeps the public method, result, and event types exact', () => {
    expect(TYPE_ASSERTIONS).toEqual([true, true, true, true, true, true, true, true, true]);
  });
});
