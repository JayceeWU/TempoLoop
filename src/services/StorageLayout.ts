import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';

export const STORAGE_ROOT_DIRECTORY_NAME = 'TempoLoop';
export const PROJECTS_DIRECTORY_NAME = 'projects';
export const IMPORTS_DIRECTORY_NAME = 'imports';
export const PROJECT_METADATA_FILE_NAME = 'project.json';
export const PROJECT_METADATA_TEMP_FILE_NAME = 'project.json.tmp';
export const PROJECT_METADATA_BACKUP_FILE_NAME = 'project.json.bak';
export const PROJECT_AUDIO_FILE_NAME = 'audio.m4a';
export const PROJECT_PARTIAL_AUDIO_FILE_NAME = 'audio.m4a.partial';
export const PROJECT_WAVEFORM_FILE_NAME = 'waveform.json';
export const PROJECT_WAVEFORM_TEMP_FILE_NAME = 'waveform.json.tmp';
export const PROJECT_WAVEFORM_BACKUP_FILE_NAME = 'waveform.json.bak';
export const IMPORT_METADATA_FILE_NAME = 'import.json';
export const IMPORT_METADATA_TEMP_FILE_NAME = 'import.json.tmp';
export const IMPORT_DIRECTORY_PREFIX = '.import-';

export const ImportTransactionJournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  expectedAudioSizeBytes: z.number().finite().int().positive(),
  durationMs: z.number().finite().int().positive(),
});

export type ImportTransactionJournal = z.infer<typeof ImportTransactionJournalSchema>;

export type StorageEntryKind = 'file' | 'directory';

export interface StorageEntry {
  readonly uri: string;
  readonly name: string;
  readonly kind: StorageEntryKind;
  readonly size: number | null;
  readonly lastModifiedMs: number | null;
}

/**
 * A deliberately small filesystem boundary. Production uses the modern Expo
 * File/Directory/Paths API; tests inject a memory implementation.
 */
export interface StorageFileSystem {
  readonly documentDirectoryUri: string;
  readonly cacheDirectoryUri: string;

  join(...parts: readonly string[]): string;
  ensureDirectory(uri: string): void;
  directoryExists(uri: string): boolean;
  fileExists(uri: string): boolean;
  fileSize(uri: string): number;
  listDirectory(uri: string): readonly StorageEntry[];
  readText(uri: string): Promise<string>;
  writeText(uri: string, content: string): void;
  copyFile(sourceUri: string, destinationUri: string): Promise<void>;
  moveFile(sourceUri: string, destinationUri: string): Promise<void>;
  /** Directory rename is required by the production import transaction. */
  moveDirectory?(sourceUri: string, destinationUri: string): Promise<void>;
  deleteFile(uri: string): void;
  deleteDirectory(uri: string): void;
}

export class ExpoStorageFileSystem implements StorageFileSystem {
  get documentDirectoryUri(): string {
    return Paths.document.uri;
  }

  get cacheDirectoryUri(): string {
    return Paths.cache.uri;
  }

  join(...parts: readonly string[]): string {
    return Paths.join(...parts);
  }

  ensureDirectory(uri: string): void {
    new Directory(uri).create({ idempotent: true, intermediates: true });
  }

  directoryExists(uri: string): boolean {
    const info = Paths.info(uri);
    return info.exists && info.isDirectory === true;
  }

  fileExists(uri: string): boolean {
    const info = Paths.info(uri);
    return info.exists && info.isDirectory === false;
  }

  fileSize(uri: string): number {
    return new File(uri).size;
  }

  listDirectory(uri: string): readonly StorageEntry[] {
    const directory = new Directory(uri);
    if (!directory.exists) {
      return [];
    }

    return directory.list().map((entry): StorageEntry => {
      if (entry instanceof Directory) {
        const info = entry.info();
        return {
          uri: entry.uri,
          name: entry.name,
          kind: 'directory',
          size: info.size ?? null,
          lastModifiedMs: info.modificationTime ?? null,
        };
      }

      return {
        uri: entry.uri,
        name: entry.name,
        kind: 'file',
        size: entry.size,
        lastModifiedMs: entry.lastModified,
      };
    });
  }

  readText(uri: string): Promise<string> {
    return new File(uri).text();
  }

  writeText(uri: string, content: string): void {
    const file = new File(uri);
    file.create({ intermediates: true, overwrite: true });
    file.write(content);
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    await new File(sourceUri).copy(new File(destinationUri), { overwrite: true });
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    await new File(sourceUri).move(new File(destinationUri), { overwrite: true });
  }

  async moveDirectory(sourceUri: string, destinationUri: string): Promise<void> {
    await new Directory(sourceUri).move(new Directory(destinationUri));
  }

  deleteFile(uri: string): void {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  }

  deleteDirectory(uri: string): void {
    const directory = new Directory(uri);
    if (directory.exists) {
      directory.delete();
    }
  }
}

