# TempoLoop

TempoLoop is a private, offline Android 7.0+ dance-practice app. It can extract music from a gallery video or directly import an audio file, normalize the result to an audio-only M4A in the app sandbox, and let one local user define nine independent, overlapping practice segments. Each segment can play at `1.0x`, `0.9x`, `0.8x`, `0.7x`, or `0.6x`, with a per-project lead-in of `0`, `2`, `4`, or `6` seconds.

Version 1 is Android-only, English-only, and portrait-only. It has no account, analytics, cloud sync, server, background playback, lock-screen controls, broad media-library access, or Google Play release flow.

## Why TempoLoop

TempoLoop is especially useful for dance teachers during class. Preparing the music segments before a lesson removes the need to repeatedly search for the correct point in a song while students are waiting. A teacher can select a prepared section, choose an appropriate playback speed and lead-in, and repeat that section with another press of Play. This keeps lessons moving, gives students more focused practice time, improves teaching efficiency, and creates a smoother, more satisfying class experience.

## Current practice workflow

1. Use `Extract from Video` to choose a gallery video, or `Import Audio` to choose a supported audio file.
2. Name the Project. TempoLoop creates and validates a private `audio.m4a` copy, then opens the Project immediately. It builds the 2,048-sample waveform asynchronously while TempoLoop remains in the foreground; the selected source is never modified.
3. Open `Edit Segments` and define up to nine independent ranges. Overlapping ranges are allowed, while incomplete or invalid ranges cannot be saved.
4. On the practice screen, choose one of five playback speeds and a `0`, `2`, `4`, or `6` second lead-in.
5. Press Play to start from `max(0, segment start - lead-in)` and stop at the saved segment end. Pressing Pause resets the range to that same start position, so the next Play begins from the start instead of resuming from the paused position. Segment completion also resets the range for another repetition.

The Segment Editor keeps its audio controls fixed above the scrolling nine-segment list. Its compact purple waveform shows a 30-second window by default, supports pinch zoom from 10 to 30 seconds, and includes a full-track overview for moving the visible window. Editor playback remains at `1.0x`, and pausing in the editor retains the current position so it can be captured as a segment endpoint.

## Architecture

- Expo SDK `57.0.9`, React Native `0.86.2`, Expo Router, strict TypeScript, Zustand, Zod, and `@expo/ui` provide the application shell, screens, state, validated metadata, and the discrete native lead-in slider.
- `Extract from Video` uses a permission-free native gallery picker. It prefers Android Photo Picker, falls back to the device gallery on older phones, then falls back to a video document picker initialized at `Internal storage/Pictures/Screenshots` when possible.
- `Import Audio` uses `expo-document-picker` `57.0.1` with audio MIME types plus the opaque/ISO-segment MIME types used by Android providers for `.m4s`, and `copyToCacheDirectory: false`. Common MP3, M4A/AAC, WAV, FLAC, and OGG/Opus sources work when the device supplies the required decoder. An `.m4s` file whose contents are actually MP3 is accepted based on its native audio track, not its extension.
- Both paths return only an opaque `content://` or local `file://` source. JavaScript never opens, copies, converts, or deletes the selected media.
- The Android-only local Expo module `TempoLoopMedia` uses `ContentResolver`, MediaExtractor/MediaCodec, and Media3 Transformer to identify the source, enforce the 600 MiB video or 200 MiB audio limit, and export AAC/M4A. A separate low-priority foreground task decodes the private audio and produces exactly 2,048 normalized RMS samples using deterministic stratified sampling capped at 256 PCM frames per bin. It does not pass media bytes through JavaScript.
- `expo-audio` `57.0.3` owns the single application player. The editor and practice routes borrow that player through one root provider; import validation borrows the same instance instead of creating another player.
- A fail-fast postinstall patch enables Media3's `setHandleAudioBecomingNoisy(true)` and fixes SDK 57.0.3's Android `replace(null)` bridge by making its `AudioSource` parameter nullable, then synchronously calling `stop` plus `clearMediaItems`. The first change handles headphone or Bluetooth output loss; the second releases import staging files before their atomic rename. It configures the installed player and does not introduce a custom Kotlin player.
- TempoLoop never sends `replace(null)` merely because an already-empty player is idle. It clears Media3 only after import validation has attached a staging source or when the playback coordinator owns a loaded Project source; this avoids device-specific empty-source bridge failures without weakening transactional cleanup.
- `PlaybackCoordinator` serializes source, mode, segment, seek, rate, exit, and reset commands with generation tokens. `SegmentEndGuard` uses the 50 ms native status stream and one rate-adjusted deadline fallback; it does not poll with `setInterval`.
- The coordinator rejects unsolicited native restarts after focus loss or foreground return; only a new explicit user Play action authorizes playback. Practice Pause prepares the selected range from its lead-in again, while editor Pause intentionally retains the current timestamp.
- Project metadata and waveform JSON are Zod-validated and transactionally written. A playable Project becomes visible after its exported audio is load-validated and its import directory is atomically finalized with `waveformStatus: pending`. Waveform generation then writes `waveform.json` before atomically changing the status to `ready`; failure retains the audio and exposes a retry action.
- The interface uses a fixed deep-purple theme (`#120A24` background and `#A970FF` accent), including the app icon, adaptive icon, splash screen, controls, and waveform editor.

