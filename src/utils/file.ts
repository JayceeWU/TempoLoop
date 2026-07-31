import { File, Paths } from 'expo-file-system';

import { MAX_VIDEO_BYTES, MIN_FREE_SPACE_AFTER_PICK_BYTES } from '@/constants/app';

export type CacheFileCleanupResult = 'deleted' | 'missing' | 'not-owned';

const DEFAULT_PICKED_VIDEO_EXTENSION = 'mov';
const SAFE_PICKED_VIDEO_EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;

/**
 * Small metadata-only filesystem boundary used by the import coordinator.
 * It never exposes methods that read media bytes into JavaScript.
 */
export interface ImportFileAccess {
  getFileSize(uri: string): number;
  getAvailableDiskSpace(): number;
  deleteCacheFileIfOwned(uri: string): CacheFileCleanupResult;
}

function normalizedLocalPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) {
      return null;
    }

    const decodedPath = decodeURIComponent(url.pathname).replaceAll('\\', '/');
    const normalizedParts: string[] = [];

    for (const part of decodedPath.split('/')) {
      if (part.length === 0 || part === '.') {
        continue;
      }

      if (part === '..') {
        normalizedParts.pop();
      } else {
        normalizedParts.push(part);
      }
    }

    return `/${normalizedParts.join('/')}`;
  } catch {
    return null;
  }
}

/**
 * Checks path containment with a component boundary so `/Cache-other` cannot
 * be mistaken for a child of `/Cache`.
 */
export function isFileUriWithinDirectory(candidateUri: string, directoryUri: string): boolean {
  const candidatePath = normalizedLocalPath(candidateUri);
  const directoryPath = normalizedLocalPath(directoryUri)?.replace(/\/+$/, '');

  if (
    candidatePath === null ||
    directoryPath === undefined ||
    directoryPath === null ||
    directoryPath.length === 0
  ) {
    return false;
  }

  return candidatePath.startsWith(`${directoryPath}/`);
}

export function isPositiveByteCount(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

export function requiredFreeSpaceForImport(videoBytes: number): number {
  if (!isPositiveByteCount(videoBytes)) {
    throw new RangeError('Video size must be a positive integer byte count.');
  }

  return Math.max(MIN_FREE_SPACE_AFTER_PICK_BYTES, Math.ceil(videoBytes * 1.25));
}

export function hasEnoughFreeSpace(availableBytes: number, videoBytes: number): boolean {
  return (
    Number.isFinite(availableBytes) && availableBytes >= requiredFreeSpaceForImport(videoBytes)
  );
}

export function isWithinVideoSizeLimit(videoBytes: number): boolean {
  return isPositiveByteCount(videoBytes) && videoBytes <= MAX_VIDEO_BYTES;
}

function safeExtensionFromFileName(fileName: string | null): string | null {
  if (fileName === null) {
    return null;
  }

  const finalPathComponent = fileName.replaceAll('\\', '/').split('/').at(-1);
  const finalDotIndex = finalPathComponent?.lastIndexOf('.') ?? -1;
  if (
    finalPathComponent === undefined ||
    finalDotIndex <= 0 ||
    finalDotIndex === finalPathComponent.length - 1
  ) {
    return null;
  }

  const extension = finalPathComponent.slice(finalDotIndex + 1).toLowerCase();
  return SAFE_PICKED_VIDEO_EXTENSION_PATTERN.test(extension) ? extension : null;
}

/**
 * Keeps only a short alphanumeric extension for the app-owned picker copy.
 * The original picker name is metadata only and is never used as a path.
 */
export function safePickedVideoExtension(fileName: string | null, uri: string): string {
  const fileNameExtension = safeExtensionFromFileName(fileName);
  if (fileNameExtension !== null) {
    return fileNameExtension;
  }

  try {
    const uriFileName = decodeURIComponent(new URL(uri).pathname.split('/').at(-1) ?? '');
    return safeExtensionFromFileName(uriFileName) ?? DEFAULT_PICKED_VIDEO_EXTENSION;
  } catch {
    return DEFAULT_PICKED_VIDEO_EXTENSION;
  }
}

export function formatBinaryMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError('File size must be a finite non-negative number.');
  }

  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export class ExpoImportFileAccess implements ImportFileAccess {
  getFileSize(uri: string): number {
    return new File(uri).size;
  }

  getAvailableDiskSpace(): number {
    return Paths.availableDiskSpace;
  }

  deleteCacheFileIfOwned(uri: string): CacheFileCleanupResult {
    if (!isFileUriWithinDirectory(uri, Paths.cache.uri)) {
      return 'not-owned';
    }

    const file = new File(uri);
    if (!file.exists) {
      return 'missing';
    }

    file.delete();
    return 'deleted';
  }
}

export const importFileAccess = new ExpoImportFileAccess();
