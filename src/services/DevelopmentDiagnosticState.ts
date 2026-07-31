import { developmentLog, type DevelopmentLog } from '@/services/DevelopmentLog';

export interface RecordedDiagnosticErrors {
  readonly lastNativeErrorCode: string | null;
  readonly lastImportErrorCode: string | null;
}

export interface DevelopmentDiagnosticStateOptions {
  readonly enabled?: boolean;
  readonly log?: DevelopmentLog;
}

function stableErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^E_[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }

  return 'E_UNKNOWN';
}

function technicalMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return 'Unknown error';
}

export class DevelopmentDiagnosticState {
  private readonly enabled: boolean;
  private readonly log: DevelopmentLog;
  private errors: RecordedDiagnosticErrors = {
    lastNativeErrorCode: null,
    lastImportErrorCode: null,
  };

  constructor(options: DevelopmentDiagnosticStateOptions = {}) {
    this.enabled = options.enabled ?? __DEV__;
    this.log = options.log ?? developmentLog;
  }

  recordNativeError(error: unknown, operation: string): void {
    if (!this.enabled) {
      return;
    }

    const code = stableErrorCode(error);
    if (code === 'E_CANCELLED') {
      return;
    }

    this.errors = { ...this.errors, lastNativeErrorCode: code };
    this.log.record('error', 'native.operation.failed', {
      operation,
      code,
      message: technicalMessage(error),
    });
  }

  recordImportError(error: unknown, operation: string): void {
    if (!this.enabled) {
      return;
    }

    const code = stableErrorCode(error);
    if (code === 'E_CANCELLED') {
      return;
    }

    this.errors = { ...this.errors, lastImportErrorCode: code };
    this.log.record('error', 'import.operation.failed', {
      operation,
      code,
      message: technicalMessage(error),
    });
  }

  getSnapshot(): RecordedDiagnosticErrors {
    return { ...this.errors };
  }

  clear(): void {
    if (!this.enabled) {
      return;
    }

    this.errors = {
      lastNativeErrorCode: null,
      lastImportErrorCode: null,
    };
  }
}

export const developmentDiagnosticState = new DevelopmentDiagnosticState();