Final data is stored under:

```text
Documents/TempoLoop/projects/<project-id>/project.json
Documents/TempoLoop/projects/<project-id>/audio.m4a
Documents/TempoLoop/projects/<project-id>/waveform.json
```

`waveform.json` is temporarily absent while `waveformStatus` is `pending`, and can remain absent when generation is `failed`; neither state prevents playback or Segment editing. A `ready` Project with a missing or invalid waveform is still reported as needing repair. TempoLoop cancels foreground waveform work when the app backgrounds and resumes pending Projects serially on the next foreground launch. To protect older phones from decoder contention, another import cannot begin until the active/pending waveform task finishes or fails.

In-progress data uses `Documents/TempoLoop/imports/.import-<project-id>/`. TempoLoop never modifies the provider-owned source video or audio file. Missing or invalid project media is retained as a repair entry so the user can delete it explicitly.

## Native dependency baseline

The committed lockfile currently resolves:

| Dependency           | Exact version |
| -------------------- | ------------- |
| Expo                 | `57.0.9`      |
| React Native         | `0.86.2`      |
| expo-audio           | `57.0.3`      |
| expo-document-picker | `57.0.1`      |
| @expo/ui             | `57.0.8`      |

Installed `expo-audio` declares Media3 `1.9.0`. `TempoLoopMedia` derives its Transformer dependency from that installed Gradle declaration rather than hard-coding a separate version. The actual Gradle graph is **Not initialized/tested** in the current Windows environment because no JDK or Android SDK is installed; CI's `verifyMedia3Versions` task must resolve exactly one Media3 version, `1.9.0`, before the debug build can pass.

## Expo Go is not supported

Expo Go does not include `TempoLoopMedia`. Use a TempoLoop development APK or Preview APK. Production code has no JavaScript media-processing fallback, FFmpeg fallback, server fallback, or retained-iOS-module fallback.

## Install and run quality checks

Use Node 22, which is also used by GitHub Actions, and install exactly from the lockfile:

```powershell
npm ci
```

Run the complete JavaScript/TypeScript quality suite:

```powershell
npm run typecheck
npm run lint
npm run cpd
npm run audit
npm test
npm run format
npm run doctor
```

CPD scans the active `app`, `src`, `modules/tempoloop-media/src`, and `modules/tempoloop-media/android/src/main` code with a 3% threshold. When CPD fails in GitHub Actions, its HTML report is uploaded as the `copypaste-report` artifact.

The Android native CI job uses Temurin 17 to generate an uncommitted Android project, run Kotlin unit tests, verify Media3 alignment, and assemble a debug APK:

```bash
npx expo prebuild --platform android --no-install --clean
cd android
./gradlew :tempoloop-media:testDebugUnitTest --stacktrace --no-daemon
./gradlew :tempoloop-media:verifyMedia3Versions --stacktrace --no-daemon
./gradlew :app:assembleDebug --stacktrace --no-daemon
./gradlew :tempoloop-media:assembleDebugAndroidTest --stacktrace --no-daemon
```

The generated root `/android` directory is intentionally ignored and must not be committed.

## Development APK and Metro

Creating an EAS development build requires an Expo account and initialized EAS project:

```powershell
npm run eas -- project:info
npm run eas -- build --platform android --profile development
```

The `eas` script pins only the temporary EAS config parser to `eas-cli@21.4.0` and
`typescript@5.9.3`. This avoids a current `typescript@7`/EAS dynamic-config incompatibility while
the TempoLoop application itself continues to use the TypeScript version in `package-lock.json`.
The wrapper also sets `EAS_NO_VCS=1` because repeated Windows file locks prevented EAS from
removing its temporary Git shallow clone. The expected no-VCS warning is safe for this workflow;
the upload still uses the project root and its `.gitignore` rules.

Install the resulting internal APK, then start Metro:

```powershell
npm start
```

If the phone cannot reach the computer on the local network:

```powershell
npx expo start --dev-client --tunnel
```

Rebuild the APK after any Kotlin or native module change, native dependency change, Expo config-plugin change, `app.config.ts` native setting change, Expo SDK upgrade, or React Native upgrade. TypeScript, styling, and ordinary screen changes can normally reload through Metro without rebuilding native code.

## Preview APK and offline verification

Create the internal Preview APK with:

```powershell
npm run eas -- build --platform android --profile preview
```

Remote Expo updates are disabled, so Preview bundles its JavaScript. Verify it by force-closing TempoLoop, enabling airplane mode, relaunching without Metro, and completing import, segment editing, and practice playback.

