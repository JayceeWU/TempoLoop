# TempoLoop Android - Codex Implementation Specification

**Document status:** implementation contract for version 1  
**Target platform:** Android only  
**Development computer:** Windows  
**Application name:** TempoLoop  
**Expo slug:** `tempoloop`  
**Android application ID:** `com.tempoloop.app`  
**Primary goal:** stable, offline dance-music practice on one personal Android phone  
**Maximum tested source-video size:** 600 MiB (`629145600` bytes)

---
## 0. Instructions for Codex

Read this specification completely before changing any repository file. Treat every statement marked **Required** as a version 1 contract.

TempoLoop is a React Native application, not a pure Kotlin application. Keep responsibilities separated as follows:

1. React Native, Expo, and TypeScript own all screens, navigation, Project data, segment validation, import orchestration, and waveform drawing.
2. `expo-audio` owns audio loading, play, pause, seek, playback rate, pitch correction, status reporting, audio focus, and device-output changes.
3. One small local Kotlin Expo Module named `TempoLoopMedia` owns only source-video inspection, audio-only export, static full-track waveform generation, progress, cancellation, and cleanup.
4. Do not create a custom Kotlin player unless physical-device tests prove that JavaScript-controlled segment stopping cannot meet the acceptance threshold. Any optional native boundary guard must be isolated and added only after measurements are recorded.

Do not replace this design with Expo Go, a browser/PWA, FFmpeg, WebAssembly media processing, a server, Base64 media transfer, or a pure Kotlin UI.

Use Expo SDK 57 and its compatible package versions. Install Expo packages with `npx expo install`. Use TypeScript strict mode. Use the React Native New Architecture required by the selected Expo SDK.

The selected video can be close to 600 MiB. The JavaScript layer may pass only URIs, IDs, paths, integer timestamps, progress values, and small metadata objects. Never pass video bytes, audio bytes, PCM buffers, Base64, or a full media `ArrayBuffer` through the React Native boundary.

Create and maintain `IMPLEMENTATION_STATUS.md`:

```md
# TempoLoop implementation status

- [ ] Phase 1 - Project shell, domain model, and storage
- [ ] Phase 2 - TempoLoopMedia module and video inspection
- [ ] Phase 3 - Audio export and static waveform
- [ ] Phase 4 - Import transaction and Project list
- [ ] Phase 5 - Segment editor
- [ ] Phase 6 - expo-audio practice player
- [ ] Phase 7 - hardening, tests, and EAS APK profiles
```

For every phase:

1. Inspect the repository before editing.
2. Keep the repository buildable after each logical change.
3. Run `npm run typecheck`, `npm run lint`, and `npm test`.
4. Run `npx expo-doctor@latest` after dependency or native-configuration changes.
5. Do not leave fake implementations, hidden fallback behavior, unresolved `TODO` comments, or success paths backed by mock media.
6. Record any unavoidable API adjustment in `IMPLEMENTATION_NOTES.md`.
7. Do not claim a native feature works until an EAS Development APK compiles and the behavior is tested on a physical Android phone.

---
## 1. Product definition

TempoLoop converts the audio track of one user-selected video into a local dance-practice project. A project stores only an extracted audio file, project metadata, a cached waveform, and six independently configured practice segments. TempoLoop must not retain or display the original video after import completes.

A user opens a project, selects one of four playback speeds, selects one configured segment, and presses a large play button. Practice playback begins six source-audio seconds before the configured segment start and stops at the configured segment end. Different segments may overlap.

The installed standalone application must work in airplane mode. All user projects remain inside the application-private storage directory. Version 1 has no account, sync, server, or external database.

### 1.1 Required user features

1. Select exactly one local video through the Android system document picker.
2. Accept common local gallery videos up to 600 MiB.
3. Reject a source larger than 600 MiB before starting media export whenever the provider reports a reliable size.
4. Reject a source without an audio track.
5. Extract only the audio and save it as a local audio-only MP4/M4A file.
6. Let the user name the new project before import begins.
7. Show an import progress interface with inspect, export, waveform, and finalize stages.
8. Let the user cancel an active import.
9. Display four large speed buttons in one row: `1.0x`, `0.9x`, `0.8x`, and `0.7x`.
10. Display six segment buttons in a three-row, two-column grid.
11. Disable and gray out a segment button until both endpoints are valid.
12. Place a settings button beside the project title.
13. Open a segment editor from the settings button.
14. Display full-song waveform data, current time, total duration, a playback cursor, and a play/pause control in the segment editor.
15. Allow waveform tap and drag seeking.
16. Let the user set any segment start or end to the exact current source-audio position while playback is running or paused.
17. Initialize every endpoint as unset and display unset endpoints as `--:--`.
18. Permit overlapping segment ranges.
19. Save editor changes only when each segment is either fully unset or has a valid start and a valid end.
20. Discard the editor draft if the user exits without a valid save.
21. Play the selected segment at the selected speed.
22. Compute the practice playback start as `max(0, segmentStartMs - 6000)`.
23. Stop practice playback at `segmentEndMs`.
24. Keep pitch at `1.0` while changing speed.
25. At segment completion, stop and reset the player to the segment's six-second lead-in position so the next play press restarts the practice range.
26. Store all data locally.
27. Delete all media and metadata belonging to a project when the user confirms project deletion.
28. Recover cleanly from interrupted imports without showing a broken project.
29. Work with no network after the standalone APK is installed.
30. Avoid memory failures with a selected video near 600 MiB.

### 1.2 Resolved requirement conflict

The original product notes state that every project has six segments, but one later sentence mentions four segment rows in the editor. Implement six segments everywhere.

The main project screen must use three rows with two segment buttons per row. The editor must show six segment entries.

### 1.3 Version 1 exclusions

Do not add the following features in version 1:

- User accounts.
- Cloud synchronization.
- Cloud backup.
- Original-video playback.
- Camera recording.
- Social sharing.
- Collaboration.
- Subscriptions.
- Advertisements.
- Google Play Store publication.
- iOS support.
- Automatic beat detection.
- Automatic choreography detection.
- Tempo estimation.
- Background playback.
- Lock-screen media controls.
- Foreground media service.
- Continuous automatic looping without another play press.
- Wear OS support.
- DRM-protected music-library import.
- Network media URLs.
- EAS Update in the default offline configuration.

---
## 2. System constraints and quality targets

### 2.1 Required media rules

- Treat every selected Android URI as opaque. A `content://` URI is not a normal filesystem path.
- Select videos with `expo-document-picker` and set `copyToCacheDirectory: false` to avoid a second full-size copy of a large source video.
- Pass the original picked URI directly to `TempoLoopMedia`.
- Kotlin must read the URI through `ContentResolver` or a compatible Media3 data source.
- Never load the full source video or exported audio into RAM.
- Never use Base64 for media.
- Never parse MP4/MOV containers in JavaScript.
- Never copy the source video into the Project directory.
- Decode waveform PCM in bounded native buffers.
- Return a fixed-size waveform array, normally 2,048 normalized values.
- Permit only one active import operation.
- Use one logical `expo-audio` player for the active Project screen.
- Delete all partial output after cancellation or failure.
- Validate deletion paths before recursive deletion. Never delete a picked user-gallery URI.

### 2.2 Stability targets

- The Project list remains responsive during import.
- A video near 600 MiB must be streamed rather than copied into JavaScript memory.
- Prepared local audio normally begins within 300 ms of pressing Play on a recent mid-range phone.
- Segment-end overshoot should normally be below 100 ms. Measure it on physical hardware.
- Rapid segment, rate, and play/pause commands must not revive an obsolete seek or play command.
- All listeners, timers, native jobs, and audio players have explicit cleanup paths.
- A canceled or failed import never appears as a valid Project.
- A Preview APK works in airplane mode.

