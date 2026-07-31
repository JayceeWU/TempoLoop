export interface DiagnosticPathPrefix {
  readonly prefix: string;
  readonly replacement: string;
}

export type DiagnosticLogValue =
  | string
  | number
  | boolean
  | null
  | readonly DiagnosticLogValue[]
  | { readonly [key: string]: DiagnosticLogValue };

const MAX_DIAGNOSTIC_STRING_LENGTH = 500;
const MAX_DIAGNOSTIC_COLLECTION_LENGTH = 20;
const MAX_DIAGNOSTIC_DEPTH = 4;
const MAX_DIAGNOSTIC_NODE_COUNT = 100;
const FILE_URI_PATTERN = /file:\/\/\/[^\s"'<>)}\]]+/giu;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Z]:\\[^\s"'<>)}\]]+/giu;
const POSIX_ABSOLUTE_PATH_PATTERN = /(^|\s)\/(?:[^/\s"'<>)}\]]+\/)+[^\s"'<>)}\]]*/gu;

function truncate(value: string): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= MAX_DIAGNOSTIC_STRING_LENGTH) {
    return value;
  }

  return `${codePoints.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH).join('')}\u2026`;
}

/**
 * Redacts app-container and absolute filesystem locations before diagnostic
 * text reaches either the UI or the in-memory development log.
 */
export function redactDiagnosticText(
  value: string,
  pathPrefixes: readonly DiagnosticPathPrefix[] = [],
): string {
  let redacted = value;

  const orderedPrefixes = [...pathPrefixes]
    .filter(({ prefix }) => prefix.length > 0)
    .sort((left, right) => right.prefix.length - left.prefix.length);

  for (const { prefix, replacement } of orderedPrefixes) {
    redacted = redacted.split(prefix).join(replacement);
  }

  redacted = redacted
    .replace(FILE_URI_PATTERN, '<local-file>')
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, '<absolute-path>')
    .replace(
      POSIX_ABSOLUTE_PATH_PATTERN,
      (_match, leadingWhitespace: string) => `${leadingWhitespace}<absolute-path>`,
    );

  return truncate(redacted);
}

function errorAsObject(error: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if ('code' in error) {
    result.code = error.code;
  }

  return result;
}

export function sanitizeDiagnosticValue(
  value: unknown,
  pathPrefixes: readonly DiagnosticPathPrefix[] = [],
): DiagnosticLogValue {
  const visited = new WeakSet<object>();
  let remainingNodes = MAX_DIAGNOSTIC_NODE_COUNT;

  function sanitize(candidate: unknown, depth: number): DiagnosticLogValue {
    if (remainingNodes <= 0) {
      return '[truncated]';
    }
    remainingNodes -= 1;

    if (candidate === null) {
      return null;
    }

    if (typeof candidate === 'string') {
      return redactDiagnosticText(candidate, pathPrefixes);
    }

    if (typeof candidate === 'number') {
      return Number.isFinite(candidate) ? candidate : '[non-finite]';
    }

    if (typeof candidate === 'boolean') {
      return candidate;
    }

    if (typeof candidate === 'bigint') {
      return truncate(candidate.toString());
    }

    if (
      candidate === undefined ||
      typeof candidate === 'function' ||
      typeof candidate === 'symbol'
    ) {
      return '[unsupported]';
    }

    if (depth >= MAX_DIAGNOSTIC_DEPTH) {
      return '[truncated]';
    }

    const objectCandidate = candidate instanceof Error ? errorAsObject(candidate) : candidate;
    if (visited.has(objectCandidate)) {
      return '[circular]';
    }
    visited.add(objectCandidate);

    if (Array.isArray(objectCandidate)) {
      return objectCandidate
        .slice(0, MAX_DIAGNOSTIC_COLLECTION_LENGTH)
        .map((item) => sanitize(item, depth + 1));
    }

    const entries = Object.entries(objectCandidate).slice(0, MAX_DIAGNOSTIC_COLLECTION_LENGTH);
    return Object.fromEntries(
      entries.map(([key, item]) => [truncate(key), sanitize(item, depth + 1)]),
    );
  }

  return sanitize(value, 0);
}
