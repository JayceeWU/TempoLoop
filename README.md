# TempoLoop

TempoLoop is a private, offline iPhone app for dance practice. It imports one video from Photos, extracts its audio into the app sandbox, lets you define six independent (and optionally overlapping) practice segments, and plays a selected segment at `1.0x`, `0.9x`, `0.8x`, or `0.7x`.

Version 1 is English-only, iPhone-only, and designed for one local user. It has no accounts, telemetry, cloud synchronization, server component, background audio, lock-screen controls, or Android implementation.

## Architecture

- Expo SDK 57, Expo Router, React Native, and strict TypeScript provide the app shell and UI.
- The Apple-only local Expo module `DanceAudio` uses AVFoundation for extraction, waveform generation, and playback.
- One native `AVPlayer` remains loaded while a project is in use. Native command generations, time observers, interruption handling, and a boundary observer protect range playback from stale commands and overshoot.
- Media bytes never pass through JavaScript. JavaScript exchanges only local `file://` URIs, bounded waveform JSON, and small metadata objects with Swift.
- Project data is validated with Zod and committed through temporary files, reread validation, backup, and atomic moves.
- Final project data lives under `Documents/TempoLoop/Projects/<project-id>/`. Picker-owned videos and import staging remain in Cache and are cleaned after completion, cancellation, failure, or launch recovery.

## Important: Expo Go is not supported

Expo Go does not contain the custom `DanceAudio` Swift module. Use an EAS development build or Preview build. A missing native module is treated as an error; the production app never falls back to a simulated or JavaScript player.

## Local setup and Windows checks

Install exactly from the committed lockfile:

```powershell
npm ci
```

Run the complete Windows quality suite:

```powershell
npm run typecheck
npm run lint
npm test
npx expo-doctor
npm run format
```

These checks cover the TypeScript domain, repositories, recovery, import coordinator, UI behavior, playback mocks, waveform logic, and static native-module contract. Windows cannot compile Swift/AVFoundation or validate iPhone audio behavior.

## Development build

An Expo/EAS account, Apple signing access, and a registered iPhone are required for the native build:

```powershell
eas build --platform ios --profile development
```

Install that build on the iPhone, then start Metro for TypeScript/UI iteration:

```powershell
npm start
```

If local networking is blocked:

```powershell
npx expo start --dev-client --tunnel
```

Create a standalone internal build for offline testing:

```powershell
eas build --platform ios --profile preview
```

The Preview build bundles JavaScript and should be tested after enabling airplane mode and relaunching without Metro.

A new native build is required after Swift changes, native module configuration changes, native dependency changes, Expo SDK upgrades, or app configuration changes that affect iOS.

## Physical-iPhone validation still required

Before treating version 1 as release-ready, verify on a physical iPhone:

- EAS development and Preview compilation, Swift warnings, and `DanceAudio` automatic linking.
- Local and iCloud-only imports from roughly 20 MB through the 600 MB limit, cancellation, low storage, force-close recovery, and the import memory target.
- Persistent playback after deleting the original Photos video.
- All four rates with useful pitch preservation, exact six-second source-time lead-in, range completion/reset, and no more than 100 ms audible overshoot under normal conditions.
- Rapid segment and play/pause actions, headphone removal, calls/audio interruptions, foreground/background transitions, and media-services reset.
- A full import/edit/play flow in a Preview build while airplane mode is enabled.

Do not infer those results from the Windows test suite; they require Apple’s macOS build environment and real iPhone hardware.

## Product configuration

- Display name: `TempoLoop`
- Expo slug/package name: `tempo-loop`
- URL scheme: `tempoloop`
- iOS bundle identifier: `com.jipeng.tempoloop`
- Minimum iOS version: 16.4
- Orientation: portrait
- Remote Expo updates: disabled

The Photos permission is used only to choose a video for local audio extraction. TempoLoop does not send project data or logs anywhere.