### 2.3 Platform targets

- Android only.
- Minimum Android version follows Expo SDK 57 support: Android 7.0 or later.
- Compile and target SDK follow Expo SDK 57 defaults.
- Portrait orientation.
- Phone layout first.
- Final media testing must use a physical Android phone.

### 2.4 Privacy and offline rules

- No account, server, analytics, advertisements, crash upload, cloud storage, or remote configuration.
- No broad storage permission when the system picker is sufficient.
- No camera or microphone permission.
- Configure `expo-audio` with Android recording disabled and background playback disabled.
- Development builds may connect to Metro. Product functions in the Preview APK must not require a network.

---
## 3. Architecture and ownership

```text
React Native screens and components
        |
        v
TypeScript domain stores and coordinators
        |                         \
        v                          v
ProjectRepository             expo-audio
(JSON + private files)        native ExoPlayer playback
        |
        v
TempoLoopMedia TypeScript wrapper
        |
        v
Small Kotlin local Expo Module
  - inspect content URI
  - export audio only
  - decode static waveform
  - progress / cancel / cleanup
```

### 3.1 React Native and TypeScript own

- Expo Router navigation.
- Project naming, list, delete, and optional rename.
- Six-segment draft editing and validation.
- Four playback-rate buttons.
- Lead-in calculation.
- Practice and editor screen state.
- `expo-audio` player creation and command ordering.
- Static waveform drawing and gesture mapping.
- Project JSON and Project directory lifecycle.
- User-facing errors.

### 3.2 `expo-audio` owns

- Native audio decoding and buffering.
- Play, pause, seek, current position, and duration.
- Playback rates `1.0`, `0.9`, `0.8`, and `0.7`.
- Pitch correction while rate changes.
- Audio focus and stopping on noisy output changes.
- Native player resource lifetime through its supported API.

Do not reimplement these functions in Kotlin.

### 3.3 `TempoLoopMedia` Kotlin module owns

- Opening `content://` and `file://` source URIs.
- Reliable source-size checks when metadata is available.
- Detecting an audio track and reading duration/format metadata.
- Checking writable storage before export.
- Removing the video track and writing a local audio-only M4A/MP4 file.
- Using Media3 Transformer for export, with transmux when compatible and AAC output when transcoding is needed.
- Decoding the exported audio to PCM in bounded buffers.
- Reducing PCM into 2,048 full-track waveform bins.
- Reporting import stage and progress events.
- Canceling and releasing Transformer/codec work.
- Deleting partial native output on terminal failure.

The module must not expose playback methods in version 1.

### 3.4 Storage ownership

TypeScript defines the directory schema and writes JSON. Kotlin receives explicit application-private output paths and may write only the requested temporary or final media files. Kotlin must reject output paths outside the application-private document directory.

---
## 4. Technology stack

| Area | Required technology |
|---|---|
| Framework | React Native with Expo SDK 57 |
| React Native | Version supplied by Expo SDK 57 |
| Language | TypeScript, strict mode |
| Routing | Expo Router |
| Development client | `expo-dev-client` |
| Video selection | `expo-document-picker` with `copyToCacheDirectory: false` |
| Playback | `expo-audio` |
| Private file storage | `expo-file-system` modern `File`, `Directory`, and `Paths` APIs |
| Keep screen awake | `expo-keep-awake` during import and active practice |
| IDs | `expo-crypto` UUIDs |
| Waveform rendering | `react-native-svg`, one compact path or mirrored pair |
| State | Zustand |
| Runtime validation | Zod |
| Native media module | Kotlin with Expo Modules API |
| Audio export | Jetpack Media3 Transformer |
| Waveform decode | Android `MediaExtractor` and `MediaCodec` |
| Native URI inspection | `ContentResolver`, `OpenableColumns`, `MediaExtractor` |
| TypeScript tests | Jest, `jest-expo`, React Native Testing Library |
| Kotlin tests | JUnit plus focused Android instrumentation tests |
| Cloud APK build | EAS Build |

Do not use `expo-av`; it is deprecated for new Expo audio work. Do not add a second ExoPlayer dependency for playback. `expo-audio` already supplies native Android playback.

The local Kotlin module needs Media3 Transformer. All Media3 artifacts resolved in the Android build must use one version. Match the Media3 version used by the installed `expo-audio` package rather than hardcoding an unrelated newer version. Add a Gradle dependency-resolution test or task that fails when multiple Media3 versions are resolved.

Do not use FFmpeg in version 1.

---
## 5. Initial project creation

Use Windows PowerShell:

```powershell
npx create-expo-app@latest tempoloop --template default@sdk-57
cd tempoloop

npx expo install expo-dev-client expo-audio expo-document-picker expo-file-system expo-keep-awake expo-crypto react-native-svg
npm install zustand zod
npm install --save-dev jest-expo @testing-library/react-native @types/jest prettier

npx create-expo-module@latest --local
```

For the local module use:

- Folder: `tempoloop-media`
- Module name: `TempoLoopMedia`
- Android namespace: `expo.modules.tempoloopmedia`
- Android implementation only for version 1

Delete generated iOS implementation files if the generator creates them. Keep `expo-module.config.json` limited to Android.

Do not use Expo Go. A local Kotlin module requires a Development Build.

After installation:

```powershell
npx expo-doctor@latest
npx tsc --noEmit
```

---
## 6. Application and EAS configuration

Create `app.config.ts`:

```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TempoLoop',
  slug: 'tempoloop',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'tempoloop',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  android: {
    package: 'com.tempoloop.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#120A24',
    },
  },
  plugins: [
    'expo-router',
    'expo-document-picker',
    [
      'expo-audio',
      {
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
  ],
  experiments: { typedRoutes: true },
});
```

Required configuration rules:

- Keep `com.tempoloop.app` unchanged after real Projects exist.
- Do not request camera, microphone, all-files, or broad media-library permission.
- Do not enable background playback or recording.
- Do not disable the React Native New Architecture.
- Do not configure a Google Play production profile.

Create `eas.json`:

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "autoIncrement": true,
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "autoIncrement": true,
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

Meanings:

- `development`: Development APK that loads JavaScript from Metro and includes developer tools.
- `preview`: self-contained APK with the JavaScript bundle included; it must work without Metro and in airplane mode.
- Remote version source plus auto increment gives each new APK a newer Android `versionCode`, supporting clean update installs.

Add package scripts:

```json
{
  "scripts": {
    "start": "expo start --dev-client",
    "typecheck": "tsc --noEmit",
    "lint": "expo lint",
    "test": "jest --runInBand",
    "doctor": "expo-doctor"
  }
}
```

---
## 7. Required repository layout

