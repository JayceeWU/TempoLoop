import * as ImagePicker from 'expo-image-picker';

import { MAX_VIDEO_BYTES, WAVEFORM_POINT_COUNT } from '@/constants/app';
import type { DanceProject, WaveformFile } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';
import type { CreateProjectInput } from '@/repositories/ProjectRepository';
import {
  IMPORT_KEEP_AWAKE_TAG,
  ImportCoordinator,
  ImportCoordinatorError,
  type ImportNativeAudioDependency,
  type ImportProgressSnapshot,
  type ImportProjectRepository,
  type KeepAwakeDependency,
  type VideoPickerDependency,
} from '@/services/ImportCoordinator';
import type { NativeAudioSubscription } from '@/services/NativeAudioService';
import { RecoveryService } from '@/services/RecoveryService';
import { type StorageEntry, type StorageFileSystem, StorageLayout } from '@/services/StorageLayout';
import type { ImportFileAccess } from '@/utils/file';
import { AppError } from '@/utils/errors';
import type { ImportProgressEvent } from '../modules/dance-audio';

const SELECTION_ID = '00000000-0000-4000-8000-000000000000';
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const VIDEO_URI = 'file:///cache/ImagePicker/rehearsal.mov';
const VIDEO_BYTES = 250 * 1024 * 1024;
const DURATION_MS = 90_000;

class MemoryStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri = 'file:///documents';
  readonly cacheDirectoryUri = 'file:///cache';
  readonly directories = new Set<string>();
  readonly files = new Map<string, { content: string; size: number }>();
  readonly deletedDirectories: string[] = [];

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
    this.directories.add(uri.replace(/\/+$/, ''));
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

    for (const candidate of this.directories) {
      const name = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
      if (name.length > 0 && !name.includes('/')) {
        entries.push({
          uri: candidate,
          name,
          kind: 'directory',
          size: null,
          lastModifiedMs: null,
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
          lastModifiedMs: null,
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
    this.files.set(uri, { content, size: content.length });
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
    this.files.delete(uri);
  }

  deleteDirectory(uri: string): void {
    const normalized = uri.replace(/\/+$/, '');
    const prefix = `${normalized}/`;
    this.deletedDirectories.push(normalized);
    this.directories.delete(normalized);

    for (const candidate of [...this.directories]) {
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
    this.files.set(uri, { content, size });
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeProject(input: CreateProjectInput): DanceProject {
  const timestamp = '2026-07-30T12:00:00.000Z';
  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    createdAtIso: timestamp,
    updatedAtIso: timestamp,
    durationMs: input.durationMs,
    sourceVideoBytes: input.sourceVideoBytes,
    audioRelativePath: `Projects/${input.id}/audio.m4a`,
    waveformRelativePath: `Projects/${input.id}/waveform.json`,
    preferredRate: 1,
    lastSelectedSegment: null,
    segments: createEmptySegments(),
  };
}

function videoPickerResult(
  overrides: Partial<ImagePicker.ImagePickerAsset> = {},
): ImagePicker.ImagePickerResult {
  return {
    canceled: false,
    assets: [
      {
        uri: VIDEO_URI,
        type: 'video',
        fileName: 'rehearsal.mov',
        fileSize: VIDEO_BYTES,
        width: 1920,
        height: 1080,
        ...overrides,
      },
    ],
  };
}

interface Harness {
  coordinator: ImportCoordinator;
  layout: StorageLayout;
  fileSystem: MemoryStorageFileSystem;
  picker: VideoPickerDependency;
  launchPicker: jest.MockedFunction<VideoPickerDependency['launchImageLibraryAsync']>;
  fileAccess: ImportFileAccess;
  getFileSize: jest.MockedFunction<ImportFileAccess['getFileSize']>;
  getAvailableDiskSpace: jest.MockedFunction<ImportFileAccess['getAvailableDiskSpace']>;
  cleanupPickedFile: jest.MockedFunction<ImportFileAccess['deleteCacheFileIfOwned']>;
  nativeAudio: ImportNativeAudioDependency;
  extractAudio: jest.MockedFunction<ImportNativeAudioDependency['extractAudio']>;
  generateWaveform: jest.MockedFunction<ImportNativeAudioDependency['generateWaveform']>;
  cancelTask: jest.MockedFunction<ImportNativeAudioDependency['cancelTask']>;
  emitNativeProgress(event: ImportProgressEvent): void;
  removeSubscription: jest.Mock;
  keepAwake: KeepAwakeDependency;
  activateKeepAwake: jest.MockedFunction<KeepAwakeDependency['activate']>;
  deactivateKeepAwake: jest.MockedFunction<KeepAwakeDependency['deactivate']>;
  repository: ImportProjectRepository;
  initializeRepository: jest.MockedFunction<ImportProjectRepository['initialize']>;
  createProject: jest.MockedFunction<ImportProjectRepository['createFromImportedFiles']>;
  committedWaveforms: WaveformFile[];
}

function createHarness(pickerResult: ImagePicker.ImagePickerResult = videoPickerResult()): Harness {
  const fileSystem = new MemoryStorageFileSystem();
  const layout = new StorageLayout(fileSystem);
  if (!pickerResult.canceled) {
    pickerResult.assets.forEach((asset) => {
      fileSystem.putFile(
        asset.uri,
        '',
        typeof asset.fileSize === 'number' ? asset.fileSize : VIDEO_BYTES,
      );
    });
  }
  const launchPicker = jest.fn<
    ReturnType<VideoPickerDependency['launchImageLibraryAsync']>,
    Parameters<VideoPickerDependency['launchImageLibraryAsync']>
  >(async () => pickerResult);
  const picker: VideoPickerDependency = {
    requestMediaLibraryPermissionsAsync: jest.fn(async () => ({
      granted: true,
    })),
    launchImageLibraryAsync: launchPicker,
  };

  const getFileSize = jest.fn<number, [uri: string]>(() => VIDEO_BYTES);
  const getAvailableDiskSpace = jest.fn<number, []>(() => 2 * 1024 * 1024 * 1024);
  const cleanupPickedFile = jest.fn<
    ReturnType<ImportFileAccess['deleteCacheFileIfOwned']>,
    Parameters<ImportFileAccess['deleteCacheFileIfOwned']>
  >(() => 'deleted');
  const fileAccess: ImportFileAccess = {
    getFileSize,
    getAvailableDiskSpace,
    deleteCacheFileIfOwned: cleanupPickedFile,
  };

  let progressListener: ((event: ImportProgressEvent) => void) | null = null;
  const removeSubscription = jest.fn();
  const extractAudio = jest.fn<
    ReturnType<ImportNativeAudioDependency['extractAudio']>,
    Parameters<ImportNativeAudioDependency['extractAudio']>
  >(async (taskId, _inputUri, outputUri) => {
    progressListener?.({
      taskId,
      phase: 'extracting',
      progress: 0.4,
    });
    fileSystem.putFile(outputUri, '', 1024);
    return { durationMs: DURATION_MS, outputBytes: 1024 };
  });
  const generateWaveform = jest.fn<
    ReturnType<ImportNativeAudioDependency['generateWaveform']>,
    Parameters<ImportNativeAudioDependency['generateWaveform']>
  >(async (taskId) => {
    progressListener?.({
      taskId,
      phase: 'waveform',
      progress: 0.6,
    });
    return Array.from({ length: WAVEFORM_POINT_COUNT }, () => 0.25);
  });
  const cancelTask = jest.fn<
    ReturnType<ImportNativeAudioDependency['cancelTask']>,
    Parameters<ImportNativeAudioDependency['cancelTask']>
  >(async () => undefined);
  const nativeAudio: ImportNativeAudioDependency = {
    extractAudio,
    generateWaveform,
    cancelTask,
    addImportProgressListener(listener) {
      progressListener = listener;
      const subscription: NativeAudioSubscription = {
        remove: removeSubscription,
      };
      return subscription;
    },
  };

  const activateKeepAwake = jest.fn<Promise<void>, [tag: string]>(async () => undefined);
  const deactivateKeepAwake = jest.fn<Promise<void>, [tag: string]>(async () => undefined);
  const keepAwake: KeepAwakeDependency = {
    activate: activateKeepAwake,
    deactivate: deactivateKeepAwake,
  };

  const initializeRepository = jest.fn<Promise<void>, []>(async () => undefined);
  const committedWaveforms: WaveformFile[] = [];
  const createProject = jest.fn<Promise<DanceProject>, [input: CreateProjectInput]>(
    async (input) => {
      committedWaveforms.push(
        JSON.parse(await fileSystem.readText(input.stagedWaveformUri)) as WaveformFile,
      );
      return makeProject(input);
    },
  );
  const repository: ImportProjectRepository = {
    initialize: initializeRepository,
    createFromImportedFiles: createProject,
  };

  const uuidValues = [SELECTION_ID, TASK_ID, PROJECT_ID];
  const coordinator = new ImportCoordinator({
    picker,
    fileAccess,
    keepAwake,
    nativeAudio,
    repository,
    layout,
    randomUuid: () => uuidValues.shift() ?? crypto.randomUUID(),
  });

  return {
    coordinator,
    layout,
    fileSystem,
    picker,
    launchPicker,
    fileAccess,
    getFileSize,
    getAvailableDiskSpace,
    cleanupPickedFile,
    nativeAudio,
    extractAudio,
    generateWaveform,
    cancelTask,
    emitNativeProgress(event) {
      progressListener?.(event);
    },
    removeSubscription,
    keepAwake,
    activateKeepAwake,
    deactivateKeepAwake,
    repository,
    initializeRepository,
    createProject,
    committedWaveforms,
  };
}

describe('ImportCoordinator video selection', () => {
  test('prevents overlapping picker requests until the first selection finishes', async () => {
    const harness = createHarness();
    const pickerResult = deferred<ImagePicker.ImagePickerResult>();
    harness.launchPicker.mockReturnValueOnce(pickerResult.promise);

    const firstSelection = harness.coordinator.selectVideo();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.launchPicker).toHaveBeenCalledTimes(1);

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_IMPORT_IN_PROGRESS',
    });
    expect(harness.launchPicker).toHaveBeenCalledTimes(1);

    pickerResult.resolve(videoPickerResult());
    await expect(firstSelection).resolves.toMatchObject({ selectionId: SELECTION_ID });
  });

  test('requests one unmodified video with iCloud download and falls back to File.size', async () => {
    const harness = createHarness(
      videoPickerResult({ fileName: 'Studio Run.MOV', fileSize: undefined }),
    );

    await expect(harness.coordinator.selectVideo()).resolves.toEqual({
      selectionId: SELECTION_ID,
      uri: harness.layout.pickedSourceUri(SELECTION_ID, 'mov'),
      sourceExtension: 'mov',
      sizeBytes: VIDEO_BYTES,
      fileName: 'Studio Run.MOV',
      suggestedName: 'Studio Run',
    });

    expect(harness.getFileSize).toHaveBeenCalledWith(VIDEO_URI);
    expect(harness.fileSystem.fileExists(VIDEO_URI)).toBe(false);
    expect(harness.fileSystem.fileExists(harness.layout.pickedSourceUri(SELECTION_ID, 'mov'))).toBe(
      true,
    );
    expect(harness.launchPicker).toHaveBeenCalledWith({
      mediaTypes: ['videos'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      shouldDownloadFromNetwork: true,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
  });

  test('deletes the deterministic app-owned selection directory when naming is discarded', async () => {
    const harness = createHarness();
    const selection = await harness.coordinator.selectVideo();

    expect(selection).not.toBeNull();
    harness.coordinator.discardSelection(selection!);

    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);
    expect(harness.cleanupPickedFile).not.toHaveBeenCalled();
  });

  test('rejects a picker URI outside Cache before attempting ownership transfer', async () => {
    const outsideCacheUri = 'file:///documents/rehearsal.mov';
    const harness = createHarness(videoPickerResult({ uri: outsideCacheUri }));

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_INVALID_LOCAL_URI',
    });
    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);
  });

  test('cleans both ownership staging and the guarded picker source when move fails', async () => {
    const harness = createHarness();
    jest
      .spyOn(harness.fileSystem, 'moveFile')
      .mockRejectedValueOnce(new Error('simulated same-volume move failure'));

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_PICKER_RESULT_INVALID',
    });
    expect(harness.cleanupPickedFile).toHaveBeenCalledWith(VIDEO_URI);
    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);
  });

  test('keeps a validated cleanup marker when a failed move leaves a locked picker copy', async () => {
    const harness = createHarness();
    jest
      .spyOn(harness.fileSystem, 'moveFile')
      .mockRejectedValueOnce(new Error('simulated same-volume move failure'));
    harness.cleanupPickedFile.mockImplementationOnce(() => {
      throw new Error('simulated picker file lock');
    });

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_PICKER_RESULT_INVALID',
    });

    const selectionDirectoryUri = harness.layout.pickedSelectionDirectoryUri(SELECTION_ID);
    expect(harness.fileSystem.directoryExists(selectionDirectoryUri)).toBe(true);
    await expect(
      harness.fileSystem.readText(harness.layout.pickedSourceMarkerUri(SELECTION_ID)),
    ).resolves.toBe(
      JSON.stringify({
        schemaVersion: 1,
        pickerSourceUri: VIDEO_URI,
      }),
    );

    const recovery = new RecoveryService(harness.layout);
    await expect(recovery.recoverTransientCache()).resolves.toMatchObject({
      removedPickedSelectionIds: [SELECTION_ID],
    });
    expect(harness.fileSystem.fileExists(VIDEO_URI)).toBe(false);
    expect(harness.fileSystem.directoryExists(selectionDirectoryUri)).toBe(false);
  });

  test('rejects permission denial before opening the picker', async () => {
    const harness = createHarness();
    harness.picker.requestMediaLibraryPermissionsAsync = jest.fn(async () => ({
      granted: false,
    }));

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_PHOTO_PERMISSION_DENIED',
    });
    expect(harness.launchPicker).not.toHaveBeenCalled();
  });

  test('rejects a video over 600 MB and deletes only through guarded cache cleanup', async () => {
    const oversizedBytes = MAX_VIDEO_BYTES + 1;
    const harness = createHarness(videoPickerResult({ fileSize: oversizedBytes }));

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_VIDEO_TOO_LARGE',
      details: {
        sizeBytes: oversizedBytes,
        maxSizeBytes: MAX_VIDEO_BYTES,
      },
    });
    expect(harness.cleanupPickedFile).toHaveBeenCalledWith(VIDEO_URI);
    expect(harness.extractAudio).not.toHaveBeenCalled();
  });

  test('rejects low storage before extraction and reports required bytes', async () => {
    const harness = createHarness();
    harness.getAvailableDiskSpace.mockReturnValue(1024);

    await expect(harness.coordinator.selectVideo()).rejects.toMatchObject<
      Partial<ImportCoordinatorError>
    >({
      code: 'E_INSUFFICIENT_STORAGE',
      details: {
        availableBytes: 1024,
        requiredBytes: 1024 * 1024 * 1024,
      },
    });
    expect(harness.cleanupPickedFile).toHaveBeenCalledWith(VIDEO_URI);
  });
});

