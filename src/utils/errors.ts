import type { NativeErrorCode } from '../../modules/dance-audio';

export const NATIVE_ERROR_USER_MESSAGES = {
  E_INVALID_URI: 'TempoLoop could not access this local file.',
  E_FILE_NOT_FOUND: 'The project audio file is missing.',
  E_NO_AUDIO_TRACK: 'This video does not contain a usable audio track.',
  E_EXPORT_UNSUPPORTED: 'This video uses an audio format that TempoLoop cannot import.',
  E_EXPORT_FAILED: 'TempoLoop could not extract audio from this video.',
  E_WAVEFORM_FAILED:
    'Audio was extracted, but the waveform could not be created. No project was saved.',
  E_INVALID_POINT_COUNT: 'TempoLoop could not create a valid waveform for this project.',
  E_INVALID_RANGE: 'This segment has an invalid start or end time.',
  E_AUDIO_NOT_LOADED: 'Open the project again before trying to play it.',
  E_SEEK_FAILED: 'TempoLoop could not move to that point in the audio.',
  E_PLAYBACK_FAILED: 'TempoLoop could not play this project.',
  E_CANCELLED: null,
  E_AUDIO_SESSION_FAILED: 'TempoLoop could not start audio playback on this iPhone.',
  E_INSUFFICIENT_STORAGE: 'There is not enough free storage to import this video safely.',
  E_INTERNAL: 'TempoLoop encountered an unexpected audio error.',
} as const satisfies Record<NativeErrorCode, string | null>;

export type NativeErrorUserMessage = (typeof NATIVE_ERROR_USER_MESSAGES)[NativeErrorCode];

export function isNativeErrorCode(value: unknown): value is NativeErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(NATIVE_ERROR_USER_MESSAGES, value)
  );
}

export class AppError extends Error {
  readonly code: NativeErrorCode;
  readonly userMessage: NativeErrorUserMessage;
  readonly technicalMessage: string;
  readonly originalError: unknown;

  constructor(code: NativeErrorCode, technicalMessage: string, originalError?: unknown) {
    const userMessage = NATIVE_ERROR_USER_MESSAGES[code];
    super(userMessage ?? technicalMessage);

    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage;
    this.originalError = originalError;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  get isCancellation(): boolean {
    return this.code === 'E_CANCELLED';
  }

  get shouldAlert(): boolean {
    return !this.isCancellation;
  }
}

function getTechnicalMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return 'An unknown native audio error occurred.';
}

function getNativeErrorCode(error: unknown): NativeErrorCode | null {
  if (isNativeErrorCode(error)) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    isNativeErrorCode(error.code)
  ) {
    return error.code;
  }

  return null;
}

/**
 * Converts an Expo native rejection into the app's stable error shape.
 *
 * The original technical message is retained for local diagnostics. Unknown
 * codes intentionally collapse to E_INTERNAL instead of exposing native copy
 * to the user.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(getNativeErrorCode(error) ?? 'E_INTERNAL', getTechnicalMessage(error), error);
}