```text
tempoloop/
├── app/
│   ├── _layout.tsx
│   ├── index.tsx
│   └── project/
│       └── [projectId]/
│           ├── index.tsx
│           └── segments.tsx
├── src/
│   ├── components/
│   │   ├── AppButton.tsx
│   │   ├── EmptyProjectState.tsx
│   │   ├── ImportProgressSheet.tsx
│   │   ├── PlaybackButton.tsx
│   │   ├── ProjectCard.tsx
│   │   ├── SegmentButton.tsx
│   │   ├── SegmentGrid.tsx
│   │   ├── SegmentTimeRow.tsx
│   │   ├── SpeedSelector.tsx
│   │   └── WaveformScrubber.tsx
│   ├── constants/
│   │   ├── app.ts
│   │   ├── copy.ts
│   │   └── theme.ts
│   ├── domain/
│   │   ├── project.ts
│   │   ├── segment.ts
│   │   ├── playback.ts
│   │   ├── import.ts
│   │   ├── errors.ts
│   │   └── validation.ts
│   ├── playback/
│   │   ├── AudioPlayerProvider.tsx
│   │   ├── PlaybackCoordinator.ts
│   │   ├── SegmentEndGuard.ts
│   │   └── useTempoLoopPlayer.ts
│   ├── repositories/
│   │   └── ProjectRepository.ts
│   ├── services/
│   │   ├── ImportCoordinator.ts
│   │   ├── NativeMediaService.ts
│   │   ├── StorageLayout.ts
│   │   └── RecoveryService.ts
│   ├── stores/
│   │   ├── useProjectStore.ts
│   │   └── useImportStore.ts
│   └── utils/
│       ├── atomicJson.ts
│       ├── formatTime.ts
│       ├── pathSafety.ts
│       └── throttle.ts
├── modules/
│   └── tempoloop-media/
│       ├── android/
│       │   ├── build.gradle
│       │   └── src/
│       │       ├── main/java/expo/modules/tempoloopmedia/
│       │       │   ├── TempoLoopMediaModule.kt
│       │       │   ├── TempoLoopMediaErrors.kt
│       │       │   ├── TempoLoopMediaRecords.kt
│       │       │   ├── MediaImportController.kt
│       │       │   ├── VideoInspector.kt
│       │       │   ├── AudioExportController.kt
│       │       │   ├── WaveformGenerator.kt
│       │       │   └── SafePathValidator.kt
│       │       └── test/java/expo/modules/tempoloopmedia/
│       │           ├── WaveformReducerTest.kt
│       │           └── SafePathValidatorTest.kt
│       ├── src/
│       │   ├── TempoLoopMediaModule.ts
│       │   ├── TempoLoopMedia.types.ts
│       │   └── index.ts
│       └── expo-module.config.json
├── __tests__/
│   ├── segmentValidation.test.ts
│   ├── playbackRange.test.ts
│   ├── segmentEndGuard.test.ts
│   ├── projectRepository.test.ts
│   ├── formatTime.test.ts
│   └── ImportCoordinator.test.ts
├── app.config.ts
├── eas.json
├── IMPLEMENTATION_NOTES.md
├── IMPLEMENTATION_STATUS.md
├── README.md
└── package.json
```

Do not add a custom config plugin unless autolinking and the local module Gradle file cannot express a required configuration.

---
## 8. Domain model

Use integer milliseconds for every persisted timestamp and every TypeScript/Kotlin contract timestamp. Do not persist floating-point seconds.

### 8.1 Playback rate

```ts
export const PLAYBACK_RATES = [1, 0.9, 0.8, 0.7] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
```

### 8.2 Segment model

```ts
export interface DanceSegment {
  id: string;
  index: 0 | 1 | 2 | 3 | 4 | 5;
  startMs: number | null;
  endMs: number | null;
}
```

A segment is configured only when both endpoints are present and valid.

```ts
export function isConfiguredSegment(
  segment: DanceSegment,
  durationMs: number,
): boolean {
  return (
    Number.isInteger(segment.startMs) &&
    Number.isInteger(segment.endMs) &&
    segment.startMs !== null &&
    segment.endMs !== null &&
    segment.startMs >= 0 &&
    segment.startMs < segment.endMs &&
    segment.endMs <= durationMs
  );
}
```

### 8.3 Project model

```ts
export interface DanceProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  audioFileName: 'audio.m4a';
  waveformFileName: 'waveform.json';
  durationMs: number;
  sourceDisplayName: string | null;
  sourceSizeBytes: number | null;
  selectedRate: PlaybackRate;
  segments: [
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
  ];
}
```

### 8.4 Waveform model

```ts
export interface StoredWaveform {
  schemaVersion: 1;
  durationMs: number;
  sampleCount: 2048;
  samples: number[];
}
```

Every waveform sample must be finite and inside `[0, 1]`.

### 8.5 Playback state

```ts
export type PlaybackMode = 'idle' | 'editor' | 'practice';
export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlaybackSnapshot {
  mode: PlaybackMode;
  status: PlaybackStatus;
  projectId: string | null;
  segmentIndex: number | null;
  sourcePositionMs: number;
  sourceDurationMs: number;
  clipStartMs: number;
  clipEndMs: number | null;
  rate: PlaybackRate;
  commandGeneration: number;
}
```

---
## 9. Segment validation and save rules

Every segment must be in exactly one valid state.

### 9.1 Fully unset

```text
startMs = null
endMs   = null
```

A fully unset segment is valid and remains disabled on the project screen.

### 9.2 Fully configured

```text
0 <= startMs < endMs <= durationMs
```

### 9.3 Invalid states

Reject save when any segment has one of the following states:

- Start set and end unset.
- Start unset and end set.
- Start equal to end.
- Start after end.
- Start below zero.
- End after the audio duration.
- Non-integer timestamps.
- Non-finite timestamps.

The editor must keep changes in a draft object. The persisted project must not change until validation succeeds and the user presses Save.

When the user presses the system back button or Cancel with a dirty draft:

1. Show a discard confirmation.
2. Discard the complete draft if confirmed.
3. Keep the persisted project unchanged.

When the user presses Save with an invalid draft:

1. Do not exit.
2. Highlight the first invalid segment.
3. Show a concise error.
4. Do not write a partial project.

Overlapping configured segments are valid.

---
## 10. Time formatting

Persist milliseconds and display tenths of a second in the editor.

Examples:

```text
0 ms      -> 00:00.0
63200 ms  -> 01:03.2
372500 ms -> 06:12.5
null      -> --:--
```

Use a pure formatting function with unit tests.

```ts
export function formatTimeMs(value: number | null): string {
  if (value === null) return '--:--';
  const safe = Math.max(0, Math.round(value));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const tenths = Math.floor((safe % 1_000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
```

The main project screen may omit tenths when showing a compact range label, but the editor must show tenths.

---
## 11. Local storage design

Use the Expo document directory because projects must survive application restarts and cache cleanup.

```text
<Paths.document>/TempoLoop/
├─ projects/
│  ├─ <project-id>/
│  │  ├─ project.json
│  │  ├─ audio.m4a
│  │  └─ waveform.json
│  └─ ...
└─ imports/
   └─ .import-<project-id>/
      ├─ audio.m4a.partial
      └─ import.json
```

### 11.1 Project discovery

Do not maintain a separate global index in version 1. On launch:

1. List direct children of `projects/`.
2. Read each `project.json`.
3. Validate with Zod.
4. Ignore and report corrupt entries rather than crashing.
5. Sort valid projects by `updatedAtIso` descending.

A directory scan is acceptable because this is a single-user app with a small project count.

### 11.2 Atomic JSON writing

Write JSON through a temporary sibling.

```text
project.json.tmp
   -> flush/close
   -> rename over project.json
```

Never overwrite the only valid JSON file directly.

### 11.3 Atomic project creation

The import coordinator must use the following transaction:

1. Create `.import-<id>/` under `imports/`.
2. Ask Kotlin to inspect the source URI.
3. Ask Kotlin to export to `audio.m4a.partial`.
4. Ask Kotlin to generate 2,048 waveform values.
5. Validate duration and waveform.
6. Rename `audio.m4a.partial` to `audio.m4a` inside the temporary directory.
7. Write `waveform.json` atomically.
8. Write `project.json` atomically.
9. Rename the complete temporary directory to `projects/<id>/`.
10. Refresh the project store.