function assertSafePathComponent(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} contains characters that are not safe in a local path.`);
  }
}

export class StorageLayout {
  constructor(readonly fileSystem: StorageFileSystem = new ExpoStorageFileSystem()) {}

  get documentsRootUri(): string {
    return this.fileSystem.join(this.fileSystem.documentDirectoryUri, STORAGE_ROOT_DIRECTORY_NAME);
  }

  get projectsDirectoryUri(): string {
    return this.fileSystem.join(this.documentsRootUri, PROJECTS_DIRECTORY_NAME);
  }

  get importsDirectoryUri(): string {
    return this.fileSystem.join(this.documentsRootUri, IMPORTS_DIRECTORY_NAME);
  }

  ensureBaseDirectories(): void {
    this.fileSystem.ensureDirectory(this.documentsRootUri);
    this.fileSystem.ensureDirectory(this.projectsDirectoryUri);
    this.fileSystem.ensureDirectory(this.importsDirectoryUri);
  }

  projectDirectoryUri(projectId: string): string {
    assertSafePathComponent(projectId, 'Project ID');
    return this.fileSystem.join(this.projectsDirectoryUri, projectId);
  }

  projectMetadataUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_METADATA_FILE_NAME);
  }

  projectMetadataTempUri(projectId: string): string {
    return this.fileSystem.join(
      this.projectDirectoryUri(projectId),
      PROJECT_METADATA_TEMP_FILE_NAME,
    );
  }

  projectMetadataBackupUri(projectId: string): string {
    return this.fileSystem.join(
      this.projectDirectoryUri(projectId),
      PROJECT_METADATA_BACKUP_FILE_NAME,
    );
  }

  projectAudioUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_AUDIO_FILE_NAME);
  }

  projectWaveformUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_WAVEFORM_FILE_NAME);
  }

  projectWaveformTempUri(projectId: string): string {
    return this.fileSystem.join(
      this.projectDirectoryUri(projectId),
      PROJECT_WAVEFORM_TEMP_FILE_NAME,
    );
  }

  projectWaveformBackupUri(projectId: string): string {
    return this.fileSystem.join(
      this.projectDirectoryUri(projectId),
      PROJECT_WAVEFORM_BACKUP_FILE_NAME,
    );
  }

  importDirectoryUri(projectId: string): string {
    assertSafePathComponent(projectId, 'Import project ID');
    return this.fileSystem.join(this.importsDirectoryUri, `${IMPORT_DIRECTORY_PREFIX}${projectId}`);
  }

  importPartialAudioUri(projectId: string): string {
    return this.fileSystem.join(
      this.importDirectoryUri(projectId),
      PROJECT_PARTIAL_AUDIO_FILE_NAME,
    );
  }

  importAudioUri(projectId: string): string {
    return this.fileSystem.join(this.importDirectoryUri(projectId), PROJECT_AUDIO_FILE_NAME);
  }

  importWaveformUri(projectId: string): string {
    return this.fileSystem.join(this.importDirectoryUri(projectId), PROJECT_WAVEFORM_FILE_NAME);
  }

  importWaveformTempUri(projectId: string): string {
    return this.fileSystem.join(
      this.importDirectoryUri(projectId),
      PROJECT_WAVEFORM_TEMP_FILE_NAME,
    );
  }

  importProjectMetadataUri(projectId: string): string {
    return this.fileSystem.join(this.importDirectoryUri(projectId), PROJECT_METADATA_FILE_NAME);
  }

  importProjectMetadataTempUri(projectId: string): string {
    return this.fileSystem.join(
      this.importDirectoryUri(projectId),
      PROJECT_METADATA_TEMP_FILE_NAME,
    );
  }

  importMetadataUri(projectId: string): string {
    return this.fileSystem.join(this.importDirectoryUri(projectId), IMPORT_METADATA_FILE_NAME);
  }

  importMetadataTempUri(projectId: string): string {
    return this.fileSystem.join(this.importDirectoryUri(projectId), IMPORT_METADATA_TEMP_FILE_NAME);
  }

  isUriInsideImports(uri: string): boolean {
    const prefix = `${this.importsDirectoryUri.replace(/\/+$/, '')}/`;
    if (!uri.startsWith(prefix) || uri.includes('\\')) {
      return false;
    }

    try {
      if (decodeURIComponent(uri) !== uri) {
        return false;
      }
    } catch {
      return false;
    }

    const [importDirectoryName, ...descendants] = uri.slice(prefix.length).split('/');
    return (
      importDirectoryName !== undefined &&
      /^\.import-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(importDirectoryName) &&
      descendants.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
    );
  }

  isImportDirectoryUri(uri: string): boolean {
    const prefix = `${this.importsDirectoryUri.replace(/\/+$/, '')}/`;
    return this.isUriInsideImports(uri) && !uri.slice(prefix.length).includes('/');
  }
}

export const storageLayout = new StorageLayout();
