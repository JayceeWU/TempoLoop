export type LocalFileUri = string & {
  readonly __localFileUri: unique symbol;
};

export function isLocalFileUri(value: string): value is LocalFileUri {
  try {
    const url = new URL(value);
    const hostIsLocal = url.hostname === '' || url.hostname === 'localhost';

    return (
      url.protocol === 'file:' &&
      hostIsLocal &&
      url.pathname.startsWith('/') &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function parseLocalFileUri(value: string): LocalFileUri {
  if (!isLocalFileUri(value)) {
    throw new Error('E_INVALID_URI');
  }

  return value;
}

export function getFileNameFromUri(value: LocalFileUri): string | null {
  const url = new URL(value);
  const encodedName = url.pathname.split('/').filter(Boolean).at(-1);

  if (encodedName === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}
