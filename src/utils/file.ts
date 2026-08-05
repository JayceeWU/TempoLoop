import { Paths } from 'expo-file-system';

/** Small metadata-only boundary used by diagnostics. */
export interface ImportFileAccess {
  getAvailableDiskSpace(): number;
}

export function formatBinaryMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError('File size must be a finite non-negative number.');
  }

  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export class ExpoImportFileAccess implements ImportFileAccess {
  getAvailableDiskSpace(): number {
    return Paths.availableDiskSpace;
  }
}

export const importFileAccess = new ExpoImportFileAccess();
