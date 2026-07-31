import type { NativeErrorCode } from '../modules/dance-audio';
import {
  AppError,
  NATIVE_ERROR_USER_MESSAGES,
  isNativeErrorCode,
  toAppError,
} from '@/utils/errors';

const ALL_NATIVE_ERROR_CODES: readonly NativeErrorCode[] = [
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
];

describe('native audio error mapping', () => {
  it('recognizes every stable native error code', () => {
    ALL_NATIVE_ERROR_CODES.forEach((code) => {
      expect(isNativeErrorCode(code)).toBe(true);
    });

    expect(isNativeErrorCode('E_SOMETHING_NEW')).toBe(false);
  });

  it('preserves the native code and technical message', () => {
    const nativeError = Object.assign(new Error('AVFoundation export failed'), {
      code: 'E_EXPORT_FAILED',
    });

    const result = toAppError(nativeError);

    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe('E_EXPORT_FAILED');
    expect(result.userMessage).toBe('TempoLoop could not extract audio from this video.');
    expect(result.technicalMessage).toBe('AVFoundation export failed');
    expect(result.originalError).toBe(nativeError);
    expect(result.shouldAlert).toBe(true);
  });

  it('maps an unknown rejection to a safe internal error', () => {
    const result = toAppError(
      Object.assign(new Error('private implementation detail'), {
        code: 'E_UNKNOWN_NATIVE_CODE',
      }),
    );

    expect(result.code).toBe('E_INTERNAL');
    expect(result.userMessage).toBe(NATIVE_ERROR_USER_MESSAGES.E_INTERNAL);
    expect(result.message).not.toContain('private implementation detail');
    expect(result.technicalMessage).toBe('private implementation detail');
  });

  it('marks cancellation as silent', () => {
    const result = toAppError({
      code: 'E_CANCELLED',
      message: 'The native task was cancelled.',
    });

    expect(result.code).toBe('E_CANCELLED');
    expect(result.userMessage).toBeNull();
    expect(result.isCancellation).toBe(true);
    expect(result.shouldAlert).toBe(false);
  });

  it('does not wrap an AppError a second time', () => {
    const original = new AppError('E_FILE_NOT_FOUND', 'Missing at the expected local URL.');

    expect(toAppError(original)).toBe(original);
  });
});
