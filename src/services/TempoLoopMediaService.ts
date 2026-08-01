import TempoLoopMedia, {
  assertImportMediaResult,
  assertImportProgressEvent,
  assertMediaInspection,
  assertPickedMediaSource,
  isTempoLoopMediaErrorCode,
  type ImportMediaOptions,
  type ImportMediaResult,
  type ImportProgressEvent,
  type InspectMediaOptions,
  type TempoLoopMediaApi,
  type TempoLoopMediaClient,
  type TempoLoopMediaErrorCode,
  type TempoLoopMediaSubscription,
  type MediaInspection,
  type PickedMediaSource,
} from '../../modules/tempoloop-media';

import { COPY } from '@/constants/copy';

const MEDIA_ERROR_USER_MESSAGES: Record<TempoLoopMediaErrorCode, string | null> = COPY.mediaErrors;

export class TempoLoopMediaServiceError extends Error {
  readonly code: TempoLoopMediaErrorCode;
  readonly userMessage: string | null;
  readonly technicalMessage: string;
  readonly originalError: unknown;

  constructor(code: TempoLoopMediaErrorCode, technicalMessage: string, originalError?: unknown) {
    const userMessage = MEDIA_ERROR_USER_MESSAGES[code];

    // Error.message is safe to surface accidentally. Native messages and stack
    // traces remain available only through the explicitly technical property.
    super(
      userMessage ?? (code === 'E_IMPORT_CANCELLED' ? 'Import cancelled.' : 'No alert needed.'),
    );
    this.name = 'TempoLoopMediaServiceError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage;
    this.originalError = originalError;

    Object.setPrototypeOf(this, TempoLoopMediaServiceError.prototype);
  }

  get isCancellation(): boolean {
    return this.code === 'E_IMPORT_CANCELLED';
  }

  get shouldAlert(): boolean {
    return this.userMessage !== null;
  }
}

function technicalMessage(error: unknown): string {
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

  return 'An unknown TempoLoopMedia error occurred.';
}

function nativeErrorCode(error: unknown): TempoLoopMediaErrorCode | null {
  if (isTempoLoopMediaErrorCode(error)) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    isTempoLoopMediaErrorCode(error.code)
  ) {
    return error.code;
  }

  return null;
}

export function toTempoLoopMediaServiceError(error: unknown): TempoLoopMediaServiceError {
  if (error instanceof TempoLoopMediaServiceError) {
    return error;
  }

  return new TempoLoopMediaServiceError(
    nativeErrorCode(error) ?? 'E_UNKNOWN_NATIVE',
    technicalMessage(error),
    error,
  );
}

/**
 * Application-facing boundary for the Android-only native import module.
 * Tests inject a typed client; production always resolves TempoLoopMedia and
 * never substitutes another native module or a JavaScript media implementation.
 */
export class TempoLoopMediaService implements TempoLoopMediaApi {
  constructor(private readonly client: TempoLoopMediaClient = TempoLoopMedia) {}

  pickGalleryVideo(): Promise<PickedMediaSource | null> {
    return this.invoke(async () => {
      const result: unknown = await this.client.pickGalleryVideo();
      if (result === null) {
        return null;
      }
      assertPickedMediaSource(result);
      return result;
    });
  }

  inspectMedia(options: InspectMediaOptions): Promise<MediaInspection> {
    return this.invoke(async () => {
      const result: unknown = await this.client.inspectMedia(options);
      assertMediaInspection(result);
      return result;
    });
  }

  importProjectMedia(options: ImportMediaOptions): Promise<ImportMediaResult> {
    return this.invoke(async () => {
      const result: unknown = await this.client.importProjectMedia(options);
      assertImportMediaResult(result, options.waveformBinCount);
      return result;
    });
  }

  cancelImport(operationId: string): Promise<void> {
    return this.invoke(() => this.client.cancelImport(operationId));
  }

  addImportProgressListener(
    listener: (event: ImportProgressEvent) => void,
  ): TempoLoopMediaSubscription {
    let subscription: TempoLoopMediaSubscription;

    try {
      subscription = this.client.addImportProgressListener((event) => {
        try {
          assertImportProgressEvent(event);
        } catch {
          // Malformed native events are never forwarded to application state.
          // The event is intentionally not logged because it may contain source
          // metadata that is outside the development-log privacy contract.
          return;
        }

        listener(event);
      });
    } catch (error) {
      throw toTempoLoopMediaServiceError(error);
    }

    let removed = false;

    return {
      remove: () => {
        if (removed) {
          return;
        }

        removed = true;
        try {
          subscription.remove();
        } catch (error) {
          throw toTempoLoopMediaServiceError(error);
        }
      },
    };
  }

  private async invoke<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      throw toTempoLoopMediaServiceError(error);
    }
  }
}

export const tempoLoopMediaService = new TempoLoopMediaService();
