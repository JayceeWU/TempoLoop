import type { DanceProject, StoredWaveform } from '@/domain/project';
import { StoredWaveformSchema } from '@/domain/validation';
import {
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

export type WaveformProjectMetadata = Pick<DanceProject, 'id' | 'waveformFileName' | 'durationMs'>;

/**
 * Reads only TempoLoop's small cached waveform JSON for the active project.
 * Audio and source-media bytes never cross this JavaScript boundary.
 */
export class WaveformLoader {
  constructor(private readonly layout: StorageLayout = storageLayout) {}

  async load(project: WaveformProjectMetadata): Promise<StoredWaveform> {
    if (project.waveformFileName !== PROJECT_WAVEFORM_FILE_NAME) {
      throw new WaveformLoaderError(
        'E_WAVEFORM_FILE_INVALID',
        'The project waveform filename is invalid.',
      );
    }

    let waveformUri: string;
    try {
      waveformUri = this.layout.projectWaveformUri(project.id);
    } catch (error) {
      throw new WaveformLoaderError('E_WAVEFORM_FILE_INVALID', 'The project ID is invalid.', {
        cause: error,
      });
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

    const parsedWaveform = StoredWaveformSchema.safeParse(parsedJson);
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
