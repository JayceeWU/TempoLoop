export const APP_NAME = 'TempoLoop' as const;
export const APP_SLUG = 'tempoloop' as const;
export const APP_SCHEME = 'tempoloop' as const;
export const APP_VERSION = '1.0.0' as const;
export const ANDROID_PACKAGE_ID = 'com.tempoloop.app' as const;

export const APP_STORAGE_DIRECTORY = 'TempoLoop' as const;
export const PROJECTS_DIRECTORY_NAME = 'projects' as const;
export const IMPORTS_DIRECTORY_NAME = 'imports' as const;
export const IMPORT_DIRECTORY_PREFIX = '.import-' as const;
export const PROJECT_METADATA_FILE_NAME = 'project.json' as const;
export const AUDIO_FILE_NAME = 'audio.m4a' as const;
export const PARTIAL_AUDIO_FILE_NAME = 'audio.m4a.partial' as const;
export const WAVEFORM_FILE_NAME = 'waveform.json' as const;

export const PROJECT_SCHEMA_VERSION = 2 as const;
export const WAVEFORM_SCHEMA_VERSION = 1 as const;
export const PRACTICE_START_COUNT = 6 as const;
export const PRACTICE_RANGE_COUNT = 12 as const;
export const LEGACY_SEGMENT_COUNT = 9 as const;
export const WAVEFORM_POINT_COUNT = 2_048 as const;
export const DEFAULT_LEAD_IN_MS = 6_000 as const;

export const MAX_PROJECT_NAME_LENGTH = 80 as const;
export const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
export const MIN_FREE_SPACE_AFTER_PICK_BYTES = 1024 * 1024 * 1024;
