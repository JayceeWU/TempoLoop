import type { DanceProject, ProjectIndexFile, WaveformFile } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';
import { ProjectRepository, ProjectRepositoryError } from '@/repositories/ProjectRepository';
import { RecoveryService } from '@/services/RecoveryService';
import { type StorageEntry, type StorageFileSystem, StorageLayout } from '@/services/StorageLayout';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORPHAN_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const NOW_MS = Date.parse('2026-07-30T12:00:00.000Z');

interface MemoryFile {
  content: string;
  size: number;
  lastModifiedMs: number;
}

class MemoryStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri = 'file:///documents';
  readonly cacheDirectoryUri = 'file:///cache';
  private readonly directories = new Map<string, number>();
  private readonly files = new Map<string, MemoryFile>();
  private readonly lockedDirectories = new Set<string>();
  private readonly lockedFiles = new Set<string>();

  constructor() {
    this.ensureDirectory(this.documentDirectoryUri);
    this.ensureDirectory(this.cacheDirectoryUri);
  }

  join(...parts: readonly string[]): string {
    const [first = '', ...remaining] = parts;
    return [
      first.replace(/\/+$/, ''),
      ...remaining.map((part) => part.replace(/^\/+|\/+$/g, '')),
    ].join('/');
  }

  ensureDirectory(uri: string): void {
    this.directories.set(uri.replace(/\/+$/, ''), NOW_MS);
  }

  directoryExists(uri: string): boolean {
    return this.directories.has(uri.replace(/\/+$/, ''));
  }

  fileExists(uri: string): boolean {
    return this.files.has(uri);
  }

  fileSize(uri: string): number {
    return this.files.get(uri)?.size ?? 0;
  }

  listDirectory(uri: string): readonly StorageEntry[] {
    const prefix = `${uri.replace(/\/+$/, '')}/`;
    const entries: StorageEntry[] = [];

    for (const [candidate, lastModifiedMs] of this.directories) {
      const name = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
      if (name.length > 0 && !name.includes('/')) {
        entries.push({
          uri: candidate,
          name,
          kind: 'directory',
          size: null,
          lastModifiedMs,
        });
      }
    }

    for (const [candidate, file] of this.files) {
      const name = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
      if (name.length > 0 && !name.includes('/')) {
        entries.push({
          uri: candidate,
          name,
          kind: 'file',
          size: file.size,
          lastModifiedMs: file.lastModifiedMs,
        });
      }
    }

    return entries;
  }

  async readText(uri: string): Promise<string> {
    const file = this.files.get(uri);
    if (file === undefined) {
      throw new Error(`Missing memory file: ${uri}`);
    }
    return file.content;
  }

  writeText(uri: string, content: string): void {
    this.files.set(uri, {
      content,
      size: content.length,
      lastModifiedMs: NOW_MS,
    });
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    const source = this.files.get(sourceUri);
    if (source === undefined) {
      throw new Error(`Missing memory file: ${sourceUri}`);
    }
    this.files.set(destinationUri, { ...source });
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    await this.copyFile(sourceUri, destinationUri);
    this.files.delete(sourceUri);
  }

  deleteFile(uri: string): void {
    if (this.lockedFiles.has(uri)) {
      throw new Error(`Locked memory file: ${uri}`);
    }
    this.files.delete(uri);
  }

  deleteDirectory(uri: string): void {
    const normalized = uri.replace(/\/+$/, '');
    if (this.lockedDirectories.has(normalized)) {
      throw new Error(`Locked memory directory: ${normalized}`);
    }
    const prefix = `${normalized}/`;
    this.directories.delete(normalized);
    for (const candidate of [...this.directories.keys()]) {
      if (candidate.startsWith(prefix)) {
        this.directories.delete(candidate);
      }
    }
    for (const candidate of [...this.files.keys()]) {
      if (candidate.startsWith(prefix)) {
        this.files.delete(candidate);
      }
    }
  }

  putFile(uri: string, content: string, size = content.length): void {
    const parentUri = uri.slice(0, uri.lastIndexOf('/'));
    this.ensureDirectory(parentUri);
    this.files.set(uri, { content, size, lastModifiedMs: NOW_MS });
  }

  setDirectoryModified(uri: string, lastModifiedMs: number): void {
    this.directories.set(uri.replace(/\/+$/, ''), lastModifiedMs);
  }

  lockDirectory(uri: string): void {
    this.lockedDirectories.add(uri.replace(/\/+$/, ''));
  }

  lockFile(uri: string): void {
    this.lockedFiles.add(uri);
  }
}

