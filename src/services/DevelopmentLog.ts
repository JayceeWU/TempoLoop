import {
  type DiagnosticLogValue,
  type DiagnosticPathPrefix,
  sanitizeDiagnosticValue,
} from '@/utils/diagnostics';

export const DEVELOPMENT_LOG_CAPACITY = 100;
export const DEVELOPMENT_LOG_MAX_CAPACITY = 500;

export type DevelopmentLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DevelopmentLogEntry {
  readonly sequence: number;
  readonly timestampIso: string;
  readonly level: DevelopmentLogLevel;
  readonly event: string;
  readonly context: DiagnosticLogValue;
}

export interface DevelopmentLogOptions {
  readonly capacity?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  readonly pathPrefixes?: readonly DiagnosticPathPrefix[];
}

export type DevelopmentLogListener = () => void;

export class DevelopmentLog {
  private readonly capacity: number;
  private readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly pathPrefixes: readonly DiagnosticPathPrefix[];
  private readonly listeners = new Set<DevelopmentLogListener>();
  private entries: DevelopmentLogEntry[] = [];
  private nextSequence = 1;

  constructor(options: DevelopmentLogOptions = {}) {
    const capacity = options.capacity ?? DEVELOPMENT_LOG_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > DEVELOPMENT_LOG_MAX_CAPACITY) {
      throw new RangeError(
        `Development log capacity must be an integer from 1 through ${DEVELOPMENT_LOG_MAX_CAPACITY}.`,
      );
    }

    this.capacity = capacity;
    this.enabled = options.enabled ?? __DEV__;
    this.now = options.now ?? (() => new Date());
    this.pathPrefixes = options.pathPrefixes ?? [];
  }

  record(level: DevelopmentLogLevel, event: string, context: unknown = {}): void {
    if (!this.enabled) {
      return;
    }

    const entry: DevelopmentLogEntry = Object.freeze({
      sequence: this.nextSequence,
      timestampIso: this.now().toISOString(),
      level,
      event: String(sanitizeDiagnosticValue(event, this.pathPrefixes)),
      context: sanitizeDiagnosticValue(context, this.pathPrefixes),
    });
    this.nextSequence += 1;

    this.entries = [...this.entries, entry].slice(-this.capacity);
    this.emitChange();
  }

  getEntries(): readonly DevelopmentLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    if (!this.enabled || this.entries.length === 0) {
      return;
    }

    this.entries = [];
    this.emitChange();
  }

  subscribe(listener: DevelopmentLogListener): () => void {
    if (!this.enabled) {
      return () => undefined;
    }

    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const developmentLog = new DevelopmentLog();
