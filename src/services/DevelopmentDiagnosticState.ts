import { developmentLog, type DevelopmentLog } from '@/services/DevelopmentLog';

export interface RecordedDiagnosticErrors {
  readonly lastMediaErrorCode: string | null;
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

function stableOperation(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value) ? value : 'unknown';
}

function isSilentCode(code: string): boolean {
  return code === 'E_IMPORT_CANCELLED';
}

export class DevelopmentDiagnosticState {
  private readonly enabled: boolean;
  private readonly log: DevelopmentLog;
  private errors: RecordedDiagnosticErrors = {
    lastMediaErrorCode: null,
    lastImportErrorCode: null,
  };

  constructor(options: DevelopmentDiagnosticStateOptions = {}) {
    this.enabled = options.enabled ?? __DEV__;
    this.log = options.log ?? developmentLog;
  }

  recordMediaError(error: unknown, operation: string): void {
    if (!this.enabled) {
      return;
    }

    const code = stableErrorCode(error);
    if (isSilentCode(code)) {
      return;
    }

    this.errors = { ...this.errors, lastMediaErrorCode: code };
    this.log.record('error', 'media.operation.failed', {
      operation: stableOperation(operation),
      code,
    });
  }

  recordImportError(error: unknown, operation: string): void {
    if (!this.enabled) {
      return;
    }

    const code = stableErrorCode(error);
    if (isSilentCode(code)) {
      return;
    }

    this.errors = { ...this.errors, lastImportErrorCode: code };
    this.log.record('error', 'import.operation.failed', {
      operation: stableOperation(operation),
      code,
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
      lastMediaErrorCode: null,
      lastImportErrorCode: null,
    };
  }
}

export const developmentDiagnosticState = new DevelopmentDiagnosticState();
