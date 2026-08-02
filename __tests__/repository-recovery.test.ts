import type { DanceProject, StoredWaveform } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';
import {
  type FinalizeImportInput,
  ProjectRepository,
  ProjectRepositoryError,
} from '@/repositories/ProjectRepository';
import { RecoveryService, TRANSIENT_MAX_AGE_MS } from '@/services/RecoveryService';
import {
  IMPORT_METADATA_FILE_NAME,
  type StorageEntry,
  type StorageFileSystem,
  StorageLayout,
} from '@/services/StorageLayout';

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SECOND_PROJECT_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const CORRUPT_PROJECT_ID = 'bd65600d-8669-4903-8a14-af88203add38';
const NOW_MS = Date.parse('2026-07-30T12:00:00.000Z');

interface MemoryFile {
  content: string;
  size: number;
  lastModifiedMs: number;
}

class MemoryStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri = 'file:///documents';
  readonly cacheDirectoryUri = 'file:///cache';
  readonly directoryMoves: { sourceUri: string; destinationUri: string }[] = [];
  readonly directoryMoveFileNames: string[][] = [];
  private readonly directories = new Map<string, number>();
  private readonly files = new Map<string, MemoryFile>();
  private failMoveDestination: string | null = null;
  private deleteMoveDestinationBeforeFailure = false;
  private failMoveAfterCompletionDestination: string | null = null;
  private failDirectoryMove = false;
  private failDirectoryMoveAfterCopyKeepingSource = false;
  private failDirectoryMoveAfterCompletion = false;
  private failDeleteDirectoryUri: string | null = null;
  private ignoreDeleteDirectoryUri: string | null = null;

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
    this.putFile(uri, content);
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    const source = this.files.get(sourceUri);
    if (source === undefined) {
      throw new Error(`Missing memory file: ${sourceUri}`);
    }
    this.ensureDirectory(parentUri(destinationUri));
    this.files.set(destinationUri, { ...source });
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    if (this.failMoveDestination === destinationUri) {
      this.failMoveDestination = null;
      if (this.deleteMoveDestinationBeforeFailure) {
        this.files.delete(destinationUri);
      }
      this.deleteMoveDestinationBeforeFailure = false;
      throw new Error(`Simulated move failure: ${destinationUri}`);
    }
    await this.copyFile(sourceUri, destinationUri);
    this.files.delete(sourceUri);
    if (this.failMoveAfterCompletionDestination === destinationUri) {
      this.failMoveAfterCompletionDestination = null;
      throw new Error(`Simulated post-move failure: ${destinationUri}`);
    }
  }

  async moveDirectory(sourceUri: string, destinationUri: string): Promise<void> {
    const source = sourceUri.replace(/\/+$/, '');
    const destination = destinationUri.replace(/\/+$/, '');
    if (this.failDirectoryMove) {
      this.failDirectoryMove = false;
      throw new Error('Simulated directory rename failure.');
    }
    if (!this.directories.has(source) || this.directories.has(destination)) {
      throw new Error('Directory cannot be moved.');
    }

    const sourcePrefix = `${source}/`;
    const movedDirectories = [...this.directories.entries()].filter(
      ([candidate]) => candidate === source || candidate.startsWith(sourcePrefix),
    );
    const movedFiles = [...this.files.entries()].filter(([candidate]) =>
      candidate.startsWith(sourcePrefix),
    );
    this.directoryMoveFileNames.push(
      movedFiles.map(([candidate]) => candidate.slice(sourcePrefix.length)).sort(),
    );

    if (this.failDirectoryMoveAfterCopyKeepingSource) {
      this.failDirectoryMoveAfterCopyKeepingSource = false;
      movedDirectories.forEach(([candidate, modified]) => {
        this.directories.set(`${destination}${candidate.slice(source.length)}`, modified);
      });
      movedFiles.forEach(([candidate, file]) => {
        this.files.set(`${destination}${candidate.slice(source.length)}`, { ...file });
      });
      throw new Error('Simulated directory copy fallback failure.');
    }

    movedDirectories.forEach(([candidate]) => this.directories.delete(candidate));
    movedFiles.forEach(([candidate]) => this.files.delete(candidate));
    movedDirectories.forEach(([candidate, modified]) => {
      this.directories.set(`${destination}${candidate.slice(source.length)}`, modified);
    });
    movedFiles.forEach(([candidate, file]) => {
      this.files.set(`${destination}${candidate.slice(source.length)}`, file);
    });
    this.directoryMoves.push({ sourceUri: source, destinationUri: destination });
    if (this.failDirectoryMoveAfterCompletion) {
      this.failDirectoryMoveAfterCompletion = false;
      throw new Error('Simulated post-directory-move failure.');
    }
  }

  deleteFile(uri: string): void {
    this.files.delete(uri);
  }

  deleteDirectory(uri: string): void {
    const normalized = uri.replace(/\/+$/, '');
    if (this.ignoreDeleteDirectoryUri === normalized) {
      this.ignoreDeleteDirectoryUri = null;
      return;
    }
    if (this.failDeleteDirectoryUri === normalized) {
      this.failDeleteDirectoryUri = null;
      throw new Error(`Simulated directory delete failure: ${normalized}`);
    }
    const prefix = `${normalized}/`;
    this.directories.delete(normalized);
    [...this.directories.keys()].forEach((candidate) => {
      if (candidate.startsWith(prefix)) this.directories.delete(candidate);
    });
    [...this.files.keys()].forEach((candidate) => {
      if (candidate.startsWith(prefix)) this.files.delete(candidate);
    });
  }

  putFile(uri: string, content: string, size = content.length): void {
    this.ensureDirectory(parentUri(uri));
    this.files.set(uri, { content, size, lastModifiedMs: NOW_MS });
  }

  setDirectoryModified(uri: string, lastModifiedMs: number): void {
    this.directories.set(uri.replace(/\/+$/, ''), lastModifiedMs);
  }

  setFileModified(uri: string, lastModifiedMs: number): void {
    const file = this.files.get(uri);
    if (file !== undefined) this.files.set(uri, { ...file, lastModifiedMs });
  }

  failNextFileMoveTo(uri: string, deleteDestinationFirst = false): void {
    this.failMoveDestination = uri;
    this.deleteMoveDestinationBeforeFailure = deleteDestinationFirst;
  }

  failNextFileMoveAfterCompletion(uri: string): void {
    this.failMoveAfterCompletionDestination = uri;
  }

  failNextDirectoryRename(): void {
    this.failDirectoryMove = true;
  }

  failNextDirectoryMoveAfterCopyKeepingSource(): void {
    this.failDirectoryMoveAfterCopyKeepingSource = true;
  }

  failNextDirectoryMoveAfterCompletion(): void {
    this.failDirectoryMoveAfterCompletion = true;
  }

  failNextDirectoryDelete(uri: string): void {
    this.failDeleteDirectoryUri = uri.replace(/\/+$/, '');
  }

  ignoreNextDirectoryDelete(uri: string): void {
    this.ignoreDeleteDirectoryUri = uri.replace(/\/+$/, '');
  }
}

