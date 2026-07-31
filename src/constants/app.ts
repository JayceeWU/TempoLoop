export const APP_NAME = 'TempoLoop' as const;
export const APP_SLUG = 'tempo-loop' as const;
export const APP_SCHEME = 'tempoloop' as const;
export const IOS_BUNDLE_IDENTIFIER = 'com.jipeng.tempoloop' as const;

export const APP_STORAGE_DIRECTORY = 'TempoLoop' as const;
export const PROJECTS_DIRECTORY_NAME = 'Projects' as const;
export const STAGING_DIRECTORY_NAME = 'Staging' as const;
export const PROJECT_INDEX_FILE_NAME = 'projects.json' as const;
export const AUDIO_FILE_NAME = 'audio.m4a' as const;
export const WAVEFORM_FILE_NAME = 'waveform.json' as const;

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const WAVEFORM_SCHEMA_VERSION = 1 as const;
export const SEGMENT_COUNT = 6 as const;
export const WAVEFORM_POINT_COUNT = 2_048 as const;
export const LEAD_IN_MS = 6_000 as const;

export const MAX_PROJECT_NAME_LENGTH = 80 as const;
export const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
export const MIN_FREE_SPACE_AFTER_PICK_BYTES = 1024 * 1024 * 1024;