describe('ImportCoordinator transaction', () => {
  test('extracts, validates waveform JSON, commits once, and cleans temporary files', async () => {
    const harness = createHarness();
    const selection = await harness.coordinator.selectVideo();
    expect(selection).not.toBeNull();
    const progress: ImportProgressSnapshot[] = [];

    const project = await harness.coordinator.importProject({
      selection: selection!,
      name: '  Stage rehearsal  ',
      onProgress: (snapshot) => progress.push(snapshot),
    });

    expect(project.id).toBe(PROJECT_ID);
    expect(harness.extractAudio).toHaveBeenCalledWith(
      TASK_ID,
      harness.layout.pickedSourceUri(SELECTION_ID, 'mov'),
      harness.layout.stagingAudioUri(TASK_ID),
    );
    expect(harness.generateWaveform).toHaveBeenCalledWith(
      TASK_ID,
      harness.layout.stagingAudioUri(TASK_ID),
      WAVEFORM_POINT_COUNT,
    );
    expect(harness.createProject).toHaveBeenCalledWith({
      id: PROJECT_ID,
      name: 'Stage rehearsal',
      durationMs: DURATION_MS,
      sourceVideoBytes: VIDEO_BYTES,
      stagedAudioUri: harness.layout.stagingAudioUri(TASK_ID),
      stagedWaveformUri: harness.layout.stagingWaveformUri(TASK_ID),
    });

    expect(harness.committedWaveforms).toHaveLength(1);
    expect(harness.committedWaveforms[0]).toMatchObject({
      schemaVersion: 1,
      pointCount: WAVEFORM_POINT_COUNT,
      durationMs: DURATION_MS,
    });
    expect(harness.committedWaveforms[0]?.amplitudes).toHaveLength(WAVEFORM_POINT_COUNT);
    expect(harness.fileSystem.files.has(harness.layout.stagingWaveformUri(TASK_ID))).toBe(false);
    expect(progress.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining(['preparing', 'extracting', 'waveform', 'saving']),
    );
    expect(progress.at(-1)).toMatchObject({
      taskId: TASK_ID,
      phase: 'saving',
      progress: 1,
    });
    expect(harness.activateKeepAwake).toHaveBeenCalledWith(IMPORT_KEEP_AWAKE_TAG);
    expect(harness.deactivateKeepAwake).toHaveBeenCalledWith(IMPORT_KEEP_AWAKE_TAG);
    expect(harness.removeSubscription).toHaveBeenCalledTimes(1);
    expect(harness.cleanupPickedFile).not.toHaveBeenCalled();
    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);
    expect(harness.fileSystem.deletedDirectories).toContain(
      harness.layout.stagingTaskDirectoryUri(TASK_ID),
    );
    expect(harness.coordinator.isImportActive()).toBe(false);
  });

  test('does not commit malformed waveform data and cleans the transaction', async () => {
    const harness = createHarness();
    harness.generateWaveform.mockResolvedValueOnce(
      Array.from({ length: WAVEFORM_POINT_COUNT - 1 }, () => 0.5),
    );
    const selection = await harness.coordinator.selectVideo();

    await expect(
      harness.coordinator.importProject({
        selection: selection!,
        name: 'Practice',
      }),
    ).rejects.toMatchObject<Partial<ImportCoordinatorError>>({
      code: 'E_WAVEFORM_INVALID',
    });

    expect(harness.createProject).not.toHaveBeenCalled();
    expect(harness.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);
    expect(harness.coordinator.isImportActive()).toBe(false);
  });

  test('propagates cancellation, ignores late progress, and never commits', async () => {
    const harness = createHarness();
    const extractionStarted = deferred<void>();
    const extractionResult = deferred<{
      durationMs: number;
      outputBytes: number;
    }>();
    harness.extractAudio.mockImplementationOnce(async () => {
      extractionStarted.resolve(undefined);
      return extractionResult.promise;
    });
    const selection = await harness.coordinator.selectVideo();
    const progress: ImportProgressSnapshot[] = [];
    const importPromise = harness.coordinator.importProject({
      selection: selection!,
      name: 'Practice',
      onProgress: (snapshot) => progress.push(snapshot),
    });

    await extractionStarted.promise;
    await expect(harness.coordinator.cancelActiveImport()).resolves.toBe(true);
    extractionResult.reject(new AppError('E_CANCELLED', 'Native extraction cancelled.'));

    await expect(importPromise).rejects.toMatchObject<Partial<AppError>>({
      code: 'E_CANCELLED',
      shouldAlert: false,
    });
    expect(harness.cancelTask).toHaveBeenCalledWith(TASK_ID);
    expect(harness.createProject).not.toHaveBeenCalled();
    expect(
      harness.fileSystem.directoryExists(harness.layout.pickedSelectionDirectoryUri(SELECTION_ID)),
    ).toBe(false);

    const progressCountAfterFinish = progress.length;
    harness.emitNativeProgress({
      taskId: TASK_ID,
      phase: 'extracting',
      progress: 0.9,
    });
    expect(progress).toHaveLength(progressCountAfterFinish);
    expect(harness.coordinator.isImportActive()).toBe(false);
  });

  test('prevents a second import while native work is active', async () => {
    const harness = createHarness();
    const extractionStarted = deferred<void>();
    const extractionResult = deferred<{
      durationMs: number;
      outputBytes: number;
    }>();
    harness.extractAudio.mockImplementationOnce(async () => {
      extractionStarted.resolve(undefined);
      return extractionResult.promise;
    });
    const selection = await harness.coordinator.selectVideo();
    const firstImport = harness.coordinator.importProject({
      selection: selection!,
      name: 'First',
    });
    await extractionStarted.promise;

    await expect(
      harness.coordinator.importProject({
        selection: selection!,
        name: 'Second',
      }),
    ).rejects.toMatchObject<Partial<ImportCoordinatorError>>({
      code: 'E_IMPORT_IN_PROGRESS',
    });

    await harness.coordinator.cancelActiveImport();
    extractionResult.reject(new AppError('E_CANCELLED', 'Native extraction cancelled.'));
    await expect(firstImport).rejects.toMatchObject({ code: 'E_CANCELLED' });
  });
});