function parentUri(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/'));
}

function makeProject(id = PROJECT_ID, updatedAtIso = '2026-07-30T10:00:00.000Z'): DanceProject {
  return {
    schemaVersion: 1,
    id,
    name: 'Practice',
    createdAtIso: '2026-07-30T10:00:00.000Z',
    updatedAtIso,
    audioFileName: 'audio.m4a',
    waveformFileName: 'waveform.json',
    waveformStatus: 'ready',
    durationMs: 120_000,
    sourceDisplayName: null,
    sourceSizeBytes: 1_000,
    selectedRate: 1,
    leadInMs: 6_000,
    segments: createEmptySegments(),
  };
}

function waveformFile(durationMs = 120_000): StoredWaveform {
  return {
    schemaVersion: 1,
    durationMs,
    sampleCount: 2048,
    samples: Array.from({ length: 2048 }, () => 0),
  };
}

function importJournal(projectId = PROJECT_ID, expectedAudioSizeBytes = 32, durationMs = 120_000) {
  return {
    schemaVersion: 1,
    projectId,
    expectedAudioSizeBytes,
    durationMs,
  } as const;
}

function projectJournalUri(layout: StorageLayout, projectId = PROJECT_ID): string {
  return layout.fileSystem.join(layout.projectDirectoryUri(projectId), IMPORT_METADATA_FILE_NAME);
}