If any step fails, delete only the temporary import directory.

### 11.4 Launch recovery

On launch, `RecoveryService` must:

- Remove `.import-*` directories older than one hour.
- Remove `.tmp` JSON files that have a valid non-temporary sibling.
- Leave recent import directories alone until the application confirms no import is active.
- Never delete a finalized project merely because a waveform file is unreadable. Mark the project as needing repair and offer deletion.

### 11.5 Path safety

Before native code writes or deletes a file:

1. Canonicalize the target path.
2. Confirm the target is inside the application files or document directory.
3. Reject `..`, symlink escapes, and output paths equal to a source gallery path.
4. Never delete a `content://` source.
5. Delete a `file://` picker cache file only when its canonical path is inside the application's cache directory.

---
## 12. Video selection flow

Use `expo-document-picker`, not `expo-image-picker`, because the selected source may approach 600 MiB and must not be copied into the Expo cache before native processing.

```ts
import * as DocumentPicker from 'expo-document-picker';

const result = await DocumentPicker.getDocumentAsync({
  type: 'video/*',
  multiple: false,
  copyToCacheDirectory: false,
});

if (result.canceled) return;
const asset = result.assets[0];
```

### 12.1 Required picker behavior

- Use exactly one selected asset.
- Pass `asset.uri` directly to `TempoLoopMedia`.
- Treat `asset.size` and `asset.mimeType` as hints, not trusted final validation.
- Do not try to read the returned URI with JavaScript.
- Do not convert the URI to a filesystem path.
- The Project name is entered and validated before starting native work.
- Disable the import button while an import is active.

### 12.2 Name validation

- Trim leading and trailing whitespace.
- Require 1-80 Unicode characters after trimming.
- Permit duplicate Project names because Project identity uses UUIDs.
- Reject control characters and path separators used only for unsafe filenames.
- Never derive a directory name from the Project name.

### 12.3 Source validation

Perform quick TypeScript validation when metadata exists, then perform authoritative Kotlin inspection:

- Source URI can be opened.
- Source is not larger than 600 MiB when a reliable size is known.
- At least one audio track exists.
- Duration is finite and greater than zero.
- The source is not DRM protected.

### 12.4 Activity recreation

Do not store a picked URI only in a component-local closure. Persist the active import operation ID and source metadata in the import store before starting Kotlin work. On a fresh app launch, delete any incomplete Project directory rather than pretending the external URI is still valid.

---
## 13. `TempoLoopMedia` TypeScript contract

Expose one narrow media-import API. Do not expose playback methods.

```ts
export type ImportStage =
  | 'inspecting'
  | 'exporting'
  | 'waveform'
  | 'finalizing';

export interface InspectVideoOptions {
  sourceUri: string;
  maxSourceBytes: number;
}

export interface VideoInspection {
  sourceSizeBytes: number | null;
  durationMs: number;
  audioMimeType: string | null;
  sampleRate: number | null;
  channelCount: number | null;
}

export interface ImportMediaOptions {
  operationId: string;
  sourceUri: string;
  outputAudioUri: string;
  waveformBinCount: number;
  maxSourceBytes: number;
}

export interface ImportMediaResult {
  audioUri: string;
  audioSizeBytes: number;
  durationMs: number;
  waveform: number[];
}

export interface ImportProgressEvent {
  operationId: string;
  stage: ImportStage;
  stageProgress: number | null;
  overallProgress: number | null;
}

export interface TempoLoopMediaApi {
  inspectVideo(options: InspectVideoOptions): Promise<VideoInspection>;
  importProjectMedia(options: ImportMediaOptions): Promise<ImportMediaResult>;
  cancelImport(operationId: string): Promise<void>;
}
```

Contract rules:

- All times are integer milliseconds.
- Waveform values are finite numbers in `[0, 1]`.
- `waveform.length` equals the requested bin count.
- Errors have stable machine-readable codes.
- Native stack traces are never used as user-facing text.
- Progress events are throttled; do not emit for every sample or buffer.

---
## 14. Kotlin module registration and dependencies

Use Expo Modules API:

```kotlin
class TempoLoopMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TempoLoopMedia")

    Events("onImportProgress")

    AsyncFunction("inspectVideo") { options: InspectVideoOptions ->
      // Return VideoInspection.
    }

    AsyncFunction("importProjectMedia") { options: ImportMediaOptions ->
      // Export audio and generate waveform.
    }

    AsyncFunction("cancelImport") { operationId: String ->
      // Idempotent cancellation.
    }

    OnDestroy {
      // Cancel jobs and release Transformer/codec resources.
    }
  }
}
```

### 14.1 Media3 version alignment

`expo-audio` already brings Media3 playback dependencies. The local module adds only the Media3 components needed for Transformer. Resolve the exact Media3 version from the installed Expo SDK 57 dependency graph and use the same version for every artifact.

Required build check:

```text
./gradlew :app:dependencies
```

The resolved tree must not contain two different versions of `androidx.media3` modules.

### 14.2 Thread rules

- Module promises must never block the main thread with media I/O.
- ContentResolver inspection, Transformer waiting, and PCM decode run on controlled background dispatchers.
- Progress events are emitted safely through Expo Modules API.
- Cancellation checks occur between meaningful native operations and decoder buffers.
- Resource release is idempotent.

---
## 15. Native video inspection

### 15.1 Size lookup

Try, in order:

1. `ContentResolver.query(uri, [OpenableColumns.SIZE], ...)`.
2. `AssetFileDescriptor.length` when nonnegative.
3. `ParcelFileDescriptor.statSize` when nonnegative.

If no reliable size is available, return `null` and enforce the limit while reading/exporting. Never report an unknown size as zero.

Reject a reliable size greater than `629145600` bytes with `E_VIDEO_TOO_LARGE` before export.

### 15.2 Track inspection

Use `MediaExtractor.setDataSource(context, uri, null)` or a compatible Media3 source. Iterate tracks and find the first audio MIME type beginning with `audio/`.

Return:

- duration in milliseconds;
- audio MIME type;
- sample rate when present;
- channel count when present;
- reliable source size or `null`.

Reject:

- no audio track;
- invalid or zero duration;
- unreadable URI;
- protected/unsupported media.

Always release `MediaExtractor`, descriptors, and cursors in `finally` or `use` blocks.

### 15.3 Storage check

Before export, check free space in the application-private volume. Require a conservative amount based on reported source size, expected audio output, and temporary overhead. Do not require space for a second full video copy because no source copy is made.

---
## 16. Audio-only export

Use Jetpack Media3 Transformer as the primary path.

Required intent:

```kotlin
val edited = EditedMediaItem.Builder(MediaItem.fromUri(sourceUri))
  .setRemoveVideo(true)
  .build()

val transformer = Transformer.Builder(context)
  .setAudioMimeType(MimeTypes.AUDIO_AAC)
  .addListener(listener)
  .build()

transformer.start(edited, outputPath)
```

Adapt exact method signatures to the installed Media3 version while preserving behavior.

### 16.1 Export requirements

- Remove the video track.
- Keep only audio.
- Write to an application-private temporary sibling, such as `audio.m4a.partial`.
- Prefer transmux when source audio is already compatible.
- Transcode to AAC only when needed.
- Do not decode the video track.
- Validate that the output exists, is nonempty, has positive duration, and can be loaded by `expo-audio`.
- Rename/move the partial file to `audio.m4a` only after export and waveform generation succeed.

