# DanceCue — Codex Implementation Specification

**Target:** iPhone only  
**Primary development machine:** Windows  
**Framework:** React Native with Expo  
**Cloud build:** EAS Build  
**App type:** private, offline, single-user dance practice app  
**Maximum selected video size:** 600 MB  
**Reference date:** 2026-07-30

---

## 0. Instructions for Codex

Treat this document as the implementation contract for the first usable version of **DanceCue**. Implement the application end to end. Do not replace the requested behavior with a mock, web-only implementation, or an Expo Go-only implementation.

The app must use a custom local Expo native module written in Swift for iOS audio extraction, waveform generation, and range playback. The React Native layer must never load a selected video into JavaScript memory, convert the video to Base64, or pass raw video bytes through the React Native bridge. The JavaScript layer may pass only local file URIs and small metadata objects to Swift.

The app is iOS-only for version 1. Do not spend time implementing Android behavior. The generated Expo project may contain Android support, but the custom native module may declare Apple support only.

Use stable releases only. Do not use Expo beta or canary releases. At the reference date, Expo SDK 57 is the stable target. Create the project with the SDK 57 template, then install compatible package versions with `npx expo install` rather than manually guessing versions.

Do not use FFmpeg, FFmpegKit, WebAssembly media conversion, cloud conversion, a server, analytics, authentication, advertisements, or remote storage. Use Apple AVFoundation in Swift.

Do not commit Apple credentials, certificates, provisioning profiles, API keys, passwords, `.env` secrets, generated `ios/` files, or generated `android/` files.

When an implementation detail in this document and an installed API type disagree, preserve the required app behavior and use the current typed API from the installed stable Expo SDK.

---

## 1. Product definition

DanceCue converts the audio track of a user-selected video into a local dance-practice project. Each project stores only an extracted audio file, metadata, a waveform cache, and six independently configured practice segments. The original video is not retained by DanceCue after a successful import.

A user opens a project, selects one of four playback speeds, selects a configured segment, and presses a large play button. Playback begins six source-audio seconds before the segment start and stops at the segment end. Segment time ranges may overlap.

The app must run without network access after installation. All project data must stay inside the app container.

### 1.1 Required features

1. Select one video from the iPhone photo library.
2. Reject videos larger than 600 MB.
3. Extract the video's audio to an M4A file.
4. Create a named project.
5. Display four large speed buttons in one row: `1.0x`, `0.9x`, `0.8x`, and `0.7x`.
6. Display six segment buttons in a three-row, two-column grid.
7. Disable and gray out segment buttons whose start and end times are not both configured.
8. Provide a segment editor reached from a settings button beside the project title.
9. In the segment editor, display a waveform, current time, duration, scrub control, and play/pause control.
10. Let the user set each segment's start or end to the current playback position while audio is playing or paused.
11. Initialize every segment endpoint as unset and display unset values as `--:--`.
12. Permit overlapping segment ranges.
13. Save editor changes only when every segment is either fully unset or has both a valid start and a valid end.
14. Discard the entire editor draft when the user exits with any partially configured or invalid segment.
15. Play the selected segment at the selected speed.
16. Begin range playback at `max(0, segmentStart - 6 seconds)`.
17. Stop range playback at `segmentEnd`.
18. Keep pitch as natural as AVFoundation permits while changing playback speed.
19. Store all data locally.
20. Work reliably with selected videos up to 600 MB without out-of-memory failures.

### 1.2 Resolved requirement conflict

The original notes mention six segments and later mention four rows in the editor. Implement **six segments everywhere**. The main project screen uses three rows with two segment buttons per row. The editor lists six segment rows.

### 1.3 Explicitly out of scope for version 1

Do not implement accounts, synchronization, cloud backup, video playback, camera recording, social sharing, collaborative projects, subscriptions, App Store distribution, Android support, automatic beat detection, tempo detection, looping without a user press, background audio, lock-screen controls, Apple Watch support, or music-library DRM imports.

---

## 2. Non-functional requirements

### 2.1 Stability

- Never read the full selected video or extracted audio file into JavaScript memory.
- Never represent media data as Base64.
- Process audio samples in bounded native buffers.
- Maintain one `AVPlayer` instance for the app session.
- Remove every AVPlayer time observer before replacing an item or releasing the controller.
- Serialize native player commands so rapid taps cannot cause an old seek completion to start the wrong segment.
- Use temporary files and commit project data only after extraction and waveform generation both succeed.
- Delete partial files after cancellation, failure, or app recovery.
- Avoid Swift force unwraps, `try!`, and assumptions about audio-track availability.
- Every native async method must reject with a stable error code and a user-readable message.

### 2.2 Performance targets

- Cold launch to project list: under 2 seconds on a recent iPhone, excluding OS-level photo picker work.
- Prepared local audio starts within 300 ms of a play press under normal conditions.
- Playback position events: approximately 10 Hz; do not emit frame-rate events.
- Segment-end audible overshoot target: no more than 100 ms under normal conditions.
- Peak app memory during import of a 600 MB video: target below 250 MB.
- Waveform cache: 2,048 normalized amplitude points per project.
- Project list must remain responsive while importing.

### 2.3 Privacy

- No network requests in preview or production builds.
- No telemetry, crash upload, analytics, advertisements, or identifiers sent off-device.
- Photo access is used only to select a video for local audio extraction.
- Delete the temporary selected-video file after a successful or failed import.
- Deleting a project must delete its audio file, waveform cache, and metadata entry.

### 2.4 Platform and orientation

- iOS only.
- Minimum iOS version: the minimum required by the selected stable Expo SDK; for Expo SDK 57, target iOS 16.4 or later.
- Portrait orientation only.
- iPhone only; do not design an iPad-specific layout.

---

## 3. Technology stack

Use the following stack unless a current stable Expo API requires a small adjustment:

| Area | Technology |
|---|---|
| App framework | React Native + Expo SDK 57 |
| Language | TypeScript with strict mode |
| Navigation | Expo Router, stack navigation |
| Cloud compilation | EAS Build |
| Development client | `expo-dev-client` |
| Photo/video picker | `expo-image-picker` |
| File storage | modern `File`, `Directory`, and `Paths` APIs from `expo-file-system` |
| Keep screen awake | `expo-keep-awake` while actively playing or importing |
| IDs | `expo-crypto` UUID generation |
| Waveform drawing | `react-native-svg` |
| App state | Zustand |
| Runtime data validation | Zod |
| Native iOS code | Swift + Expo Modules API |
| Native media processing | AVFoundation |
| Unit tests | Jest + `jest-expo` + React Native Testing Library |
| Formatting and linting | ESLint + Prettier |

Do not use `expo-av`; it is not the playback implementation for this app. Do not use `expo-audio` for range enforcement. The custom Swift controller owns playback timing so the JavaScript event loop is not responsible for stopping at segment boundaries.

---

## 4. Initial project creation

Run the following commands from Windows PowerShell:

```powershell
npx create-expo-app@latest dance-cue --template default@sdk-57
cd dance-cue

npx expo install expo-dev-client expo-image-picker expo-file-system expo-keep-awake expo-crypto react-native-svg
npm install zustand zod
npm install --save-dev jest-expo @testing-library/react-native @types/jest prettier

npx create-expo-module@latest --local
```

When `create-expo-module` asks for names, use:

- Package/local folder name: `dance-audio`
- Native module name: `DanceAudio`
- Platforms: Apple only when the generator permits platform selection

Do not run or commit a generated iOS project from Windows. EAS Build must run Expo Prebuild and compile the iOS app in the cloud. Keep `ios/` and `android/` in `.gitignore`.

Install EAS CLI for deployment work:

```powershell
npm install --global eas-cli
```

---

## 5. Repository layout

Create the following structure. Small helper files may be added, but do not merge unrelated responsibilities into large screens.