type FinalizeInputOverrides = Partial<Omit<FinalizeImportInput, 'inspection' | 'result'>> & {
  readonly inspection?: Partial<FinalizeImportInput['inspection']>;
  readonly result?: Partial<FinalizeImportInput['result']>;
};

function finalizeInput(
  layout: StorageLayout,
  overrides: FinalizeInputOverrides = {},
): FinalizeImportInput {
  const projectId = overrides.projectId ?? PROJECT_ID;
  const durationMs = overrides.result?.durationMs ?? 120_000;
  return {
    projectId,
    name: overrides.name ?? 'Practice',
    sourceDisplayName: overrides.sourceDisplayName ?? null,
    inspection: {
      sourceKind: 'video',
      sourceSizeBytes: null,
      durationMs,
      audioMimeType: 'audio/mp4a-latm',
      sampleRate: 48_000,
      channelCount: 2,
      ...overrides.inspection,
    },
    result: {
      audioUri: layout.importPartialAudioUri(projectId),
      audioSizeBytes: 32,
      durationMs,
      ...overrides.result,
    },
    ...(overrides.createdAtIso === undefined ? {} : { createdAtIso: overrides.createdAtIso }),
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

function seedProject(
  fileSystem: MemoryStorageFileSystem,
  layout: StorageLayout,
  project: DanceProject,
): void {
  fileSystem.ensureDirectory(layout.projectDirectoryUri(project.id));
  fileSystem.putFile(layout.projectMetadataUri(project.id), JSON.stringify(project));
  fileSystem.putFile(layout.projectAudioUri(project.id), 'audio', 32);
  fileSystem.putFile(layout.projectWaveformUri(project.id), JSON.stringify(waveformFile()));
}

describe('Android project repository and recovery', () => {
  test('uses the Documents/TempoLoop project and import directory contract', () => {
    const layout = new StorageLayout(new MemoryStorageFileSystem());

    expect(layout.projectsDirectoryUri).toBe('file:///documents/TempoLoop/projects');
    expect(layout.projectMetadataUri(PROJECT_ID)).toBe(
      `file:///documents/TempoLoop/projects/${PROJECT_ID}/project.json`,
    );
    expect(layout.importDirectoryUri(PROJECT_ID)).toBe(
      `file:///documents/TempoLoop/imports/.import-${PROJECT_ID}`,
    );
    expect(layout.importPartialAudioUri(PROJECT_ID)).toMatch(/\/audio\.m4a\.partial$/);
  });

  test('discovers project.json files without consulting a global index and sorts newest first', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.putFile(`${layout.documentsRootUri}/projects.json`, '{corrupt old index');
    const older = makeProject(PROJECT_ID, '2026-07-30T10:00:00.000Z');
    const newer = makeProject(SECOND_PROJECT_ID, '2026-07-30T11:00:00.000Z');
    seedProject(fileSystem, layout, older);
    seedProject(fileSystem, layout, newer);

    await repository.initialize();

    expect(repository.list().map(({ id }) => id)).toEqual([SECOND_PROJECT_ID, PROJECT_ID]);
    expect(repository.getMediaStatus(PROJECT_ID)).toEqual({ state: 'ready', issues: [] });
  });

  test('loads legacy schema-v1 metadata without leadInMs using the six-second default', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const legacyProject = { ...makeProject() } as Partial<DanceProject>;
    delete legacyProject.leadInMs;
    fileSystem.ensureDirectory(layout.projectDirectoryUri(PROJECT_ID));
    fileSystem.putFile(layout.projectMetadataUri(PROJECT_ID), JSON.stringify(legacyProject));
    fileSystem.putFile(layout.projectAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));

    await repository.initialize();

    expect(repository.get(PROJECT_ID)?.leadInMs).toBe(6_000);
  });

  test('ignores corrupt project metadata and reports it without crashing discovery', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    fileSystem.putFile(layout.projectMetadataUri(CORRUPT_PROJECT_ID), '{broken json');

    await expect(repository.initialize()).resolves.toBeUndefined();

    expect(repository.list()).toHaveLength(1);
    expect(repository.getLastRecoveryReport()).toMatchObject({
      corruptProjectIds: [CORRUPT_PROJECT_ID],
      diagnostics: expect.arrayContaining([
        { code: 'CORRUPT_PROJECT_METADATA', projectId: CORRUPT_PROJECT_ID },
      ]),
    });
  });

  test('retains projects with missing or invalid media and marks them as needing repair', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const missingMedia = makeProject(PROJECT_ID);
    fileSystem.putFile(layout.projectMetadataUri(PROJECT_ID), JSON.stringify(missingMedia));
    const invalidWaveform = makeProject(SECOND_PROJECT_ID);
    fileSystem.putFile(
      layout.projectMetadataUri(SECOND_PROJECT_ID),
      JSON.stringify(invalidWaveform),
    );
    fileSystem.putFile(layout.projectAudioUri(SECOND_PROJECT_ID), 'audio', 32);
    fileSystem.putFile(layout.projectWaveformUri(SECOND_PROJECT_ID), '{invalid');

    await repository.initialize();

    expect(repository.list()).toHaveLength(2);
    expect(repository.getMediaStatus(PROJECT_ID)).toEqual({
      state: 'needs-repair',
      issues: ['AUDIO_MISSING_OR_EMPTY', 'WAVEFORM_MISSING'],
    });
    expect(repository.getMediaStatus(SECOND_PROJECT_ID)).toEqual({
      state: 'needs-repair',
      issues: ['WAVEFORM_INVALID'],
    });
  });

  test('keeps pending and failed projects playable without a waveform file', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    for (const [id, waveformStatus] of [
      [PROJECT_ID, 'pending'],
      [SECOND_PROJECT_ID, 'failed'],
    ] as const) {
      const project = { ...makeProject(id), waveformStatus };
      fileSystem.putFile(layout.projectMetadataUri(id), JSON.stringify(project));
      fileSystem.putFile(layout.projectAudioUri(id), 'audio', 32);
    }

    await repository.initialize();

    expect(repository.getMediaStatus(PROJECT_ID)).toEqual({ state: 'ready', issues: [] });
    expect(repository.getMediaStatus(SECOND_PROJECT_ID)).toEqual({ state: 'ready', issues: [] });
  });

  test('removes only imports and validated-sibling temp files older than one hour', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    seedProject(fileSystem, layout, project);

    const staleImport = layout.importDirectoryUri('old-import');
    const recentImport = layout.importDirectoryUri('recent-import');
    fileSystem.setDirectoryModified(staleImport, NOW_MS - TRANSIENT_MAX_AGE_MS - 1);
    fileSystem.setDirectoryModified(recentImport, NOW_MS - TRANSIENT_MAX_AGE_MS + 1);

    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), '{interrupted write');
    fileSystem.setFileModified(
      layout.projectMetadataTempUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );
    fileSystem.putFile(layout.projectWaveformTempUri(PROJECT_ID), '{recent write');
    fileSystem.setFileModified(
      layout.projectWaveformTempUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS + 1,
    );

    const corruptProjectDirectory = layout.projectDirectoryUri(CORRUPT_PROJECT_ID);
    fileSystem.putFile(`${corruptProjectDirectory}/project.json`, '{bad sibling');
    fileSystem.putFile(`${corruptProjectDirectory}/project.json.tmp`, '{}');
    fileSystem.setFileModified(
      `${corruptProjectDirectory}/project.json.tmp`,
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );

    await repository.initialize();

    expect(fileSystem.directoryExists(staleImport)).toBe(false);
    expect(fileSystem.directoryExists(recentImport)).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectWaveformTempUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(`${corruptProjectDirectory}/project.json.tmp`)).toBe(true);
    expect(repository.getLastRecoveryReport()).toMatchObject({
      removedImportIds: ['old-import'],
    });
  });

  test('finalizes an import only through one complete-directory rename', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    expect(repository.list()).toEqual([]);

    const project = await repository.finalizeImport(
      finalizeInput(layout, {
        name: '  New Practice  ',
        sourceDisplayName: 'dance.mp4',
        inspection: { sourceSizeBytes: 2_000 },
      }),
    );

    expect(project.name).toBe('New Practice');
    expect(project.sourceDisplayName).toBe('dance.mp4');
    expect(project.sourceSizeBytes).toBe(2_000);
    expect(project.durationMs).toBe(120_000);
    expect(project.leadInMs).toBe(6_000);
    expect(project.waveformStatus).toBe('pending');
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectAudioUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectWaveformUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(projectJournalUri(layout))).toBe(false);
    expect(JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID)))).toEqual(
      project,
    );
    expect(fileSystem.directoryMoves).toEqual([
      {
        sourceUri: layout.importDirectoryUri(PROJECT_ID),
        destinationUri: layout.projectDirectoryUri(PROJECT_ID),
      },
    ]);
    expect(fileSystem.directoryMoveFileNames).toEqual([
      ['audio.m4a', 'import.json', 'project.json.tmp'],
    ]);
  });

  test('rejects a native audio URI that is not the exact transaction partial', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);

    await expect(
      repository.finalizeImport(
        finalizeInput(layout, {
          result: { audioUri: `${layout.importPartialAudioUri(PROJECT_ID)}-other` },
        }),
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_LOCAL_URI' });

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
  });

  test('rolls back an import collision without touching the existing Project', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    await repository.initialize();
    fileSystem.ensureDirectory(layout.importDirectoryUri(PROJECT_ID));
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);

    await expect(repository.finalizeImport(finalizeInput(layout))).rejects.toMatchObject({
      code: 'E_PROJECT_ALREADY_EXISTS',
    });

    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(repository.get(PROJECT_ID)?.name).toBe('Practice');
    expect(fileSystem.fileExists(layout.projectAudioUri(PROJECT_ID))).toBe(true);
  });

  test('rejects native audio metadata that disagrees with the partial file', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);

    await expect(
      repository.finalizeImport(finalizeInput(layout, { result: { audioSizeBytes: 31 } })),
    ).rejects.toMatchObject({ code: 'E_IMPORT_RESULT_INVALID' });

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
  });

  test('rejects malformed inspection and waveform results before Project visibility', async () => {
    const invalidInputs: FinalizeInputOverrides[] = [
      { inspection: { durationMs: 0 } },
      { inspection: { sourceSizeBytes: 0 } },
      { result: { durationMs: 0 } },
      { result: { audioSizeBytes: 0 } },
      { result: { durationMs: 0 } },
    ];

    for (const overrides of invalidInputs) {
      const fileSystem = new MemoryStorageFileSystem();
      const { layout, repository } = makeRepository(fileSystem);
      await repository.initialize();
      repository.createImportDirectory(PROJECT_ID);
      fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);

      await expect(
        repository.finalizeImport(finalizeInput(layout, overrides)),
      ).rejects.toBeInstanceOf(ProjectRepositoryError);
      expect(repository.list()).toEqual([]);
      expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
      expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    }
  });

  test('accepts a native move error only when the committed metadata matches the intent', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextFileMoveAfterCompletion(layout.projectMetadataUri(PROJECT_ID));

    await expect(
      repository.finalizeImport(finalizeInput(layout, { name: 'Committed Practice' })),
    ).resolves.toMatchObject({ id: PROJECT_ID, name: 'Committed Practice' });

    expect(repository.get(PROJECT_ID)?.name).toBe('Committed Practice');
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(false);
  });

  test('accepts an audio move rejection only after verifying the completed move', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextFileMoveAfterCompletion(layout.importAudioUri(PROJECT_ID));

    await expect(repository.finalizeImport(finalizeInput(layout))).resolves.toMatchObject({
      id: PROJECT_ID,
    });

    expect(fileSystem.fileExists(layout.projectAudioUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.importPartialAudioUri(PROJECT_ID))).toBe(false);
  });

  test('does not expose an import when the final directory rename fails', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextDirectoryRename();

    await expect(repository.finalizeImport(finalizeInput(layout))).rejects.toThrow(
      'Simulated directory rename failure',
    );

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
  });

  test('accepts a completed directory move when the native promise rejects afterward', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextDirectoryMoveAfterCompletion();

    await expect(
      repository.finalizeImport(finalizeInput(layout, { name: 'Completed Move' })),
    ).resolves.toMatchObject({ id: PROJECT_ID, name: 'Completed Move' });

    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(projectJournalUri(layout))).toBe(false);
  });

  test('preserves the import source when an uncommitted fallback target cannot be deleted', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextDirectoryMoveAfterCopyKeepingSource();
    fileSystem.failNextDirectoryDelete(layout.projectDirectoryUri(PROJECT_ID));

    await expect(repository.finalizeImport(finalizeInput(layout))).rejects.toThrow(
      'Simulated directory copy fallback failure',
    );

    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(projectJournalUri(layout))).toBe(true);
    expect(fileSystem.fileExists(layout.importMetadataUri(PROJECT_ID))).toBe(true);
  });

  test('removes an uncommitted final target when metadata promotion fails', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    await repository.initialize();
    repository.createImportDirectory(PROJECT_ID);
    fileSystem.putFile(layout.importPartialAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.failNextFileMoveTo(layout.projectMetadataUri(PROJECT_ID));

    await expect(repository.finalizeImport(finalizeInput(layout))).rejects.toThrow(
      `Simulated move failure: ${layout.projectMetadataUri(PROJECT_ID)}`,
    );

    expect(repository.list()).toEqual([]);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(false);
  });

  test('recovers a complete fallback target only after its source directory is gone', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), JSON.stringify(project));
    fileSystem.putFile(layout.projectAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));
    fileSystem.putFile(projectJournalUri(layout), JSON.stringify(importJournal()));

    await repository.initialize();

    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
    expect(repository.list().map(({ id }) => id)).toEqual([PROJECT_ID]);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(projectJournalUri(layout))).toBe(false);
    expect(repository.getLastRecoveryReport()?.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'JSON_TEMP_COMMITTED',
          projectId: PROJECT_ID,
          fileName: 'project.json',
        },
      ]),
    );
  });

  test('does not commit temporary metadata for a partially copied project directory', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), JSON.stringify(project));
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));
    fileSystem.putFile(projectJournalUri(layout), JSON.stringify(importJournal()));

    await repository.initialize();

    expect(repository.list()).toEqual([]);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(true);
  });

  test('does not commit a nonempty but truncated audio fallback target', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), JSON.stringify(project));
    fileSystem.putFile(layout.projectAudioUri(PROJECT_ID), 'truncated', 16);
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));
    fileSystem.putFile(projectJournalUri(layout), JSON.stringify(importJournal(PROJECT_ID, 32)));

    await repository.initialize();

    expect(repository.list()).toEqual([]);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(true);
  });

  test('does not commit a complete target while its import source still exists', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const project = makeProject();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), JSON.stringify(project));
    fileSystem.putFile(layout.projectAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));
    fileSystem.putFile(projectJournalUri(layout), JSON.stringify(importJournal()));
    fileSystem.ensureDirectory(layout.importDirectoryUri(PROJECT_ID));

    await repository.initialize();

    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(repository.list()).toEqual([]);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
  });

  test('removes a target with missing temp and journal before cleaning its stale source', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.ensureDirectory(layout.projectDirectoryUri(PROJECT_ID));
    fileSystem.ensureDirectory(layout.importDirectoryUri(PROJECT_ID));
    fileSystem.setDirectoryModified(
      layout.importDirectoryUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );

    await repository.initialize();

    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
  });

  test('removes a target with corrupt temp and journal before cleaning its stale source', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), '{corrupt temp');
    fileSystem.putFile(projectJournalUri(layout), '{truncated journal');
    fileSystem.ensureDirectory(layout.importDirectoryUri(PROJECT_ID));
    fileSystem.setDirectoryModified(
      layout.importDirectoryUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );

    await repository.initialize();

    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(false);
  });

  test('keeps the source and refuses commit when launch cleanup cannot delete its target', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.putFile(layout.projectMetadataTempUri(PROJECT_ID), '{corrupt temp');
    fileSystem.putFile(layout.projectAudioUri(PROJECT_ID), 'audio', 32);
    fileSystem.putFile(layout.projectWaveformUri(PROJECT_ID), JSON.stringify(waveformFile()));
    fileSystem.putFile(projectJournalUri(layout), '{truncated journal');
    fileSystem.ensureDirectory(layout.importDirectoryUri(PROJECT_ID));
    fileSystem.setDirectoryModified(
      layout.importDirectoryUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );
    fileSystem.failNextDirectoryDelete(layout.projectDirectoryUri(PROJECT_ID));

    await repository.initialize();

    expect(fileSystem.directoryExists(layout.importDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(repository.list()).toEqual([]);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(false);
  });

  test('restores a valid metadata backup after a crash in the replacement window', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    const committed = makeProject();
    seedProject(fileSystem, layout, committed);
    fileSystem.putFile(layout.projectMetadataBackupUri(PROJECT_ID), JSON.stringify(committed));
    fileSystem.putFile(
      layout.projectMetadataTempUri(PROJECT_ID),
      JSON.stringify({ ...committed, name: 'Uncommitted replacement' }),
    );
    fileSystem.deleteFile(layout.projectMetadataUri(PROJECT_ID));

    await repository.initialize();

    expect(repository.get(PROJECT_ID)?.name).toBe('Practice');
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataBackupUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(true);
    expect(repository.getLastRecoveryReport()?.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'JSON_BACKUP_RESTORED',
          projectId: PROJECT_ID,
          fileName: 'project.json',
        },
      ]),
    );
  });

  test('restores old metadata when Expo move deletes the destination before failing', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    await repository.initialize();
    fileSystem.failNextFileMoveTo(layout.projectMetadataUri(PROJECT_ID), true);

    await expect(repository.rename(PROJECT_ID, 'Changed')).rejects.toThrow(
      'Simulated move failure',
    );

    expect(repository.get(PROJECT_ID)?.name).toBe('Practice');
    expect(
      JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID))),
    ).toMatchObject({ name: 'Practice' });
    expect(fileSystem.fileExists(layout.projectMetadataTempUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.fileExists(layout.projectMetadataBackupUri(PROJECT_ID))).toBe(false);
  });

  test('does not mistake an unchanged valid destination for the intended replacement', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    await repository.initialize();
    fileSystem.failNextFileMoveTo(layout.projectMetadataUri(PROJECT_ID));

    await expect(repository.rename(PROJECT_ID, 'Changed')).rejects.toThrow(
      'Simulated move failure',
    );

    expect(repository.get(PROJECT_ID)?.name).toBe('Practice');
    expect(
      JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID))),
    ).toMatchObject({ name: 'Practice' });
  });

  test('keeps a stale waveform temp when the sibling duration does not match the project', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    fileSystem.putFile(
      layout.projectWaveformUri(PROJECT_ID),
      JSON.stringify(waveformFile(119_000)),
    );
    fileSystem.putFile(layout.projectWaveformTempUri(PROJECT_ID), '{interrupted write');
    fileSystem.setFileModified(
      layout.projectWaveformTempUri(PROJECT_ID),
      NOW_MS - TRANSIENT_MAX_AGE_MS - 1,
    );

    await repository.initialize();

    expect(fileSystem.fileExists(layout.projectWaveformTempUri(PROJECT_ID))).toBe(true);
    expect(repository.getMediaStatus(PROJECT_ID)).toEqual({
      state: 'needs-repair',
      issues: ['WAVEFORM_DURATION_MISMATCH'],
    });
  });

  test('atomically persists practice preferences and deletes only the requested project directory', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    seedProject(fileSystem, layout, makeProject(SECOND_PROJECT_ID));
    await repository.initialize();

    await repository.updateSelectedRate(PROJECT_ID, 0.8);
    expect(repository.get(PROJECT_ID)?.selectedRate).toBe(0.8);
    await repository.updateLeadInMs(PROJECT_ID, 2_000);
    expect(repository.get(PROJECT_ID)?.leadInMs).toBe(2_000);
    expect(
      JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID))),
    ).toMatchObject({ selectedRate: 0.8, leadInMs: 2_000 });
    await repository.delete(PROJECT_ID);

    expect(repository.get(PROJECT_ID)).toBeNull();
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(SECOND_PROJECT_ID))).toBe(true);
  });

  test('keeps a Project visible when its directory deletion fails', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    await repository.initialize();
    fileSystem.failNextDirectoryDelete(layout.projectDirectoryUri(PROJECT_ID));

    await expect(repository.delete(PROJECT_ID)).rejects.toThrow(
      'Simulated directory delete failure',
    );

    expect(repository.get(PROJECT_ID)).not.toBeNull();
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
  });

  test('verifies deletion before removing a Project from the in-memory list', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const { layout, repository } = makeRepository(fileSystem);
    layout.ensureBaseDirectories();
    seedProject(fileSystem, layout, makeProject());
    await repository.initialize();
    fileSystem.ignoreNextDirectoryDelete(layout.projectDirectoryUri(PROJECT_ID));

    await expect(repository.delete(PROJECT_ID)).rejects.toMatchObject({
      code: 'E_PROJECT_DELETE_FAILED',
    });

    expect(repository.get(PROJECT_ID)).not.toBeNull();
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
  });
});