To preserve existing private projects during an upgrade, install a newer APK over the existing app with the same `com.tempoloop.app` application ID and compatible signing key. With ADB this is normally:

```powershell
adb install -r path\to\tempoloop.apk
```

Do not uninstall the app, clear its storage, change the package ID, or sign the replacement with an incompatible key; those actions can remove or make the existing sandbox inaccessible. Back up important source material separately because TempoLoop v1 has no sync or export feature.

## Retained iPhone prototype

> `modules/dance-audio` contains the retained Swift/AVFoundation implementation from the earlier iPhone prototype. TempoLoop Android v1 does not import, compile, link, or call it. It is not a fallback and is not covered by Android release validation.

Its Expo module configuration is Apple-only. Android autolinking registers only `expo.modules.tempoloopmedia.TempoLoopMediaModule`, and Android product-quality CPD excludes the retained prototype.

## Release validation still required

Development APKs have successfully completed EAS builds and have been installed during development. That confirms cloud compilation for those snapshots, but it does not validate every current working-tree change or satisfy the full physical-device acceptance matrix. A new native build is required whenever the Kotlin module, native dependency patches, or native Expo configuration changes.

- A Preview APK build and the complete airplane-mode Preview workflow.
- A fresh Development APK containing the current working tree, followed by clean and upgrade installation checks.
- Gallery video selection and cancellation on the target Honor phone, including a video under `Internal storage/Pictures/Screenshots`.
- Direct MP3/M4A/WAV/FLAC/OGG/Opus import, MP3 content renamed to `.m4s`, and cancellation from local providers.
- `content://` imports including approximately 20 MB, 200–300 MB, and 550–600 MiB videos, plus audio at and above the 200 MiB limit.
- AAC video, video without audio, very short audio, silence, stereo, malformed media, DRM, cancellation, low storage, and force-close recovery.
- Import and playback memory targets, start latency of 300 ms or less, and persistent playback after the original video is deleted.
- All five rates, useful pitch correction, every `0/2/4/6` second source-time lead-in, Pause-to-range-start behavior, and segment-end overshoot of 100 ms or less.
- Rapid commands, calls/audio-focus loss, headphone and Bluetooth disconnects, background/foreground transitions, and no automatic resume.
- Coverage installation with private data retained and a complete Preview flow in airplane mode.

Record real device model, Android version, measurements, Media3 resolution, and acceptance outcomes in the local ignored file `.agent/IMPLEMENTATION_NOTES.md`; never substitute estimated results.

## Troubleshooting

- **`TempoLoopMedia` is missing:** install a freshly rebuilt development APK. Expo Go and an APK built before the module was added cannot load it.
- **Metro cannot connect:** keep the phone and computer on the same network or start the dev client with `--tunnel`.
- **APK cannot update:** confirm `com.tempoloop.app` and the signing key match the installed build. Uninstall only if losing local data is acceptable.
- **A gallery video is missing:** confirm Android has indexed it, then retry `Extract from Video`. The final fallback opens the system file browser near `Pictures/Screenshots` on Android 8+.
- **One source will not import:** retry with a common unprotected MP4/MOV video or a device-decodable MP3, M4A/AAC, WAV, FLAC, or OGG/Opus audio file. Renamed `.m4s` files are supported only when native inspection finds a valid decodable audio track. Preserve the stable error code when reporting a failure.
- **A second import or Project deletion fails until the app restarts:** run `npm ci` so the fail-fast Expo Audio 57.0.3 postinstall patch is applied, then build and install a new Development or Preview APK over the existing app. Metro reloads cannot apply this native bridge fix. Do not uninstall first if the existing private Projects must be retained.
- **Waveform is still building:** the Project is already playable and its Segment times can be edited. Keep TempoLoop in the foreground until the status changes to `Waveform ready`. If it changes to `Waveform unavailable`, open the Segment Editor and use the retry action.
- **Slow playback changes pitch:** verify `shouldCorrectPitch` is enabled and test a freshly rebuilt APK with the lockfile's `expo-audio` version.
- **A segment stops late:** record rate, device model, source format, and measured overshoot in `IMPLEMENTATION_NOTES.md` before considering the contract's isolated native boundary guard.

## Product configuration

- Display name: `TempoLoop`
- npm package: `tempo-loop`
- Expo slug: `tempoloop`
- URL scheme: `tempoloop`
- Android application ID: `com.tempoloop.app`
- Minimum Android version: Android 7.0 (API 24, Expo SDK 57 default)
- App version: `1.0.0`
- Android version source: EAS remote auto-increment; the local `versionCode: 1` is only a manifest placeholder and is ignored when EAS assigns a remote build number
- Orientation: portrait
- Remote Expo updates: disabled
- EAS profiles: internal `development` APK and internal `preview` APK only

TempoLoop requests no camera, microphone, broad storage, or broad media-library permission. Android grants access only to the gallery video or audio file explicitly selected by the user, and TempoLoop sends no media, project data, or logs over the network.
