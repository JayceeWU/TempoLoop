import type { DanceProject, WaveformFile } from '@/domain/project';
import { WaveformFileSchema } from '@/domain/validation';
import {
  PROJECTS_DIRECTORY_NAME,
  PROJECT_WAVEFORM_FILE_NAME,
  type StorageLayout,
  storageLayout,
} from '@/services/StorageLayout';

export type WaveformLoaderErrorCode =
  'E_WAVEFORM_FILE_NOT_FOUND' | 'E_WAVEFORM_FILE_INVALID' | 'E_WAVEFORM_DURATION_MISMATCH';

export class WaveformLoaderError extends Error {
  constructor(
    readonly code: WaveformLoaderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WaveformLoaderError';
  }
}

export type WaveformProjectMetadata = Pick<DanceProject, 'waveformRelativePath' | 'durationMs'>;

function hasCachedWaveformPathShape(relativePath: string): boolean {
  const parts = relativePath.replaceAll('\\', '/').split('/');
  return (
    parts.length === 3 &&
    parts[0] === PROJECTS_DIRECTORY_NAME &&
    parts[1] !== undefined &&
    parts[1].length > 0 &&
    parts[2] === PROJECT_WAVEFORM_FILE_NAME
  );
}

/**
 * Reads only TempoLoop's small cached waveform JSON. Audio and video media are
 * never opened or transferred through JavaScript.
 */
export class WaveformLoader {
  constructor(private readonly layout: StorageLayout = storageLayout) {}

  async load(project: WaveformProjectMetadata): Promise<WaveformFile> {
    let waveformUri: string;

    if (!hasCachedWaveformPathShape(project.waveformRelativePath)) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_INVALID',
        'The project waveform path is not a cached waveform JSON path.',
      );
    }

    try {
      waveformUri = this.layout.resolveDocumentRelativePath(project.waveformRelativePath);
    } catch (error) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_INVALID',
        'The project waveform path is invalid.',
        { cause: error },
      );
    }

    if (!this.layout.fileSystem.fileExists(waveformUri)) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_NOT_FOUND',
        'The cached project waveform is missing.',
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await this.layout.fileSystem.readText(waveformUri));
    } catch (error) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_INVALID',
        'The cached project waveform is not valid JSON.',
        { cause: error },
      );
    }

    const parsedWaveform = WaveformFileSchema.safeParse(parsedJson);
    if (!parsedWaveform.success) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_INVALID',
        'The cached project waveform does not match the waveform schema.',
        { cause: parsedWaveform.error },
      );
    }

    if (parsedWaveform.data.durationMs !== project.durationMs) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_DURATION_MISMATCH',
        'The cached waveform duration does not match the project audio duration.',
      );
    }

    return parsedWaveform.data;
  }
}

export const waveformLoader = new WaveformLoader();