function makeProject(id = PROJECT_ID, name = 'Practice'): DanceProject {
  return {
    schemaVersion: 1,
    id,
    name,
    createdAtIso: '2026-07-30T10:00:00.000Z',
    updatedAtIso: '2026-07-30T10:00:00.000Z',
    durationMs: 120_000,
    sourceVideoBytes: 1_000,
    audioRelativePath: `Projects/${id}/audio.m4a`,
    waveformRelativePath: `Projects/${id}/waveform.json`,
    preferredRate: 1,
    lastSelectedSegment: null,
    segments: createEmptySegments(),
  };
}

function waveformFile(): WaveformFile {
  return {
    schemaVersion: 1,
    pointCount: 2048,
    durationMs: 120_000,
    amplitudes: Array.from({ length: 2048 }, () => 0),
  };
}

function makeRepository(fileSystem: MemoryStorageFileSystem) {
  const layout = new StorageLayout(fileSystem);
  const recoveryService = new RecoveryService(layout, { now: () => NOW_MS });
  const repository = new ProjectRepository({
    layout,
    recoveryService,
    now: () => '2026-07-30T12:00:00.000Z',
  });
  return { layout, repository };
}

function seedIndexedAudio(
  fileSystem: MemoryStorageFileSystem,
  layout: StorageLayout,
  project: DanceProject,
): void {
  fileSystem.putFile(layout.resolveDocumentRelativePath(project.audioRelativePath), '', 32);
}