### 16.2 Import state machine

```text
idle
 -> inspecting
 -> exporting
 -> waveform
 -> finalizing
 -> completed
```

Terminal states:

```text
failed
cancelled
```

Only one operation may be active. A second request receives `E_IMPORT_BUSY`.

### 16.3 Progress

- Inspection may be indeterminate.
- Transformer progress maps into the export stage.
- Waveform progress maps from decoded presentation time over duration.
- Overall progress must be monotonic.
- Throttle events to about 5-10 per second.

### 16.4 Cancellation

`cancelImport(operationId)` is idempotent. It must:

1. mark the operation canceled;
2. cancel Transformer and decoder work;
3. release native resources;
4. delete partial output;
5. reject the active promise with `E_IMPORT_CANCELLED`.

---
## 17. Static full-track waveform generation

The segment editor needs the complete waveform before the user listens through the song. Do not use `expo-audio` real-time sample callbacks for this feature.

### 17.1 Decoder pipeline

```text
audio.m4a.partial
 -> MediaExtractor selects audio track
 -> MediaCodec decodes bounded output buffers
 -> PCM samples converted to absolute amplitude or RMS
 -> samples assigned by presentation time to 2,048 bins
 -> robust normalization to [0, 1]
```

### 17.2 Bin mapping

For decoded sample time `timeUs`, total duration `durationUs`, and bin count `N`:

```text
index = clamp(floor(timeUs / durationUs * N), 0, N - 1)
```

Each bin stores a peak or RMS summary. Fill empty bins using local interpolation or the nearest valid value; never return `NaN`.

### 17.3 Normalization

- Remove DC bias per buffer when practical.
- Use a robust high percentile rather than a single extreme sample for scaling.
- Clamp every result to `[0, 1]`.
- Preserve silence as values near zero.
- Return exactly 2,048 bins unless a different requested count is explicitly provided.

### 17.4 Memory and cancellation

- Do not retain full PCM.
- Hold only decoder buffers and the output accumulator.
- Check cancellation every decoder iteration.
- Release `MediaExtractor` and `MediaCodec` on success, failure, and cancellation.

### 17.5 Acceptance

- The waveform spans the whole duration.
- Repeated generation is deterministic within floating-point tolerance.
- Very quiet and silent files do not produce invalid values.
- Long audio does not cause memory growth proportional to duration.

---
## 18. Playback with `expo-audio`

Use `expo-audio` for all playback. Do not add a custom Kotlin player in version 1.

### 18.1 Player ownership

Create one player owner above the Project practice and segment-editor routes. Use `useAudioPlayer` or the supported non-hook API in one focused provider. Replace the source when the active Project changes and release the player when the provider is destroyed.

Use `useAudioPlayerStatus` or the current SDK status listener as the source of truth for:

- `playing`;
- `currentTime`;
- `duration`;
- `isLoaded`;
- `didJustFinish` when available.

Set a status update interval around 50 ms while accurate segment guarding is active. Avoid pushing every update into a global store; isolate high-frequency state near the player and waveform cursor.

### 18.2 Initial player configuration

```ts
player.shouldCorrectPitch = true;
player.playbackRate = selectedRate;
```

Configure Expo audio mode for normal foreground playback. Background playback is disabled. Pause on screen exit and AppState background transition.

### 18.3 Editor mode

- Load the full local `audio.m4a`.
- Force playback rate to `1.0` for accurate timestamp capture.
- Permit play, pause, and seek across the full duration.
- Waveform taps and drags call `seekTo(seconds)` through a throttled coordinator.
- The displayed cursor uses `status.currentTime` converted to integer milliseconds.
- `Set current` captures the latest source-audio time, clamps it to `[0, durationMs]`, and stores an integer millisecond value in the draft.

### 18.4 Practice mode

For a configured segment:

```ts
const replayStartMs = Math.max(0, segment.startMs - 6000);
const replayEndMs = segment.endMs;
```

Preparation:

1. increment a command generation token;
2. pause the player;
3. set pitch correction and selected rate;
4. seek to `replayStartMs / 1000`;
5. mark ready only if the token is still current.

Play behavior:

- Ready or ended: seek to replay start if needed, then play.
- Paused inside the active range: resume without seeking.
- Playing: pause.
- Selecting another segment cancels prior pending commands and prepares the new range without auto-playing.
- Changing rate during playback updates `player.playbackRate` without seeking.

### 18.5 Segment end guard

Implement `SegmentEndGuard` in TypeScript first.

On every player status update:

```ts
if (
  mode === 'practice' &&
  status.playing &&
  currentMs >= segmentEndMs - END_GUARD_MS
) {
  player.pause();
  void guardedSeekTo(replayStartMs);
  setPracticeState('ready');
}
```

Start with `END_GUARD_MS = 30` and measure audible overshoot. The guard must be idempotent and protected by the command generation token.

Do not use a standalone `setInterval` as the only time source. Use the native status stream plus one optional short deadline timer as a fallback. Clear every timer when the segment, Project, mode, or screen changes.

If physical-device tests cannot keep overshoot below 100 ms under normal UI load, record measurements in `IMPLEMENTATION_NOTES.md` and add only a small native boundary guard. Do not move general playback into Kotlin.

### 18.6 Command generation

Every asynchronous seek/play preparation captures an integer generation value. A newer user action increments the generation. Old completions must exit without playing or changing UI state.

Cover these races in tests:

- select segment A, then B before A seek completes;
- press Play twice quickly;
- change Project during a seek;
- leave screen during preparation;
- automatic end seek races with manual segment selection.

### 18.7 Playback reset

After automatic segment completion:

- pause;
- seek to the lead-in start;
- show Play rather than Pause;
- keep the same segment and rate selected;
- next Play repeats the range.

---
## 19. Playback lifecycle and cleanup

- Pause when the Project practice screen or editor loses focus.
- Pause when the app enters the background.
- Do not resume automatically after backgrounding, phone calls, or route changes.
- Remove status subscriptions during unmount or source replacement.
- Clear segment guard timers on every mode/source change.
- Release the player through the `expo-audio` supported cleanup API when the provider is destroyed.
- Never keep two players audible.
- Do not store a player object in persisted Zustand state.
- A missing Project audio file produces `E_AUDIO_NOT_FOUND` and never an unhandled rejection.

---
## 20. Project-list screen

Route: `app/index.tsx`

### 20.1 Layout

```text
TempoLoop                                      [+]

[ Project card ]
[ Project card ]
...
```

A project card displays:

- Project name.
- Duration.
- Configured segment count, such as `4/6 segments`.
- Last updated date in a compact form.
- A menu for delete and optional rename.

### 20.2 Empty state

Show a concise explanation and one primary Import Video button.

### 20.3 Import interaction

1. Press `+` or Import Video.
2. Open the system picker.
3. Ask for and validate the Project name.
4. Open the system document picker.
5. Start inspection and import.
6. Show a modal progress sheet that prevents duplicate import commands.
7. Allow Cancel.
8. On success, dismiss the sheet and navigate to the project.
9. On failure, keep the project list and show an actionable error.

The progress sheet must show the current stage and a determinate percentage when available.

### 20.4 Delete interaction

Before deletion:

- Confirm with the project name.
- Pause and replace/release the `expo-audio` source if it uses the Project.
- Delete the project directory recursively.
- Refresh the list.
- Report deletion failure without hiding the project.

---
## 21. Project practice screen

Route: `app/project/[projectId]/index.tsx`

### 21.1 Header

Display:

```text
< Back     Project Name                         [gear]
```

