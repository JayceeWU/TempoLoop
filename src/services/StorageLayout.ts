import { Directory, File, Paths } from 'expo-file-system';

export const STORAGE_ROOT_DIRECTORY_NAME = 'TempoLoop';
export const PROJECTS_DIRECTORY_NAME = 'Projects';
export const STAGING_DIRECTORY_NAME = 'Staging';
export const PICKED_DIRECTORY_NAME = 'Picked';
export const PROJECT_INDEX_FILE_NAME = 'projects.json';
export const PROJECT_INDEX_TEMP_FILE_NAME = 'projects.json.tmp';
export const PROJECT_INDEX_BACKUP_FILE_NAME = 'projects.json.bak';
export const PROJECT_AUDIO_FILE_NAME = 'audio.m4a';
export const PROJECT_WAVEFORM_FILE_NAME = 'waveform.json';
export const STAGING_AUDIO_FILE_NAME = 'audio.partial.m4a';
export const STAGING_WAVEFORM_FILE_NAME = 'waveform.partial.json';
export const PICKED_SOURCE_FILE_BASENAME = 'source';
export const PICKED_SOURCE_MARKER_FILE_NAME = 'picker-source.json';

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
 * File/Directory/Paths objects, while unit tests can inject an in-memory
 * implementation without mocking native modules.
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

function splitAndValidateRelativePath(relativePath: string): readonly string[] {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('://') ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('Project metadata contains an invalid relative path.');
  }

  parts.forEach((part) => assertSafePathComponent(part, 'Relative path component'));
  return parts;
}

export class StorageLayout {
  constructor(readonly fileSystem: StorageFileSystem = new ExpoStorageFileSystem()) {}

  get documentsRootUri(): string {
    return this.fileSystem.join(this.fileSystem.documentDirectoryUri, STORAGE_ROOT_DIRECTORY_NAME);
  }

  get projectsDirectoryUri(): string {
    return this.fileSystem.join(this.documentsRootUri, PROJECTS_DIRECTORY_NAME);
  }

  get projectIndexUri(): string {
    return this.fileSystem.join(this.documentsRootUri, PROJECT_INDEX_FILE_NAME);
  }

  get projectIndexTempUri(): string {
    return this.fileSystem.join(this.documentsRootUri, PROJECT_INDEX_TEMP_FILE_NAME);
  }

  get projectIndexBackupUri(): string {
    return this.fileSystem.join(this.documentsRootUri, PROJECT_INDEX_BACKUP_FILE_NAME);
  }

  get cacheRootUri(): string {
    return this.fileSystem.join(this.fileSystem.cacheDirectoryUri, STORAGE_ROOT_DIRECTORY_NAME);
  }

  get stagingDirectoryUri(): string {
    return this.fileSystem.join(this.cacheRootUri, STAGING_DIRECTORY_NAME);
  }

  get pickedDirectoryUri(): string {
    return this.fileSystem.join(this.cacheRootUri, PICKED_DIRECTORY_NAME);
  }

  ensureBaseDirectories(): void {
    this.fileSystem.ensureDirectory(this.documentsRootUri);
    this.fileSystem.ensureDirectory(this.projectsDirectoryUri);
    this.fileSystem.ensureDirectory(this.cacheRootUri);
    this.fileSystem.ensureDirectory(this.stagingDirectoryUri);
    this.fileSystem.ensureDirectory(this.pickedDirectoryUri);
  }

  projectDirectoryUri(projectId: string): string {
    assertSafePathComponent(projectId, 'Project ID');
    return this.fileSystem.join(this.projectsDirectoryUri, projectId);
  }

  projectAudioUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_AUDIO_FILE_NAME);
  }

  projectWaveformUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_WAVEFORM_FILE_NAME);
  }

  projectAudioRelativePath(projectId: string): string {
    assertSafePathComponent(projectId, 'Project ID');
    return `${PROJECTS_DIRECTORY_NAME}/${projectId}/${PROJECT_AUDIO_FILE_NAME}`;
  }

  projectWaveformRelativePath(projectId: string): string {
    assertSafePathComponent(projectId, 'Project ID');
    return `${PROJECTS_DIRECTORY_NAME}/${projectId}/${PROJECT_WAVEFORM_FILE_NAME}`;
  }

  resolveDocumentRelativePath(relativePath: string): string {
    return this.fileSystem.join(
      this.documentsRootUri,
      ...splitAndValidateRelativePath(relativePath),
    );
  }

  stagingTaskDirectoryUri(taskId: string): string {
    assertSafePathComponent(taskId, 'Import task ID');
    return this.fileSystem.join(this.stagingDirectoryUri, taskId);
  }

  stagingAudioUri(taskId: string): string {
    return this.fileSystem.join(this.stagingTaskDirectoryUri(taskId), STAGING_AUDIO_FILE_NAME);
  }

  stagingWaveformUri(taskId: string): string {
    return this.fileSystem.join(this.stagingTaskDirectoryUri(taskId), STAGING_WAVEFORM_FILE_NAME);
  }

  pickedSelectionDirectoryUri(selectionId: string): string {
    assertSafePathComponent(selectionId, 'Picked selection ID');
    return this.fileSystem.join(this.pickedDirectoryUri, selectionId);
  }

  pickedSourceUri(selectionId: string, sourceExtension: string): string {
    if (!/^[a-z0-9]{1,10}$/.test(sourceExtension)) {
      throw new Error('Picked source extension is not safe.');
    }

    return this.fileSystem.join(
      this.pickedSelectionDirectoryUri(selectionId),
      `${PICKED_SOURCE_FILE_BASENAME}.${sourceExtension}`,
    );
  }

  pickedSourceMarkerUri(selectionId: string): string {
    return this.fileSystem.join(
      this.pickedSelectionDirectoryUri(selectionId),
      PICKED_SOURCE_MARKER_FILE_NAME,
    );
  }
}

export const storageLayout = new StorageLayout();
