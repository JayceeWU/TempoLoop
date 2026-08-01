import type { StoredWaveform } from '@/domain/project';
import { WaveformLoader, WaveformLoaderError } from '@/services/WaveformLoader';
import { type StorageEntry, type StorageFileSystem, StorageLayout } from '@/services/StorageLayout';

const DURATION_MS = 120_000;
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_METADATA = {
  id: PROJECT_ID,
  waveformFileName: 'waveform.json',
  durationMs: DURATION_MS,
} as const;

class WaveformMemoryFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri = 'file:///documents';
  readonly cacheDirectoryUri = 'file:///cache';
  readonly reads: string[] = [];
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  join(...parts: readonly string[]): string {
    const [first = '', ...remaining] = parts;
    return [
      first.replace(/\/+$/, ''),
      ...remaining.map((part) => part.replace(/^\/+|\/+$/g, '')),
    ].join('/');
  }

  ensureDirectory(uri: string): void {
    this.directories.add(uri.replace(/\/+$/, ''));
  }

  directoryExists(uri: string): boolean {
    return this.directories.has(uri.replace(/\/+$/, ''));
  }

  fileExists(uri: string): boolean {
    return this.files.has(uri);
  }

  fileSize(uri: string): number {
    return this.files.get(uri)?.length ?? 0;
  }

  listDirectory(): readonly StorageEntry[] {
    return [];
  }

  async readText(uri: string): Promise<string> {
    this.reads.push(uri);
    const content = this.files.get(uri);
    if (content === undefined) {
      throw new Error(`Missing test file: ${uri}`);
    }
    return content;
  }

  writeText(uri: string, content: string): void {
    this.files.set(uri, content);
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    const content = this.files.get(sourceUri);
    if (content === undefined) throw new Error(`Missing test file: ${sourceUri}`);
    this.files.set(destinationUri, content);
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    await this.copyFile(sourceUri, destinationUri);
    this.files.delete(sourceUri);
  }

  deleteFile(uri: string): void {
    this.files.delete(uri);
  }

  deleteDirectory(uri: string): void {
    this.directories.delete(uri.replace(/\/+$/, ''));
  }

  putFile(uri: string, value: unknown): void {
    this.files.set(uri, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

function validWaveform(): StoredWaveform {
  return {
    schemaVersion: 1,
    durationMs: DURATION_MS,
    sampleCount: 2048,
    samples: Array.from({ length: 2048 }, (_, index) => (index % 2 === 0 ? 0.25 : 0.75)),
  };
}

function makeHarness() {
  const fileSystem = new WaveformMemoryFileSystem();
  const layout = new StorageLayout(fileSystem);
  const loader = new WaveformLoader(layout);
  const waveformUri = layout.projectWaveformUri(PROJECT_ID);
  return { fileSystem, loader, waveformUri };
}

describe('WaveformLoader', () => {
  test('strictly loads the active project cached waveform from its fixed filename', async () => {
    const { fileSystem, loader, waveformUri } = makeHarness();
    const waveform = validWaveform();
    fileSystem.putFile(waveformUri, waveform);

    await expect(loader.load(PROJECT_METADATA)).resolves.toEqual(waveform);
    expect(fileSystem.reads).toEqual([waveformUri]);
    expect(waveform.samples).toHaveLength(2048);
  });

  test('rejects missing, malformed, and schema-invalid waveform files', async () => {
    const missing = makeHarness();
    await expect(missing.loader.load(PROJECT_METADATA)).rejects.toMatchObject<
      Partial<WaveformLoaderError>
    >({ code: 'E_WAVEFORM_FILE_NOT_FOUND' });

    const malformed = makeHarness();
    malformed.fileSystem.putFile(malformed.waveformUri, '{broken json');
    await expect(malformed.loader.load(PROJECT_METADATA)).rejects.toMatchObject<
      Partial<WaveformLoaderError>
    >({ code: 'E_WAVEFORM_FILE_INVALID' });

    const invalid = makeHarness();
    invalid.fileSystem.putFile(invalid.waveformUri, {
      ...validWaveform(),
      extraKey: true,
    });
    await expect(invalid.loader.load(PROJECT_METADATA)).rejects.toMatchObject<
      Partial<WaveformLoaderError>
    >({ code: 'E_WAVEFORM_FILE_INVALID' });
  });

  test('rejects a waveform whose duration does not match project metadata', async () => {
    const { fileSystem, loader, waveformUri } = makeHarness();
    fileSystem.putFile(waveformUri, {
      ...validWaveform(),
      durationMs: DURATION_MS - 1,
    });

    await expect(loader.load(PROJECT_METADATA)).rejects.toMatchObject<Partial<WaveformLoaderError>>(
      { code: 'E_WAVEFORM_DURATION_MISMATCH' },
    );
  });

  test('rejects unsafe project IDs and non-contract filenames before reading', async () => {
    const { fileSystem, loader } = makeHarness();

    await expect(
      loader.load({
        id: '../outside',
        waveformFileName: 'waveform.json',
        durationMs: DURATION_MS,
      }),
    ).rejects.toMatchObject<Partial<WaveformLoaderError>>({ code: 'E_WAVEFORM_FILE_INVALID' });

    await expect(
      loader.load({
        id: PROJECT_ID,
        waveformFileName: 'audio.m4a' as 'waveform.json',
        durationMs: DURATION_MS,
      }),
    ).rejects.toMatchObject<Partial<WaveformLoaderError>>({ code: 'E_WAVEFORM_FILE_INVALID' });
    expect(fileSystem.reads).toEqual([]);
  });
});