The gear opens the segment editor.

### 21.2 Speed selector

Show four equal-width large buttons in one row:

```text
[ 1.0x ] [ 0.9x ] [ 0.8x ] [ 0.7x ]
```

Requirements:

- Minimum touch height: 56 dp.
- Current rate has clear selected styling.
- Default is the project's persisted `selectedRate`.
- Rate change updates the project atomically.
- Rate change during playback updates `expo-audio` `player.playbackRate` immediately without seeking.

### 21.3 Segment grid

Show six buttons:

```text
[ Segment 1 ] [ Segment 2 ]
[ Segment 3 ] [ Segment 4 ]
[ Segment 5 ] [ Segment 6 ]
```

Configured segment button:

- Enabled.
- Shows segment number.
- May show a compact range.
- Selected segment has clear styling.

Unset or invalid segment button:

- Disabled.
- Gray.
- Accessibility state reports disabled.

On screen entry, automatically select the first configured segment. If no segment is configured, keep Play disabled and show a prompt to open settings.

Selecting a different segment:

1. Increment the playback command generation.
2. Pause and seek `expo-audio` to the new lead-in position.
3. Do not automatically start playback.
4. Show preparation state until the guarded seek is complete.

### 21.4 Bottom playback area

Display:

- Current source position.
- Practice clip range.
- Large play/pause button, at least 72 dp.

Play behavior:

- Disabled when no valid segment is selected.
- If ready or ended, begin at the lead-in.
- If paused, resume from the paused position.
- If playing, pause.

When the segment ends, the button returns to Play and the next press restarts from the lead-in.

### 21.5 Screen exit

Pause playback and clear the active segment guard when leaving the screen. The source may remain loaded, but no sound may continue in the background.

---
## 22. Segment editor screen

Route: `app/project/[projectId]/segments.tsx`

### 22.1 Header

```text
Cancel                Segment Settings                Save
```

Disable Save while any segment is invalid.

### 22.2 Waveform panel

The top area contains:

- Current time and total duration.
- Full-song waveform.
- A vertical playback cursor.
- Tap and drag seeking.
- Play/pause button.

Use a single SVG path for the waveform upper half and an optional mirrored lower half. Do not render 2,048 separate React components.

### 22.3 Waveform coordinate mapping

For waveform width `widthPx` and pointer x coordinate `xPx`:

```text
ratio = clamp(xPx / widthPx, 0, 1)
targetMs = round(ratio * durationMs)
```

Throttle drag seeks. Send a final exact seek on gesture end.

Recommended interaction:

1. Record whether audio was playing when drag begins.
2. Pause during drag.
3. Show immediate local cursor feedback.
4. Call `expo-audio` `seekTo` at a controlled rate.
5. Resume only if playback had been active before drag.

### 22.4 Segment rows

Render six rows. Each row contains:

```text
Segment 1
Start  --:--   [Set current]
End    --:--   [Set current]   [Clear]
```

`Set current` must:

1. Read the latest `expo-audio` status/current time from the playback coordinator.
2. Convert the source position to integer milliseconds.
3. Update only the draft endpoint.
4. Re-run validation.

`Clear` resets both endpoints for the segment.

### 22.5 Save behavior

On valid Save:

1. Pause editor playback.
2. Atomically write updated project JSON.
3. Replace the project in the store.
4. Return to the practice screen.
5. If the selected practice segment became unset or changed, invalidate its prepared playback state before another play.

On invalid Save, remain on the editor and show the first invalid row.

### 22.6 Cancel and back behavior

If draft is unchanged, return immediately.

If draft changed, ask whether to discard. Do not save automatically.

---
## 23. State management

Use focused Zustand stores and local high-frequency playback state.

### 23.1 Project store

Responsibilities:

- load Project summaries;
- resolve one Project by ID;
- add a completed Project;
- atomically update metadata and segments;
- delete a Project;
- report repository loading and corruption errors.

Do not store waveform arrays for all Projects in the list store. Load a waveform only for the active Project.

### 23.2 Import store

Store:

- active operation ID;
- stage and progress;
- cancel-requested flag;
- selected source metadata;
- draft Project name;
- terminal error.

Do not allow two active imports.

### 23.3 Playback state

Keep the `expo-audio` player and high-frequency current time inside the playback provider/coordinator. Persist only:

- selected playback rate per Project;
- selected segment when useful;
- low-frequency ready/playing/paused/error state.

Do not write playback position to Project JSON on every status update.

---
## 24. Import coordinator

`ImportCoordinator` must implement one clear transaction.

Pseudo-code:

```ts
async function importVideo(asset: DocumentPicker.DocumentPickerAsset, name: string) {
  const operationId = Crypto.randomUUID();
  const projectId = Crypto.randomUUID();
  const tempDir = storage.importDirectory(projectId);
  const partialAudio = storage.partialAudioUri(projectId);

  await repository.createImportDirectory(tempDir);

  try {
    const inspection = await media.inspectVideo({
      sourceUri: asset.uri,
      maxSourceBytes: 629145600,
    });
    validateInspection(inspection);

    const result = await media.importProjectMedia({
      operationId,
      sourceUri: asset.uri,
      outputAudioUri: partialAudio,
      waveformSampleCount: 2048,
      maxSourceBytes: 629145600,
    });

    validateWaveform(result.waveform);
    await repository.finalizeImportedProject({
      projectId,
      name,
      inspection,
      result,
    });

    return projectId;
  } catch (error) {
    await media.cancelImport(operationId).catch(() => undefined);
    await repository.removeImportDirectory(projectId).catch(() => undefined);
    throw translateImportError(error);
  }
}
```

The coordinator must remove progress event subscriptions in `finally`. The final Project becomes visible only after JSON, audio, and waveform validation complete.

---
## 25. Error model

Use stable codes across Kotlin, TypeScript, tests, and UI.

| Code | Meaning | User action |
|---|---|---|
| `E_VIDEO_TOO_LARGE` | Source exceeds 600 MiB | Select a smaller video |
| `E_SOURCE_UNREADABLE` | Selected URI cannot be opened | Select the video again or copy it to local storage |
| `E_NO_AUDIO_TRACK` | Source has no audio | Select another video |
| `E_DRM_UNSUPPORTED` | Protected source | Use an unprotected local video |
| `E_INVALID_DURATION` | Duration is invalid | Select another video |
| `E_STORAGE_LOW` | Not enough private storage | Free device storage |
| `E_IMPORT_BUSY` | Another import is active | Finish or cancel it |
| `E_IMPORT_CANCELLED` | User canceled | No action required |
| `E_UNSUPPORTED_MEDIA` | Device cannot process the source | Use a common MP4/MOV with AAC audio |
| `E_OUTPUT_WRITE_FAILED` | Audio output cannot be written | Free storage and retry |
| `E_EXPORT_EMPTY` | Export created no usable audio | Select another source |
| `E_WAVEFORM_FAILED` | Static waveform generation failed | Retry import |
| `E_INVALID_RANGE` | Segment endpoints are invalid | Correct the segment |
| `E_AUDIO_NOT_FOUND` | Project audio file is missing | Delete or restore the Project |
| `E_AUDIO_LOAD_FAILED` | `expo-audio` cannot load the exported file | Re-import the Project |
| `E_PLAYBACK_COMMAND_STALE` | Obsolete command ignored | No alert |
| `E_PATH_OUTSIDE_APP` | Unsafe native output path | Developer error |
| `E_PROJECT_CORRUPT` | Project JSON is invalid | Delete or repair the Project |
| `E_UNKNOWN_NATIVE` | Unclassified native failure | Retry and inspect development logs |