```text
dance-cue/
├─ app/
│  ├─ _layout.tsx
│  ├─ index.tsx
│  └─ project/
│     └─ [projectId]/
│        ├─ index.tsx
│        └─ segments.tsx
│
├─ src/
│  ├─ components/
│  │  ├─ AppButton.tsx
│  │  ├─ EmptyState.tsx
│  │  ├─ ImportProgressSheet.tsx
│  │  ├─ PlaybackButton.tsx
│  │  ├─ SegmentButton.tsx
│  │  ├─ SegmentGrid.tsx
│  │  ├─ SegmentTimeRow.tsx
│  │  ├─ SpeedSelector.tsx
│  │  └─ WaveformScrubber.tsx
│  │
│  ├─ constants/
│  │  ├─ app.ts
│  │  ├─ copy.ts
│  │  └─ theme.ts
│  │
│  ├─ domain/
│  │  ├─ project.ts
│  │  ├─ segment.ts
│  │  ├─ playback.ts
│  │  └─ validation.ts
│  │
│  ├─ repositories/
│  │  └─ ProjectRepository.ts
│  │
│  ├─ services/
│  │  ├─ ImportCoordinator.ts
│  │  ├─ NativeAudioService.ts
│  │  ├─ StorageLayout.ts
│  │  └─ RecoveryService.ts
│  │
│  ├─ stores/
│  │  ├─ useProjectStore.ts
│  │  └─ usePlaybackStore.ts
│  │
│  ├─ hooks/
│  │  ├─ useAppLifecyclePause.ts
│  │  ├─ useNativePlaybackEvents.ts
│  │  └─ useSelectedProject.ts
│  │
│  └─ utils/
│     ├─ errors.ts
│     ├─ file.ts
│     ├─ time.ts
│     └─ uri.ts
│
├─ modules/
│  └─ dance-audio/
│     ├─ expo-module.config.json
│     ├─ index.ts
│     ├─ src/
│     │  ├─ DanceAudio.types.ts
│     │  ├─ DanceAudioModule.ts
│     │  └─ index.ts
│     └─ ios/
│        ├─ DanceAudio.podspec
│        ├─ DanceAudioModule.swift
│        ├─ DanceAudioController.swift
│        ├─ AudioExtractionService.swift
│        ├─ AudioTranscodeFallback.swift
│        ├─ WaveformService.swift
│        ├─ AudioSessionCoordinator.swift
│        ├─ DanceAudioError.swift
│        └─ NativeModels.swift
│
├─ __tests__/
│  ├─ segment-validation.test.ts
│  ├─ playback-range.test.ts
│  ├─ time-format.test.ts
│  ├─ repository-recovery.test.ts
│  └─ project-screen.test.tsx
│
├─ app.config.ts
├─ eas.json
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## 6. App configuration

Use `app.config.ts`. Keep the configuration deterministic and free of secrets.

```ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'DanceCue',
  slug: 'dance-cue',
  scheme: 'dancecue',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  updates: {
    enabled: false,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.jipeng.dancecue',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-image-picker',
      {
        photosPermission:
          'DanceCue uses the video you select only to extract audio for offline dance practice.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
```

If Apple reports that `com.jipeng.dancecue` is unavailable, replace it once with another stable reverse-domain identifier and keep the new identifier unchanged in later builds.

The `updates.enabled` value must remain `false` for version 1 so preview builds do not check a remote update service. Development builds may still connect to Metro through `expo-dev-client`.

Use the following `eas.json`:

```json
{
  "cli": {
    "version": ">= 19.1.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

Version 1 uses `development` and `preview`. Do not submit `production` to the App Store unless the user later requests public distribution.

---

## 7. Domain model

Use integer milliseconds in TypeScript. Do not store floating-point seconds in JSON. Convert milliseconds to `CMTime` only inside Swift.

```ts
export const PLAYBACK_RATES = [1.0, 0.9, 0.8, 0.7] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export type SegmentNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface DanceSegment {
  number: SegmentNumber;
  startMs: number | null;
  endMs: number | null;
}

export interface DanceProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  durationMs: number;
  sourceVideoBytes: number;
  audioRelativePath: string;
  waveformRelativePath: string;
  preferredRate: PlaybackRate;
  lastSelectedSegment: SegmentNumber | null;
  segments: [
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
    DanceSegment,
  ];
}

export interface ProjectIndexFile {
  schemaVersion: 1;
  projects: DanceProject[];
}
```

Create exactly six segment objects for every new project:

```ts
[
  { number: 1, startMs: null, endMs: null },
  { number: 2, startMs: null, endMs: null },
  { number: 3, startMs: null, endMs: null },
  { number: 4, startMs: null, endMs: null },
  { number: 5, startMs: null, endMs: null },
  { number: 6, startMs: null, endMs: null },
]
```

### 7.1 Segment validity

Define a segment as valid when exactly one of the following states holds:

1. `startMs === null` and `endMs === null`.
2. Both values are integers and `0 <= startMs < endMs <= project.durationMs`.

A segment with only one endpoint is invalid. A project editor draft is savable only when all six segments are valid.

Overlaps are valid. Do not compare one segment with another segment during validation.

### 7.2 Range calculation

```ts
export function calculatePlaybackRange(segment: DanceSegment) {
  if (segment.startMs === null || segment.endMs === null) {
    throw new Error('SEGMENT_NOT_CONFIGURED');
  }

  return {
    playFromMs: Math.max(0, segment.startMs - 6000),
    stopAtMs: segment.endMs,
  };
}
```

The six-second lead-in is measured on the source audio timeline. At `0.7x`, six source seconds take about 8.57 real seconds to play. Do not change the lead-in based on playback rate.

---

## 8. Local storage design

Use the app Documents directory for final project data because iOS must not purge the files under storage pressure. Use the app Cache directory only for selected-video files and import staging.

```text
Documents/
└─ DanceCue/
   ├─ projects.json
   └─ Projects/
      └─ <project-id>/
         ├─ audio.m4a
         └─ waveform.json

Cache/
└─ DanceCue/
   └─ Staging/
      └─ <import-task-id>/
         ├─ audio.partial.m4a
         └─ waveform.partial.json
```

Do not copy the selected video into Documents. `expo-image-picker` supplies a local URI, commonly in Cache. Process the URI and delete the picked local file after the import transaction ends.

### 8.1 `waveform.json`

Store a JSON object instead of raw media data:

```ts
interface WaveformFile {
  schemaVersion: 1;
  pointCount: 2048;
  durationMs: number;
  amplitudes: number[]; // exactly 2048 finite values in [0, 1]
}
```

A 2,048-point JSON waveform is small enough for this app and easy to validate and recover.

### 8.2 Atomic metadata writes

`ProjectRepository` must use the modern `expo-file-system` API:

1. Serialize and validate the next `ProjectIndexFile`.
2. Write to `projects.json.tmp`.
3. Read and validate `projects.json.tmp`.
4. Replace `projects.json` by moving the temporary file.
5. Keep a `projects.json.bak` copy of the last valid file before replacement.
6. On launch, if `projects.json` is missing or invalid, attempt `projects.json.bak`.
7. Never silently discard valid project folders because the index file is damaged.

### 8.3 Import transaction

Create the project only after all steps succeed:

```text
select video
  -> validate type and size
  -> validate free disk space
  -> create staging directory
  -> extract audio to audio.partial.m4a
  -> read duration from extracted audio
  -> generate 2,048 waveform points
  -> write and validate waveform.partial.json
  -> move staging output into final project directory
  -> atomically update projects.json
  -> delete selected-video cache file
```

On any error or cancellation:

```text
pause/cancel native work
  -> delete staging directory
  -> delete selected-video cache file when owned by the app
  -> do not add a project entry
  -> display a user-readable error
```

On app launch, `RecoveryService` must delete staging directories older than 24 hours and remove index entries whose final audio file no longer exists. If an unindexed project folder contains a valid audio file and waveform, log it for diagnostics rather than deleting it automatically.

---

## 9. Video selection and 600 MB handling

Use `expo-image-picker` with a single video selection:

```ts
const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
if (!permission.granted) {
  // Show a clear error and a Settings instruction.
}

const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ['videos'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  selectionLimit: 1,
  shouldDownloadFromNetwork: true,
});
```

Do not set a compression quality. Preserve the original picked video representation so iOS does not spend time recompressing a file whose video track will be discarded.

Use `asset.fileSize` when available. If `asset.fileSize` is absent or zero, construct a modern `File` from `asset.uri` and read its `size` property.

Define constants:

```ts
export const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
export const MIN_FREE_SPACE_AFTER_PICK_BYTES = 1024 * 1024 * 1024;
```

Reject an asset when:

- `asset.type !== 'video'`;
- the URI is absent;
- the size cannot be determined;
- `size > MAX_VIDEO_BYTES`;
- `Paths.availableDiskSpace < max(MIN_FREE_SPACE_AFTER_PICK_BYTES, size * 1.25)`.

The disk-space rule is intentionally conservative. The selected video may already occupy Cache space, and extraction needs output space plus operating-system headroom.

Display file size with binary units and a precise message:

```text
This video is 642 MB. DanceCue supports videos up to 600 MB.
```

During import, show a modal sheet that cannot be dismissed by an accidental swipe. Display phases:

1. `Preparing video…`
2. `Extracting audio…`
3. `Building waveform…`
4. `Saving project…`

Provide a Cancel button. Cancellation must propagate to Swift and clean the staging directory.

Use `expo-keep-awake` during import and display: `Keep DanceCue open until the import finishes.`

---

## 10. Local Expo native module

Create a local Expo module named `DanceAudio` under `modules/dance-audio`.

A suitable `expo-module.config.json` is:

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": ["DanceAudioModule"]
  }
}
```

Set the podspec deployment target to the app's minimum supported iOS version.

### 10.1 TypeScript module contract

Define the following public types. Small naming adjustments are acceptable when generated Expo Modules types require them, but preserve the semantics.

```ts
export type NativePlaybackRate = 1 | 0.9 | 0.8 | 0.7;

export type NativePlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'seeking'
  | 'completed'
  | 'failed';

export interface ExtractAudioResult {
  durationMs: number;
  outputBytes: number;
}

export interface PlaybackSnapshot {
  state: NativePlaybackState;
  currentTimeMs: number;
  durationMs: number;
  rate: NativePlaybackRate;
  activeRangeStartMs: number | null;
  activeRangeEndMs: number | null;
}

export interface ImportProgressEvent {
  taskId: string;
  phase: 'extracting' | 'waveform';
  progress: number; // finite, clamped to [0, 1]
}

export interface PlaybackEvent extends PlaybackSnapshot {
  reason?:
    | 'user'
    | 'range-ended'
    | 'interruption'
    | 'route-changed'
    | 'app-inactive'
    | 'error';
}

export interface DanceAudioEvents {
  onImportProgress: (event: ImportProgressEvent) => void;
  onPlaybackChanged: (event: PlaybackEvent) => void;
}
```

Expose async functions:

```ts
extractAudio(
  taskId: string,
  inputVideoUri: string,
  outputAudioUri: string,
): Promise<ExtractAudioResult>;

generateWaveform(
  taskId: string,
  audioUri: string,
  pointCount: number,
): Promise<number[]>;

cancelTask(taskId: string): Promise<void>;

loadAudio(audioUri: string): Promise<PlaybackSnapshot>;

playRange(
  startMs: number,
  endMs: number,
  rate: NativePlaybackRate,
): Promise<PlaybackSnapshot>;

playFrom(positionMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot>;

pause(): Promise<PlaybackSnapshot>;
resume(): Promise<PlaybackSnapshot>;
seek(positionMs: number): Promise<PlaybackSnapshot>;
setRate(rate: NativePlaybackRate): Promise<PlaybackSnapshot>;
stopAndSeek(positionMs: number): Promise<PlaybackSnapshot>;
getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
unload(): Promise<void>;
```

`playRange` is used by the main practice screen. `playFrom`, `seek`, `pause`, and `resume` are used by the segment editor.

### 10.2 Stable native error codes

Use errors with stable codes:

```text
E_INVALID_URI
E_FILE_NOT_FOUND
E_NO_AUDIO_TRACK
E_EXPORT_UNSUPPORTED
E_EXPORT_FAILED
E_WAVEFORM_FAILED
E_INVALID_POINT_COUNT
E_INVALID_RANGE
E_AUDIO_NOT_LOADED
E_SEEK_FAILED
E_PLAYBACK_FAILED
E_CANCELLED
E_AUDIO_SESSION_FAILED
E_INSUFFICIENT_STORAGE
E_INTERNAL
```

The TypeScript layer maps each code to concise app copy. Preserve the native technical message in debug logs.

---

## 11. Swift architecture

### 11.1 `DanceAudioModule.swift`

Responsibilities:

- Declare the Expo module name and event names.
- Validate primitive arguments at the bridge boundary.
- Convert URIs into file URLs.
- Forward work to dedicated services.
- Return serializable dictionaries and arrays only.
- Send progress and playback events.
- Never contain the full extraction or playback implementation.

Use Expo Modules API `AsyncFunction` definitions for long-running calls. Do not block the main thread while exporting or reading audio samples.

### 11.2 `DanceAudioController.swift`

Create one controller for the app process. AVPlayer mutations must be serialized on the main actor.

Suggested declaration:

```swift
@MainActor
final class DanceAudioController {
    private let player = AVPlayer()
    private var periodicTimeObserver: Any?
    private var boundaryTimeObserver: Any?
    private var currentItemStatusObservation: NSKeyValueObservation?
    private var commandGeneration: UInt64 = 0

    private var loadedURL: URL?
    private var activeRangeStartMs: Int?
    private var activeRangeEndMs: Int?
    private var selectedRate: Float = 1.0
    private var state: PlaybackState = .idle
}
```

The exact implementation may differ, but preserve the following rules:

- One player instance.
- Increment `commandGeneration` before every load, seek, segment change, stop, or unload command.
- Capture the generation value before awaiting a seek completion.
- Ignore a completion when the captured generation no longer equals the current generation.
- Remove old observers before replacing `AVPlayerItem`.
- Keep strong references to time-observer tokens.
- Pair every observer creation with `removeTimeObserver`.
- Emit no more than about ten time updates per second.
- All emitted time values are integer milliseconds.

### 11.3 Audio session

`AudioSessionCoordinator` must configure:

```swift
try session.setCategory(.playback, mode: .default, options: [])
try session.setActive(true)
```

Do not add the background-audio entitlement. The TypeScript lifecycle hook pauses playback when the app becomes inactive.

Observe:

- `AVAudioSession.interruptionNotification`;
- `AVAudioSession.routeChangeNotification`;
- media-services reset if needed by the selected iOS target.

Behavior:

- On interruption start: pause and emit reason `interruption`.
- On interruption end: remain paused by default. Resume only when iOS explicitly indicates resume is appropriate and the app is active.
- When old audio output becomes unavailable, such as disconnected headphones: pause and emit reason `route-changed`.
- Do not unexpectedly continue from the phone speaker after headphones are removed.

### 11.4 Loading audio

`loadAudio` must:

1. Validate the local file URL.
2. Pause the previous item.
3. Increment command generation.
4. Remove prior observers.
5. Create `AVURLAsset` and `AVPlayerItem`.
6. Set `item.audioTimePitchAlgorithm = .spectral`.
7. Replace the player item.
8. Wait for item status to become ready or fail.
9. Read a finite positive duration.
10. Install a periodic observer with approximately 100 ms interval.
11. Emit `ready`.

### 11.5 Range playback state machine

Use the following state transition intent:

```text
idle -> loading -> ready
ready -> seeking -> playing
playing -> paused
paused -> playing
playing -> completed -> ready
ready/playing/paused -> seeking -> ready or playing
any state -> failed
any state -> idle on unload
```

`playRange(startMs, endMs, rate)` must reject unless:

```text
0 <= startMs < endMs <= durationMs
rate is exactly 1.0, 0.9, 0.8, or 0.7
```

Implementation order:

1. Increment command generation.
2. Pause.
3. Remove the old boundary observer.
4. Store active range.
5. Seek to `startMs` with zero tolerance before and after when practical.
6. Verify command generation after seek completion.
7. Add a boundary observer for `endMs`.
8. Set the item's time-pitch algorithm to `.spectral`.
9. Start with `playImmediately(atRate:)` or the current supported equivalent.
10. Emit `playing`.

When the end boundary is reached:

1. Pause immediately.
2. Remove the boundary observer.
3. Emit `completed` with reason `range-ended`.
4. Seek back to the active range start.
5. Emit `ready` after the seek completes.

The periodic observer must also contain a defensive end check. If playback time is at or beyond `endMs`, execute the same range-end path. Guard the path against duplicate execution.

### 11.6 Speed changes

`setRate` must validate the exact allowed values. While playing, apply the new rate without seeking. While paused or ready, store the new rate for the next play/resume.

Use `.spectral` because the content is music. Do not pitch-shift the music intentionally.

### 11.7 Editor playback

`playFrom(positionMs, rate)` plays from the requested position without a segment end boundary. It is used only in the segment editor. `seek` preserves paused status unless the editor explicitly calls `playFrom` after seeking.

When the current time reaches audio duration, pause and move to duration or zero according to a single documented behavior. Prefer moving to zero and emitting `completed` so the next editor play starts from the beginning.

---

## 12. Audio extraction

### 12.1 Primary path

`AudioExtractionService` must use AVFoundation and a local file URL.

1. Create an `AVURLAsset`.
2. Load audio tracks asynchronously.
3. Reject with `E_NO_AUDIO_TRACK` when no audio track exists.
4. Verify compatibility with `AVAssetExportPresetAppleM4A`.
5. Create `AVAssetExportSession` with the Apple M4A preset.
6. Export to a non-existing `.m4a` staging path.
7. Poll export progress on a background task and emit progress no more than five times per second.
8. Support cancellation.
9. Verify the output exists and has nonzero size.
10. Load the output duration and return integer milliseconds.

The primary path must not preserve video. The output is audio-only M4A.

### 12.2 Fallback path

Some valid videos may not work with the M4A export preset. Implement `AudioTranscodeFallback` with `AVAssetReader` and `AVAssetWriter`:

- Read the source audio track in linear PCM.
- Write AAC-LC into an M4A container.
- Select a normal music sample rate supported by the source and writer, preferably 48 kHz or 44.1 kHz.
- Use a reasonable stereo AAC bitrate, such as 192 kbps, and a lower bitrate for mono when appropriate.
- Append sample buffers in a bounded loop.
- Check cancellation between buffers.
- Do not retain all sample buffers.
- Reject with `E_EXPORT_FAILED` when both primary and fallback paths fail.

Use the fallback only after the primary path is unavailable or fails for a supported source. Record the selected path in local debug logs.

### 12.3 Background behavior during import

Use `UIApplication.beginBackgroundTask` as a best-effort guard for a brief accidental background transition. Do not promise a long-running background import. The UI must tell the user to keep DanceCue open.

Cancel cleanly when the system ends the background task before completion.

---

## 13. Waveform generation

`WaveformService` must use `AVAssetReader` to stream decoded linear PCM from the extracted M4A file.

### 13.1 Required output

- Exactly 2,048 points.
- Finite values only.
- Each value in `[0, 1]`.
- Values represent the whole audio duration at uniform time intervals.
- Use channel-combined RMS or peak amplitude. Prefer RMS because it gives a readable music envelope.

### 13.2 Bounded-memory algorithm

1. Load audio duration and the track's sample rate/channel count.
2. Estimate total frames from duration and sample rate.
3. Compute a target bucket size for 2,048 time buckets.
4. Request linear PCM from `AVAssetReaderTrackOutput` or `AVAssetReaderAudioMixOutput`.
5. Iterate sample buffers.
6. Read samples from each buffer and accumulate squared magnitude per bucket across channels.
7. Finalize each bucket as RMS.
8. If fewer than 2,048 buckets receive samples, pad the end with zeros.
9. Normalize by a robust high percentile such as the 99th percentile, not only the single maximum.
10. Clamp values to `[0, 1]`.
11. Return the small array to TypeScript.

Do not return PCM samples to TypeScript. Do not allocate an array proportional to audio duration.

Emit waveform progress based on sample presentation time divided by duration. Clamp progress and handle unknown duration defensively.

---

## 14. Project repository and stores

### 14.1 `ProjectRepository`

Expose:

```ts
initialize(): Promise<void>;
list(): DanceProject[];
get(projectId: string): DanceProject | null;
createFromImportedFiles(input: CreateProjectInput): Promise<DanceProject>;
rename(projectId: string, name: string): Promise<void>;
updateSegments(projectId: string, segments: DanceProject['segments']): Promise<void>;
updatePreferences(
  projectId: string,
  preferredRate: PlaybackRate,
  lastSelectedSegment: SegmentNumber | null,
): Promise<void>;
delete(projectId: string): Promise<void>;
```

Validate every loaded and saved object with Zod. Do not pass an unvalidated JSON object into app state.

### 14.2 Project name validation

- Trim leading and trailing whitespace.
- Require 1 to 80 visible characters.
- Replace control characters.
- Permit duplicate project names because IDs provide identity.
- Use the selected file name without extension as the default when available.

### 14.3 `useProjectStore`

Store project metadata and loading/error state. File I/O remains in `ProjectRepository`. Do not put video/audio binary data into Zustand.

### 14.4 `usePlaybackStore`

Store the latest native playback snapshot, selected project, selected segment, selected rate, and UI command state. Native events are the source of truth for current playback time and state.

Do not simulate time with a JavaScript timer.

---

## 15. Screens and exact behavior

Use simple, large controls with a clean iOS appearance. Avoid crowded cards, tiny text, gradients, decorative animation, or a complex design system.

Centralize visible strings in `src/constants/copy.ts`. Version 1 may display English only.

### 15.1 Project list: `app/index.tsx`

Header:

```text
DanceCue                                      +
```

Project row content:

```text
Project name
03:21 · 4 of 6 segments
```

Behavior:

- Tap `+` to begin the import flow.
- Tap a project to open it.
- Swipe or use a context menu for Rename and Delete.
- Delete requires confirmation and stops playback first when the project is loaded.
- Sort by `updatedAtIso`, newest first.
- Display an empty state when no projects exist.

Import flow:

1. Request photo permission before opening the picker.
2. Pick one video.
3. Validate size and storage.
4. Present a naming sheet with a prefilled name.
5. Begin import only after the user confirms the name.
6. Show import progress.
7. On success, navigate to the new project.
8. On failure, remain on the list and display the mapped error.

Prevent starting a second import while one is active.

### 15.2 Project practice screen: `app/project/[projectId]/index.tsx`

Header:

```text
< Back       Project name                         gear
```

Body order:

1. Four speed buttons in one horizontal row.
2. Three rows of two segment buttons.
3. Optional small range/current-time text.
4. A large bottom play/pause button.

Speed buttons:

- Equal width.
- Minimum height 60 points.
- Labels: `1.0x`, `0.9x`, `0.8x`, `0.7x`.
- Default is the project's saved `preferredRate`, initially `1.0x`.
- Selected button has a clear filled state.
- Changing speed during playback applies immediately.
- Save the selected speed to project metadata.

Segment buttons:

- Six fixed positions, three rows by two columns.
- Label `Segment 1` through `Segment 6`.
- Configured buttons may show the saved range in smaller text.
- Unconfigured buttons are gray, disabled, and not focusable as an action.
- Selected configured segment has a clear selected state.
- Selecting a new segment pauses current playback, calculates the lead-in start, seeks to it, and marks the player ready.
- Save the last selected segment.

Initial selection:

1. Use the saved last-selected segment if it is still configured.
2. Otherwise select the first configured segment.
3. Otherwise select none and disable the play button.

Play/pause button:

- Large circular or rounded control near the bottom safe area.
- At least 76 by 76 points.
- Disabled when no configured segment is selected or audio is not ready.
- In ready state: starts `playRange(max(0, startMs - 6000), endMs, selectedRate)`.
- In playing state: pauses.
- In paused state: resumes within the active range.
- After range completion: native code seeks back to lead-in start and returns to ready.

Gear button:

- Pause playback.
- Navigate to the segment editor.

### 15.3 Segment editor: `app/project/[projectId]/segments.tsx`

Use a draft copy of the six segments. Do not mutate project metadata until Save succeeds.

Header actions:

```text
Cancel                 Edit Segments                 Save
```

Waveform section:

- Display current time and total duration.
- Draw a symmetric or single-sided waveform using the cached 2,048 values.
- Display a vertical playhead.
- Tap or drag across the waveform to seek.
- Keep the position within `[0, durationMs]`.
- Provide a play/pause button beneath or over the waveform.
- Editor playback defaults to `1.0x`; using the project's selected rate is acceptable only if the UI displays the rate clearly.
- Update the playhead from native events, not a local timer.

Segment rows:

For each of six rows, display:

```text
Segment 1
Start   --:--.-   Set
End     --:--.-   Set
Clear
```

When the user taps a `Set` button:

- Read the latest native current time from the playback store.
- Round to the nearest 100 ms for display and storage.
- Clamp to `[0, durationMs]`.
- Set only the selected endpoint in the draft.
- Give a small visual confirmation.

`Clear` resets both endpoints for the row to `null`.

Time display:

- Editor endpoint display: `m:ss.d`, for example `1:03.2`.
- Main screen range display may use `m:ss`.
- Unset display is exactly `--:--` or `--:--.-` where tenths are shown. Use one consistent format on the editor.

Validation UI:

- A complete row with `startMs >= endMs` is invalid.
- A partial row is invalid.
- Show a short inline message under an invalid row.
- Enable Save only when all six rows are valid.

Cancel/back behavior:

- If the draft matches saved data, exit immediately.
- If the draft differs and is valid, ask `Discard changes?` before leaving.
- If the draft differs and contains a partial or invalid row, tell the user the incomplete draft cannot be saved and offer `Discard and Exit` or `Continue Editing`.
- Exiting by discard must leave the saved project unchanged.

Save behavior:

1. Pause editor playback.
2. Validate all six rows again in domain code.
3. Atomically update project metadata.
4. Return to the project screen.
5. Recalculate enabled segment buttons.

---

## 16. Waveform UI implementation

`WaveformScrubber` receives:

```ts
interface WaveformScrubberProps {
  amplitudes: readonly number[];
  durationMs: number;
  currentTimeMs: number;
  disabled?: boolean;
  onSeekRequested(positionMs: number): void;
}
```

Render with `react-native-svg`.

Do not render all 2,048 bars when the view is only a few hundred pixels wide. Downsample the cached values to a render count based on measured width, with an upper bound near 400 bars.

For each render bar, use the maximum or RMS of the source points covered by the bar. Keep rendering deterministic.

Use a `PanResponder` or another already-installed React Native gesture mechanism. Do not add a heavy gesture dependency only for this control.

During drag:

- Update a local preview playhead for responsive feedback.
- Throttle native seek calls or send one final seek at drag end.
- A tap sends one seek.
- Do not send dozens of native seeks per frame.

Accessibility:

- Give the waveform an accessibility label with current and total time.
- Provide an alternative `-1 second` and `+1 second` pair only if VoiceOver testing shows scrubbing is unusable. The first implementation may use adjustable accessibility actions.

---

## 17. App lifecycle

Implement `useAppLifecyclePause` with React Native `AppState`:

- When state leaves `active`, call native `pause()`.
- Do not auto-resume when the app becomes active.
- Release keep-awake when not playing or importing.
- Keep the screen awake while playback is active and while importing.

When navigating away from a project:

- Pause playback.
- Keep the loaded item only when returning immediately is useful; otherwise unload when the project route unmounts.
- Never allow two screens to issue playback commands concurrently.

When opening a different project:

- Pause.
- Increment command generation inside native code.
- Load the new audio file.
- Reset range state.

---

## 18. Error handling and user messages

Create a typed `AppError` and a mapping from native codes.

Examples:

| Code | User message |
|---|---|
| `E_NO_AUDIO_TRACK` | `This video does not contain a usable audio track.` |
| `E_EXPORT_FAILED` | `DanceCue could not extract audio from this video.` |
| `E_WAVEFORM_FAILED` | `Audio was extracted, but the waveform could not be created. No project was saved.` |
| `E_INSUFFICIENT_STORAGE` | `There is not enough free storage to import this video safely.` |
| `E_CANCELLED` | No error alert; return to the previous state. |
| `E_FILE_NOT_FOUND` | `The project audio file is missing.` |
| `E_PLAYBACK_FAILED` | `DanceCue could not play this project.` |

Log technical context locally in a bounded ring buffer in development builds. Do not send logs to a server.

Add a development-only diagnostics section that shows:

- native module availability;
- current player state;
- loaded file URI with the home-container prefix redacted;
- audio duration;
- current time;
- free disk space;
- last native error code;
- project schema version.

The diagnostics section may be reached by a long press on the `DanceCue` title in development builds. It must not interfere with normal use.

---

## 19. Concurrency and cancellation

### 19.1 Import tasks

Track active native tasks by `taskId`.

- `extractAudio` registers an export session or fallback task.
- `generateWaveform` registers a reader task.
- `cancelTask(taskId)` marks the task cancelled and calls the native cancellation API.
- Remove the task from the registry in a `defer` block.
- Ignore late progress events after the TypeScript coordinator has finished or cancelled the task.

### 19.2 Playback commands

Use native command generations as described earlier. TypeScript may also use a monotonically increasing UI command ID, but the native controller remains the final protection against stale seeks.

Disable repeated action buttons while a command that changes the loaded item is pending. Play/pause may be debounced at approximately 150 ms to protect against accidental double taps, but do not make the UI feel slow.

---

## 20. Testing requirements

### 20.1 TypeScript unit tests

Implement tests for:

1. Six new segments are all unset.
2. Fully unset segment is valid.
3. Start-only segment is invalid.
4. End-only segment is invalid.
5. Equal start and end are invalid.
6. Start greater than end is invalid.
7. End beyond duration is invalid.
8. Overlap between different segments remains valid.
9. Lead-in calculation clamps to zero.
10. Lead-in remains six source seconds for every rate.
11. Time formatting around minute boundaries.
12. Project JSON validation and backup recovery.
13. Project name trimming and length validation.
14. Main screen disables unconfigured segment buttons.
15. Save is disabled for a partial editor row.

### 20.2 Native implementation checks

Codex cannot fully run iOS native tests on Windows without a cloud build. Still structure Swift code so pure validation and waveform helpers can be unit tested later. At minimum, require EAS compilation with no Swift errors or warnings caused by unsafe optional handling.

### 20.3 Manual iPhone test matrix

The implementation is not complete until the following are tested on a physical iPhone:

#### Import

- 20–50 MB local video with audio.
- 250–350 MB local video with audio.
- Video close to 600 MB.
- Video larger than 600 MB is rejected.
- iCloud-only video downloads and imports.
- Video without audio gives the correct message.
- User cancels picker.
- User cancels during extraction.
- User cancels during waveform generation.
- Low-storage condition is rejected before extraction.
- App is briefly backgrounded during import.
- App is force-closed during import and cleans staging on next launch.

#### Project persistence

- Imported project survives app restart.
- Original source video can be deleted from Photos and project still plays.
- Rename survives restart.
- Project delete removes files and metadata.

#### Segment editor

- All six rows start unset.
- Set current time while playing.
- Set current time while paused.
- Clear a segment.
- Overlapping segments save.
- Start-only row prevents save.
- End-only row prevents save.
- Start equal to end prevents save.
- Invalid draft is discarded without modifying saved values.
- Waveform tap and drag seek correctly.

#### Playback

- Every speed works: 1.0x, 0.9x, 0.8x, 0.7x.
- Pitch remains usable for music.
- A segment beginning at 3 seconds plays from zero.
- A segment beginning at 63 seconds plays from 57 seconds.
- Playback stops at the configured end.
- After completion, the next play starts from the lead-in start.
- Speed changes during playback without jumping.
- Rapidly switch segments and confirm no stale segment starts.
- Rapidly tap play/pause and confirm no crash.
- Open settings during playback and confirm playback pauses.
- Disconnect headphones and confirm playback pauses.
- Simulate a call/interruption and confirm playback pauses.
- Put app in background and confirm playback pauses.

#### Offline preview

- Install a Preview build.
- Enable airplane mode.
- Relaunch app.
- Import a local video, edit segments, and play every speed without a computer or Metro server.

---

## 21. Build and code-quality commands

Add package scripts similar to:

```json
{
  "scripts": {
    "start": "expo start",
    "typecheck": "tsc --noEmit",
    "lint": "expo lint",
    "test": "jest --runInBand",
    "doctor": "expo-doctor"
  }
}
```

Before every EAS build, run:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

Fix errors instead of suppressing them. Do not use `any` for project models or native event payloads. Do not disable TypeScript strict mode.

---

## 22. Development and EAS behavior

Expo Go cannot run this app because Expo Go does not contain the custom `DanceAudio` Swift module.

Use a development build:

```powershell
eas build --platform ios --profile development
```

After the development build is installed on the iPhone, TypeScript and JavaScript edits can be tested with:

```powershell
npx expo start
```

Use a tunnel when local networking or Windows Firewall blocks the connection:

```powershell
npx expo start --dev-client --tunnel
```

A new EAS development build is required after any of the following:

- Swift code changes;
- native module configuration changes;
- adding or upgrading a package with native code;
- app config changes that affect Info.plist or native projects;
- Expo SDK upgrades.

A new EAS build is not required for ordinary TypeScript, JavaScript, style, or copy changes while using the development client.

Create a standalone internal build for daily offline testing:

```powershell
eas build --platform ios --profile preview
```

The Preview build bundles the JavaScript code and does not require Metro.

---

## 23. Implementation phases

Codex should implement in the following order and keep the app buildable after each phase.

### Phase 1 — Project shell and data model

- Create Expo project and dependencies.
- Add app configuration and EAS configuration.
- Implement domain types, validation, time formatting, storage layout, repository, and unit tests.
- Build the project list with temporary mock projects only during this phase.
- Remove all mock persistence before Phase 2 is complete.

### Phase 2 — Native module skeleton

- Create the local Expo module.
- Add typed methods and events.
- Add native error codes.
- Implement a minimal native health check.
- Confirm one EAS development build compiles and the module loads.

### Phase 3 — Audio import

- Implement picker, size limit, free-space rule, project naming, extraction, fallback transcoding, waveform generation, progress, cancellation, transaction commit, and recovery.
- Confirm a project remains after restart and the source video is not needed.

### Phase 4 — Playback controller

- Implement audio session, player load, state events, exact allowed rates, range playback, boundary observer, defensive end check, pause/resume, seek, interruption, route change, lifecycle pause, and observer cleanup.

### Phase 5 — Practice screen

- Implement speed buttons, segment grid, selection, disabled state, lead-in playback, large play/pause button, and saved preferences.

### Phase 6 — Segment editor

- Implement waveform renderer, scrub behavior, editor playback, six draft rows, set-current-time controls, validation, discard behavior, and atomic save.

### Phase 7 — Hardening

- Complete tests.
- Add recovery and diagnostics.
- Run the full manual matrix.
- Remove unused code, mock data, console spam, and unsupported platform branches.
- Create a Preview build and test in airplane mode.

---

## 24. Definition of done

Version 1 is done only when all conditions below hold:

- The repository builds through EAS for a physical iPhone.
- The app does not depend on Expo Go.
- A Preview build opens and works without Metro or network access.
- A selected video up to 600 MB is processed without loading media bytes into JavaScript.
- The original video is not retained after successful import.
- M4A audio and waveform data persist locally.
- Every project has exactly six segment records.
- Partial segment records cannot be saved.
- Overlapping valid segments can be saved.
- Unconfigured segment buttons are disabled and gray.
- All four speeds work.
- Range playback starts six source seconds early, clamped at zero.
- Range playback stops at the configured end and resets to the lead-in start.
- Rapid user actions do not start a stale range or crash the app.
- Time observers and notification observers are cleaned up.
- Headphone removal, interruptions, and app backgrounding pause playback.
- Unit tests, lint, type checking, and Expo Doctor pass.
- The physical-device manual test matrix has no release-blocking failure.

---

## 25. Prohibited shortcuts

Do not:

- use Expo Go as the final development target;
- implement extraction in JavaScript;
- read a 600 MB file with `Data`, `arrayBuffer`, or Base64 in React Native;
- store the source video;
- use a JavaScript timer to decide when segment playback stops;
- use six independent player objects;
- create a new player for every play press;
- save a partially configured segment;
- reject valid overlapping segments;
- place final audio in Cache;
- keep a project entry after an import failure;
- silently ignore native errors;
- add a network service;
- use deprecated Expo FileSystem functions from the main import when the modern API is available;
- add FFmpeg or another large media framework without explicit user approval;
- publish to the App Store;
- claim Android support in version 1.

---

## 26. Reference documentation

Use official documentation as the primary source while implementing:

- Expo project creation: https://docs.expo.dev/get-started/create-a-project/
- Expo development builds: https://docs.expo.dev/develop/development-builds/introduction/
- EAS Build: https://docs.expo.dev/build/introduction/
- iOS development build on a physical device: https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/
- Internal distribution: https://docs.expo.dev/build/internal-distribution/
- Local Expo modules: https://docs.expo.dev/modules/get-started/
- Expo Modules API: https://docs.expo.dev/modules/module-api/
- Expo ImagePicker: https://docs.expo.dev/versions/latest/sdk/imagepicker/
- Expo FileSystem: https://docs.expo.dev/versions/latest/sdk/filesystem/
- Apple AVAssetExportSession: https://developer.apple.com/documentation/avfoundation/avassetexportsession
- Apple export presets: https://developer.apple.com/documentation/avfoundation/export-presets
- Apple AVAssetReader: https://developer.apple.com/documentation/avfoundation/avassetreader
- Apple AVPlayer: https://developer.apple.com/documentation/avfoundation/avplayer/
- Apple boundary time observer: https://developer.apple.com/documentation/avfoundation/avplayer/addboundarytimeobserver(forTimes:queue:using:)
- Apple audio time-pitch algorithm: https://developer.apple.com/documentation/avfoundation/avplayeritem/audiotimepitchalgorithm
- Apple spectral algorithm: https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm/spectral