describe('ProjectRepository recovery', () => {
  test('retries only marker-authorized picker cleanup inside Cache', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const layout = new StorageLayout(fileSystem);
    const recovery = new RecoveryService(layout, { now: () => NOW_MS });
    layout.ensureBaseDirectories();

    const validPickerUri = 'file:///cache/ImagePicker/locked.mov';
    const outsideCacheUri = 'file:///documents/must-not-delete.mov';
    const appOwnedCacheUri = layout.stagingAudioUri('active-task');
    const invalidMarkerTargetUri = 'file:///cache/ImagePicker/invalid.mov';
    const extraKeyMarkerTargetUri = 'file:///cache/ImagePicker/extra-key.mov';
    fileSystem.putFile(validPickerUri, '', 512);
    fileSystem.putFile(outsideCacheUri, '', 512);
    fileSystem.putFile(appOwnedCacheUri, '', 512);
    fileSystem.putFile(invalidMarkerTargetUri, '', 512);
    fileSystem.putFile(extraKeyMarkerTargetUri, '', 512);

    for (const [selectionId, pickerSourceUri] of [
      ['valid-marker', validPickerUri],
      ['outside-marker', outsideCacheUri],
      ['app-owned-marker', appOwnedCacheUri],
    ] as const) {
      fileSystem.putFile(
        layout.pickedSourceMarkerUri(selectionId),
        JSON.stringify({
          schemaVersion: 1,
          pickerSourceUri,
        }),
      );
    }
    fileSystem.putFile(
      layout.pickedSourceMarkerUri('invalid-marker'),
      JSON.stringify({
        schemaVersion: 2,
        pickerSourceUri: invalidMarkerTargetUri,
      }),
    );
    fileSystem.putFile(
      layout.pickedSourceMarkerUri('extra-key-marker'),
      JSON.stringify({
        schemaVersion: 1,
        pickerSourceUri: extraKeyMarkerTargetUri,
        unexpected: true,
      }),
    );

    await expect(recovery.recoverTransientCache()).resolves.toMatchObject({
      removedPickedSelectionIds: [
        'valid-marker',
        'outside-marker',
        'app-owned-marker',
        'invalid-marker',
        'extra-key-marker',
      ],
    });
    expect(fileSystem.fileExists(validPickerUri)).toBe(false);
    expect(fileSystem.fileExists(outsideCacheUri)).toBe(true);
    expect(fileSystem.fileExists(appOwnedCacheUri)).toBe(true);
    expect(fileSystem.fileExists(invalidMarkerTargetUri)).toBe(true);
    expect(fileSystem.fileExists(extraKeyMarkerTargetUri)).toBe(true);
  });

  test('retains a locked owned picker directory without blocking repository initialization', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.putFile(
      layout.projectIndexUri,
      JSON.stringify({ schemaVersion: 1, projects: [] } satisfies ProjectIndexFile),
    );

    const selectionId = 'locked-owned-selection';
    const selectionDirectoryUri = layout.pickedSelectionDirectoryUri(selectionId);
    fileSystem.putFile(layout.pickedSourceUri(selectionId, 'mov'), '', 512);
    fileSystem.lockDirectory(selectionDirectoryUri);

    await expect(repository.initialize()).resolves.toBeUndefined();

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(selectionDirectoryUri)).toBe(true);
    expect(repository.getLastRecoveryReport()).toMatchObject({
      removedPickedSelectionIds: [],
    });
  });

  test('retains a locked stray picker file for the next launch', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const layout = new StorageLayout(fileSystem);
    const recovery = new RecoveryService(layout, { now: () => NOW_MS });
    layout.ensureBaseDirectories();
    const strayUri = fileSystem.join(layout.pickedDirectoryUri, 'locked-stray.tmp');
    fileSystem.putFile(strayUri, 'marker');
    fileSystem.lockFile(strayUri);

    await expect(recovery.recoverTransientCache()).resolves.toEqual({
      removedPickedSelectionIds: [],
      diagnostics: [],
    });
    expect(fileSystem.fileExists(strayUri)).toBe(true);
  });

  test('restores a validated backup when the primary index is corrupt', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    seedIndexedAudio(fileSystem, layout, project);
    fileSystem.putFile(layout.projectIndexUri, '{bad json');
    fileSystem.putFile(
      layout.projectIndexBackupUri,
      JSON.stringify({ schemaVersion: 1, projects: [project] } satisfies ProjectIndexFile),
    );

    await repository.initialize();

    expect(repository.list()).toEqual([project]);
    expect(JSON.parse(await fileSystem.readText(layout.projectIndexUri))).toEqual({
      schemaVersion: 1,
      projects: [project],
    });
  });

  test('does not overwrite project files when every index copy is corrupt', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.putFile(layout.projectIndexUri, '{bad primary');
    fileSystem.putFile(layout.projectIndexBackupUri, '{bad backup');
    fileSystem.putFile(layout.projectAudioUri(ORPHAN_ID), '', 64);
    fileSystem.putFile(layout.projectWaveformUri(ORPHAN_ID), JSON.stringify(waveformFile()));
    const abandonedSelectionUri = layout.pickedSelectionDirectoryUri('abandoned-selection');
    fileSystem.putFile(layout.pickedSourceUri('abandoned-selection', 'mov'), '', 600);

    await expect(repository.initialize()).rejects.toMatchObject<Partial<ProjectRepositoryError>>({
      code: 'E_PROJECT_INDEX_CORRUPT',
    });
    expect(fileSystem.directoryExists(abandonedSelectionUri)).toBe(false);
    expect(fileSystem.fileExists(layout.projectAudioUri(ORPHAN_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectWaveformUri(ORPHAN_ID))).toBe(true);
  });

  test('cleans stale staging, prunes missing audio, and preserves valid orphans', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const missingProject = makeProject();
    fileSystem.putFile(
      layout.projectIndexUri,
      JSON.stringify({
        schemaVersion: 1,
        projects: [missingProject],
      } satisfies ProjectIndexFile),
    );

    const staleTaskUri = layout.stagingTaskDirectoryUri('old-import');
    fileSystem.setDirectoryModified(staleTaskUri, NOW_MS - 25 * 60 * 60 * 1000);
    const abandonedSelectionUri = layout.pickedSelectionDirectoryUri('old-selection');
    fileSystem.putFile(layout.pickedSourceUri('old-selection', 'mp4'), '', 128);
    fileSystem.putFile(layout.projectAudioUri(ORPHAN_ID), '', 64);
    fileSystem.putFile(layout.projectWaveformUri(ORPHAN_ID), JSON.stringify(waveformFile()));

    await repository.initialize();

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(staleTaskUri)).toBe(false);
    expect(fileSystem.directoryExists(abandonedSelectionUri)).toBe(false);
    expect(fileSystem.fileExists(layout.projectAudioUri(ORPHAN_ID))).toBe(true);
    expect(repository.getLastRecoveryReport()).toMatchObject({
      removedStagingTaskIds: ['old-import'],
      removedPickedSelectionIds: ['old-selection'],
      removedProjectIds: [PROJECT_ID],
      orphanProjectIds: [ORPHAN_ID],
    });
  });

  test('backs up the last valid index before replacing metadata', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    seedIndexedAudio(fileSystem, layout, project);
    fileSystem.putFile(
      layout.projectIndexUri,
      JSON.stringify({ schemaVersion: 1, projects: [project] } satisfies ProjectIndexFile),
    );
    await repository.initialize();

    await repository.rename(PROJECT_ID, 'New name');

    const primary = JSON.parse(
      await fileSystem.readText(layout.projectIndexUri),
    ) as ProjectIndexFile;
    const backup = JSON.parse(
      await fileSystem.readText(layout.projectIndexBackupUri),
    ) as ProjectIndexFile;
    expect(primary.projects[0]?.name).toBe('New name');
    expect(backup.projects[0]?.name).toBe('Practice');
  });
});