User-facing text must be short and actionable. Development logs may preserve native causes, but production UI must not show stack traces.

---
## 26. User-interface quality rules

- Use a simple dark or system-adaptive design.
- Make primary controls easy to press while standing several feet from the phone.
- Use at least 48 dp touch targets; speed buttons should be at least 56 dp high.
- Use strong selected, disabled, loading, and pressed states.
- Do not depend on color alone. Add border, icon, or text-state differences.
- Provide accessibility labels such as `Play segment 2 at 0.8 times speed`.
- Support system font scaling without clipping essential controls.
- Keep the main practice controls visible without scrolling on a common phone screen.
- The editor may scroll because it contains six segment rows.
- Prevent the screen from sleeping during import and active playback by using `expo-keep-awake`.
- Release the keep-awake tag immediately when work stops.

---
## 27. Performance rules

### 27.1 React rendering

- Render the waveform as one SVG path or a mirrored pair, not 2,048 React children.
- Memoize Project cards, segment buttons, and rate buttons where measured re-rendering is costly.
- Keep player current-time updates out of the whole-app store.
- Throttle waveform drag seeks and send one final exact seek at gesture end.
- Do not update Project JSON during playback ticks.

### 27.2 Native media work

- Stream source URI input.
- Use bounded decoder buffers.
- Do not retain PCM beyond accumulation needs.
- Throttle progress events.
- Keep one active import.
- Release Transformer, extractor, codec, cursor, and file descriptors in all terminal paths.

### 27.3 Large-source behavior

For a near-600-MiB video:

- the picker must not copy it into cache;
- the app must not create a second full video file;
- import progress must remain cancelable;
- screen interaction must remain responsive;
- a process restart leaves no visible incomplete Project;
- temporary audio output is removed on failure.

---
## 28. Logging and diagnostics

In development builds, log structured events with operation IDs:

- import started/stage/completed/canceled/failed;
- source metadata excluding private path details;
- export duration and output size;
- waveform duration and bin count;
- Project/audio load failure;
- stale playback command ignored;
- measured segment-end overshoot in optional diagnostic mode.

Do not log Project names, raw URIs, media bytes, waveform arrays, or user filenames in production builds.

Add a small diagnostics helper that can be disabled for Preview builds.

---
## 29. Testing strategy

Testing has four layers.

### 29.1 Pure TypeScript unit tests

Required cases:

- Six default segments are fully unset.
- Fully unset segment is valid.
- Partial endpoint is invalid.
- Start equal to end is invalid.
- Start after end is invalid.
- End after duration is invalid.
- Overlapping segments are valid.
- Playback lead-in is clamped at zero.
- Rates outside the exact allowed set are rejected.
- Time formatting handles null, zero, minutes, and hours.
- Atomic repository write leaves the old project on simulated failure.
- Corrupt project JSON does not crash project discovery.

### 29.2 Component tests

Required cases:

- Unset segment buttons are disabled.
- Selected rate has selected state.
- Play is disabled when no segment is configured.
- Save is disabled for partial segment data.
- Clear resets both endpoints.
- Import modal blocks a second import.
- Cancel prompts when the editor draft is dirty.

### 29.3 Kotlin media-module unit tests

Extract pure Kotlin functions for unit testing:

- 600 MiB boundary comparison.
- Storage estimate.
- Safe output path validation.
- Waveform bin mapping.
- Peak normalization.
- Silent waveform behavior.
- Cancellation state transitions.

### 29.4 Android media-module instrumentation tests

Include small licensed or generated fixtures under test assets:

- MP4 with AAC audio.
- MP4 with no audio.
- Very short audio.
- Silent audio.
- Stereo audio.
- Unsupported or intentionally malformed media where practical.

Verify:

- `inspectVideo` returns correct metadata.
- Transformer creates audio-only output.
- Output duration is correct.
- Waveform has 2,048 bounded values.
- `expo-audio` loads and prepares the exported output on a physical device.
- Exported audio remains readable after the source video is removed.
- Cancellation releases Transformer and codec resources.

### 29.5 Physical-device manual test matrix

Run all critical tests on at least one physical Android phone. Prefer a second manufacturer before declaring version 1 stable.

| Area | Test |
|---|---|
| Import size | 20 MB, 200-300 MB, 550-600 MiB, and over-limit file |
| Input source | Camera video, downloaded MP4, messaging-app saved video |
| Audio track | AAC stereo, silent content, no-audio video |
| Import interruption | Cancel at export, cancel at waveform, background app |
| Storage | Low free space before import |
| Project | Restart app, reboot phone, delete source video after import |
| Segments | Unset, partial, valid, overlapping, starts before 6 seconds |
| Playback | All four rates, pause/resume, repeated replay |
| Stress | Rapid rate and segment taps for several minutes |
| Audio route | Wired headphones, Bluetooth, disconnect during playback |
| Interruption | Phone call or another audio app takes focus |
| Offline | Airplane mode launch, import, edit, and playback |
| Persistence | Install updated APK over old APK with same package/signature |

---
## 30. Required manual acceptance scenarios

### Scenario A: Basic import

1. Enter a valid Project name.
2. Select a normal MP4 video with audio.
3. Observe all import stages.
4. Confirm the original video image never appears in the project.
5. Restart the app.
6. Confirm the project and audio remain usable.

### Scenario B: Segment creation during playback

1. Open settings.
2. Start full-song playback.
3. At about `01:03.2`, press Set current for Segment 1 Start.
4. Continue to about `01:35.0`, press Set current for Segment 1 End.
5. Save.
6. Confirm Segment 1 becomes enabled.

### Scenario C: Lead-in

1. Configure Segment 1 as `01:03.2` to `01:35.0`.
2. Select Segment 1.
3. Press Play.
4. Confirm playback begins near `00:57.2`.
5. Confirm playback stops at `01:35.0`.
6. Press Play again and confirm it restarts near `00:57.2`.

### Scenario D: Start near song beginning

1. Configure a segment from `00:04.0` to `00:20.0`.
2. Confirm practice playback begins at `00:00.0`, not a negative time.

### Scenario E: Invalid draft

1. Set only a segment start.
2. Confirm Save is disabled or rejected.
3. Exit and discard.
4. Reopen and confirm persisted data did not change.

### Scenario F: Overlap

1. Configure Segment 1 as `00:30` to `01:00`.
2. Configure Segment 2 as `00:50` to `01:20`.
3. Save successfully.
4. Confirm both segment buttons work independently.

### Scenario G: Rapid input

1. Rapidly tap multiple segments and rates.
2. Confirm only the final selected segment becomes ready.
3. Confirm no obsolete seek starts audio from another segment.
4. Confirm no crash and no duplicated progress events.

### Scenario H: 600 MiB class source

1. Import a source between 550 and 600 MiB.
2. Monitor application memory.
3. Confirm UI remains responsive.
4. Confirm cancellation works.
5. Confirm successful completion leaves no full-size source copy in app storage.

---
## 31. Windows and EAS development workflow

### 31.1 Development APK

From Windows PowerShell:

```powershell
npm install
npx eas-cli@latest login
npx eas-cli@latest init
npm run typecheck
npm run lint
npm test
npx expo-doctor@latest
npx eas-cli@latest build --platform android --profile development
```

Install the resulting APK through the EAS build link. Then start Metro:

```powershell
npx expo start --dev-client
```

Use `--tunnel` only when the phone cannot reach the Windows LAN server.

### 31.2 Rebuild rules

No new APK is normally required for:

- TypeScript logic;
- layout, styles, copy;
- React components;
- tests.

A new Development APK is required after changing:

- Kotlin code;
- native dependencies;
- app config or permissions;
- Expo SDK;
- local module registration.

### 31.3 Preview APK

After acceptance checks:

```powershell
npm run typecheck
npm run lint
npm test
npx expo-doctor@latest
npx eas-cli@latest build --platform android --profile preview
```

Install the Preview APK over the existing app. Keep the same Expo project, package ID, and EAS-managed keystore. Do not uninstall before updating because uninstall removes local Projects.

### 31.4 Offline verification

- stop Metro;
- enable airplane mode;
- launch TempoLoop;
- import a local video;
- edit segments;
- use all four rates;
- restart the app and confirm persistence.

---
## 32. Troubleshooting requirements

### Kotlin module is missing

Cause: the phone has an old Development APK or Expo Go.

Action: rebuild the Development profile and install it over the current TempoLoop app.

### Metro cannot connect

- confirm phone and Windows use the same Wi-Fi;
- allow Node.js through Windows private-network firewall;
- retry with `npx expo start --dev-client --tunnel`.

### APK cannot update

- keep `com.tempoloop.app` unchanged;
- use the same Expo project and EAS keystore;
- ensure the new build has a higher versionCode;
- do not uninstall an app containing Projects until data is intentionally discarded.

### One source fails to import

- record MIME type, size, duration, and native error code;
- verify the URI remains readable during the operation;
- verify all Media3 modules resolve to one version;
- preserve a minimal private test fixture only when licensing permits;
- do not add FFmpeg as a quick workaround.

### Rate changes pitch incorrectly

- confirm `player.shouldCorrectPitch = true`;
- use supported rates only;
- verify no custom audio effect overrides pitch;
- test on physical hardware.

### Segment stops too late

- inspect status update interval and JavaScript load;
- verify the end guard is not recreated every render;
- test command-generation cancellation;
- measure overshoot before adding a native boundary guard.

---
## 33. Implementation phases

### Phase 1 - Project shell, domain model, and storage

Implement:

- Expo Router routes;
- strict TypeScript models;
- six-segment validation;
- time formatting;
- Project directory schema;
- atomic JSON writes;
- launch recovery;
- unit tests.

Acceptance: Project metadata survives restart and invalid segment drafts cannot be saved.

### Phase 2 - `TempoLoopMedia` skeleton and video inspection

Implement:

- local Expo Module registration;
- typed records and stable errors;
- `content://` inspection;
- size/audio-track/duration checks;
- path safety;
- cancellation skeleton.

Acceptance: Development APK compiles and inspection works on physical-device videos without copying the source.

### Phase 3 - Audio export and static waveform

Implement:

- Media3 Transformer audio-only export;
- version alignment with `expo-audio`;
- partial-file transaction;
- MediaCodec waveform decode;
- progress and cancellation;
- output validation.

Acceptance: common phone videos produce loadable `audio.m4a` and exactly 2,048 valid waveform values.

### Phase 4 - Import flow and Project list

Implement:

- Project naming;
- document picker with cache copy disabled;
- import progress sheet;
- cancel/failure rollback;
- Project cards;
- delete and optional rename.

Acceptance: failed/canceled imports leave no visible Project and no partial directory.

### Phase 5 - Segment editor

Implement:

- full-track `expo-audio` playback at 1.0x;
- full static waveform;
- tap/drag seek;
- current-time capture;
- six draft rows;
- validation, Save, Clear, Cancel, and discard confirmation.

Acceptance: overlapping complete segments save; partial or reversed intervals do not.

### Phase 6 - Practice player

Implement:

- four rate buttons;
- pitch correction;
- six segment buttons;
- six-second lead-in;
- command-generation protection;
- SegmentEndGuard;
- automatic pause and reset.

Acceptance: all rates work, stale commands never start, and normal end overshoot is below 100 ms on the test phone.

### Phase 7 - hardening, tests, and EAS profiles

Implement:

- near-600-MiB test;
- no-audio and unsupported-source tests;
- app background/foreground tests;
- rapid input tests;
- Preview APK offline test;
- README build instructions;
- final cleanup and diagnostics review.

---
## 34. Definition of done

### Product

- A user creates a named Project from one local video.
- Only extracted audio, waveform, and metadata are retained.
- Six independently overlapping segments are supported.
- Unset segments are gray and disabled.
- Segment editing works while playing or paused.
- Incomplete segments cannot be saved.
- Practice rates are exactly 1.0x, 0.9x, 0.8x, and 0.7x with pitch correction.
- Practice starts six source-audio seconds early and stops at the configured end.
- Preview APK works offline.

### Engineering

- No media bytes enter JavaScript.
- The picker does not copy a near-600-MiB source to cache.
- `expo-audio` is the only playback engine.
- Kotlin module contains no general playback UI/controller.
- No FFmpeg dependency exists.
- Media3 dependencies resolve to one version.
- Import is transactional and cancelable.
- JSON writes are atomic.
- Temporary files are recovered or deleted after interruption.
- TypeScript, lint, and tests pass.
- EAS Development and Preview APKs compile.

### Deployment

- Application ID remains `com.tempoloop.app`.
- EAS uses one persistent Android keystore.
- New APKs install over the old app without deleting Project data.
- The README states which changes require a native rebuild.

---
## 35. Prohibited shortcuts

Codex must not:

- use Expo Go as the final development environment;
- use `expo-av`;
- write a custom Kotlin player before measured need;
- move all UI to Jetpack Compose;
- use `expo-image-picker` for the large-video import path;
- set `copyToCacheDirectory: true` for source videos;
- read source media in JavaScript;
- use Base64, blobs, or whole-file `ArrayBuffer` media transport;
- use a JavaScript-only MP4 parser;
- add FFmpeg/FFmpegKit/WebAssembly media processing;
- use a server or upload media;
- use a plain JavaScript `setInterval` as the only segment-end clock;
- create one audio player per component render;
- persist player objects or high-frequency current time;
- make an incomplete Project visible;
- ignore cancellation cleanup;
- mix Media3 dependency versions;
- request camera, microphone, or all-files permission;
- change the Android package ID after Project data exists;
- add Google Play deployment work in version 1;
- hide build or test failures behind mock success values.

---
## 36. Codex working notes

Before coding, create `IMPLEMENTATION_NOTES.md` with:

- exact Expo SDK and React Native versions from the lockfile;
- exact `expo-audio` version;
- exact resolved Media3 version;
- EAS project ID after initialization;
- test-phone Android version and model;
- measured segment-end overshoot at each playback rate;
- known source-format limits.

When an API example in this document differs from the installed SDK, use the installed typed API and preserve the required behavior. Never delete a requirement merely because a method name changed.

Keep commits small and grouped by phase. Do not mix formatting-only changes with native media changes.

---
## 37. Official references

Codex should consult current official documentation during implementation:

- Expo SDK 57 and `create-expo-app`
- Expo Development Builds and EAS Build APK profiles
- Expo Router
- `expo-audio`
- `expo-document-picker`
- `expo-file-system`
- Expo Modules API local modules
- Android `ContentResolver` and `MediaExtractor`
- Jetpack Media3 Transformer and transformations
- Android `MediaCodec`

Use official Expo, Android, and source-repository documentation for version-sensitive details. Do not copy code from unverified blog posts when official APIs are available.

When implementation is complete, update `README.md` with the exact package versions selected by the lockfile, the resolved Media3 version, the Development APK command, the Preview APK command, and the native-rebuild rules.
