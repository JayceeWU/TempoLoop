# TempoLoop implementation notes

## Dependency baseline

- Expo SDK: `57.0.9` (resolved from `package-lock.json`).
- React Native: `0.86.2` (resolved from `package-lock.json`).
- `expo-audio`: expected and resolved as `57.0.3`.
- `expo-document-picker`: expected and resolved as `57.0.1`.
- Expo SDK 57's installed `ExpoConfig` type no longer exposes `newArchEnabled`; the obsolete
  flag is omitted rather than disabling the SDK's required New Architecture baseline.

## Storage transaction adaptation

- Expo FileSystem's modern Android `move(..., { overwrite: true })` may remove an existing
  destination before moving the replacement. Existing JSON updates therefore use a verified
  sibling `.tmp` plus a verified `.bak` journal. The backup remains available until the new
  destination is reread successfully, and launch recovery restores it after an interrupted
  replacement. This strengthens the durability intent of Android contract section 11.2 while
  retaining the required modern Expo FileSystem API.
- A directory `move` may internally fall back to copy-and-delete. Import finalization therefore
  writes and rereads a small `import.json` transaction journal before moving a directory that
  contains only `project.json.tmp`. The journal records the Project ID, duration, and exact
  exported-audio size. `project.json` is promoted only after the source import directory has
  disappeared and the destination audio size, temporary metadata, and journal all match. Project
  discovery treats `project.json` as the visibility commit. Launch recovery commits only a complete
  moved audio directory; a simultaneous source/target pair or a nonempty truncated audio
  copy stays invisible. This is the implementation adaptation for the single-rename visibility
  requirement in section 11.3 without reading or hashing media contents.

## Native and release verification

- The current user-approved import contract supersedes the video-only picker clauses in Android
  contract sections 1, 2, 12, 13, 20, 24, and 25. The home screen now has `Extract from Video`
  and `Import Audio`. Video selection uses a native gallery-first picker without broad storage
  permission; audio uses `expo-document-picker` with `audio/*`, `application/octet-stream`, and
  `video/iso.segment`, with cache copying disabled. The extra MIME types allow Android providers to
  expose `.m4s` files that actually contain MP3 audio; native track inspection remains authoritative.
- `TempoLoopMedia` now exposes `pickGalleryVideo` and `inspectMedia`. Native inspection returns
  authoritative `sourceKind` and applies independent hard limits of 600 MiB for video and 200 MiB
  for audio. Both limits are rechecked during the bounded unknown-size read. Successful video and
  audio sources share the same private AAC/M4A, waveform, load-validation, and atomic commit path.
- The gallery picker prefers `MediaStore.ACTION_PICK_IMAGES`, falls back to `ACTION_PICK` over the
  MediaStore video collection for older/Honor devices, and finally uses `ACTION_OPEN_DOCUMENT`
  initialized at `primary:Pictures/Screenshots` on Android 8+. Picker cancellation resolves to
  `null` and returns the import store to idle. Runtime behavior on the target phone is **Not
  tested** until a rebuilt Development APK is installed.

- The user-approved waveform acceleration contract supersedes the earlier requirement that a
  waveform finish before a Project becomes visible. `importProjectMedia` now returns only validated
  private audio metadata. `generateWaveform` separately uses `waveformBinCount`; the
  `waveformSampleCount` spelling in section 24 remains treated as a documentation typo.
- New Projects commit with `waveformStatus: pending`. Missing waveform data is valid for `pending`
  and `failed` Projects, while a `ready` Project with missing/invalid data still needs repair.
  Foreground generation is serialized, canceled on backgrounding, resumed at startup/foreground,
  and blocks a second import until it reaches `ready` or `failed`. Generation failure never deletes
  the already committed audio and can be retried from the Segment Editor.
- Waveform PCM reduction now deterministically samples at most 256 frames per bin (524,288 total
  for the fixed 2,048-bin schema), accumulates channel energy directly, and performs square root
  only once per final bin. It retains p95 normalization, gap filling, finite `[0,1]` output, and
  exact 2,048-point shape. Physical-device speedup and UI/playback smoothness are **Not tested**.
- Phase 2 Android prebuild and Expo Modules autolinking resolution find
  `expo.modules.tempoloopmedia.TempoLoopMediaModule`. EAS Development build
  `56bb129d-d451-47f1-ab5f-c241813f9267` compiled the Kotlin module and produced build 15 on
  2026-08-01. Local Gradle unit tests and physical-device `content://` inspection remain **Not
  initialized/tested** because this Windows environment has no JDK or Android SDK.
- Installed `expo-audio` declares Media3 `1.9.0`; `TempoLoopMedia` derives its Transformer
  dependency from that installed declaration and `verifyMedia3Versions` rejects requested or
  resolved drift. The EAS Development build resolved and compiled this dependency graph. The
  dedicated `verifyMedia3Versions` task remains **Not tested locally** because `JAVA_HOME` is unset
  and no `java` executable is available on `PATH`.
- Phase 3 Media3 Transformer, bounded unknown-size scan, storage estimator, MediaCodec waveform,
  cancellation ordering, and Kotlin JUnit sources are implemented. Kotlin compilation passed in
  EAS build `56bb129d-d451-47f1-ab5f-c241813f9267`; Kotlin JUnit execution remains **Not
  initialized/tested locally** and remains an Android CI gate.
- Phase 4 originally used one Android Document Picker request. The current gallery-video/audio-file
  adjustment replaces that selection surface while retaining no-copy opaque URIs. Import validation
  borrows the root singleton `expo-audio` player and accepts only a post-`replace` native status
  event, so stale status from a previous Project cannot commit an unloadable partial. Project
  discovery has no global index and retains damaged Projects with repair diagnostics.
- Phase 5 uses a six-row deep-copy draft, exact integer-millisecond capture, shared Android dirty
  navigation protection, and a two-Path SVG waveform scrubber. Phase 6 uses a singleton
  `expo-audio` player, command generations, a 30 ms segment-end guard, one fallback deadline, and
  source-time lead-in. Native restarts after focus/background interruption are rejected until an
  explicit user Play command.
- The installed Expo Audio Android player does not enable Media3 noisy-output handling by default.
  A fail-fast postinstall script configures its existing ExoPlayer with
  `setHandleAudioBecomingNoisy(true)`. This remains `expo-audio` playback; it does not add a custom
  Kotlin player. The script fails when the expected SDK source layout changes so an Expo Audio
  upgrade cannot silently lose headphone/Bluetooth disconnect protection.
- Phase 7 adds privacy-bounded development diagnostics, Android-only CPD/static policy auditing,
  generated MediaCodec/MediaMuxer instrumentation fixtures, and separate GitHub Actions quality
  and Android-native jobs. The normal CI job compiles the instrumentation APK but does not claim to
  execute device tests.
- Final Windows checks on 2026-07-31: clean `npm ci` passed and ran postinstall; typecheck, ESLint,
  Prettier, prohibited-implementation audit, Expo Doctor 20/20, and all 35 Jest suites / 214 tests
  passed. CPD reported 0.74% duplicated lines, below the 3% threshold. Android prebuild succeeded,
  and Expo autolinking resolution included `expo.modules.tempoloopmedia.TempoLoopMediaModule` while
  excluding the retained `DanceAudio` module.
- The final Gradle command requested `testDebugUnitTest`, `verifyMedia3Versions`, `assembleDebug`,
  and `assembleDebugAndroidTest`, but stopped before Gradle configuration because `JAVA_HOME` is
  unset and no `java` executable exists. Kotlin compilation, Kotlin JUnit execution, Media3 graph
  resolution, debug APK assembly, and instrumentation APK compilation are therefore **Not
  initialized/tested** locally and remain CI gates.
- EAS project: `@jwu453/tempoloop` (`b2ba5951-4f59-4fdf-83a4-ad1798b8e452`), initialized
  and linked in `app.config.ts`.
- Development builds `7a528e48-b585-47c2-a323-8a9904ac7fc2` and
  `bf652129-5626-4c74-8a4f-78b3e4990707` stopped in dependency installation because the lockfile
  omitted Linux-resolved peer packages `@emnapi/core@1.11.3` and
  `@emnapi/runtime@1.11.3`. They are now explicit development dependencies; local npm 11.6.1
  `npm ci --dry-run --include=dev --include=optional` and the successful EAS build both validate
  the corrected lockfile.
- Development build `e2caeda0-66a9-480b-a737-ce77c9268dc5` passed dependency installation,
  prebuild, autolinking, and reached `:tempoloop-media:compileDebugKotlin`. It failed because
  `Media3AudioExporter` used the internal coroutine continuation APIs `tryResume`,
  `tryResumeWithException`, and `completeResume`. Those calls were replaced with the stable
  `kotlin.coroutines` resume APIs and added to the prohibited-source audit. The replacement EAS
  Development build passed; the Preview APK build remains **Not tested**.
- Waveform-acceleration build `376c29b9-e4e8-4395-a1de-84502fd38516` exposed one Kotlin compiler
  error where a suspending cancellation check was passed to a synchronous PCM callback. The PCM
  loop now checks the native task flag synchronously while `WaveformGenerator` checks coroutine
  cancellation before and during decoding.
- EAS Development build `56bb129d-d451-47f1-ab5f-c241813f9267` (Android build 15) passed
  dependency installation, Expo prebuild/autolinking, `TempoLoopMedia` Kotlin compilation, and
  debug APK assembly. Gradle reported `BUILD SUCCESSFUL`; the resulting Development APK is
  available from the EAS build page. Preview APK and physical-device waveform performance remain
  **Not tested**.
- Test-phone model and Android version: **Not initialized/tested**.
- Segment-end overshoot at `1.0x`: **Not initialized/tested**.
- Segment-end overshoot at `0.9x`: **Not initialized/tested**.
- Segment-end overshoot at `0.8x`: **Not initialized/tested**.
- Segment-end overshoot at `0.7x`: **Not initialized/tested**.
- Known source-format limits: **Not initialized/tested** on a physical Android device.
- Expo Audio SDK 57.0.3 declares JavaScript `AudioSource` as nullable but originally exposed the
  Android `replace` module parameter as non-null. The TempoLoop postinstall patch now changes that
  exact bridge signature to `AudioSource?` and synchronously stops and clears Media3 when passed
  `null`. Import validation must observe the unloaded state before staging is finalized; deletion
  unloads the shared player before removing files. This addresses consecutive import and deletion
  failures that temporarily disappeared after restarting the app. Automated/static validation is
  implemented, but the corrected native bridge and five consecutive mixed imports/deletions are
  **Not tested** on a physical device until a newly rebuilt APK is installed over the existing app.
- Consecutive-import/delete fix checks on 2026-08-02: clean `npm ci` reapplied the native patch;
  typecheck, ESLint, Prettier, prohibited-implementation audit, Expo Doctor 20/20, all 41 Jest
  suites / 279 tests, and CPD at 0.71% passed. Local Gradle remains **Not initialized/tested**
  because Java and `JAVA_HOME` are unavailable. EAS Development build
  `b21d6341-0fd5-415c-8632-15b9344bb79a` (Android build 20) completed successfully and compiled
  the patched Expo Audio Android bridge. The import-start JavaScript hardening loads from the
  current Metro bundle in this Development APK; a new Preview build is still required for a fully
  bundled offline snapshot. The physical-device acceptance sequence remains **Not tested**.
- Preview build 21 (`3b1d4ad7-ec9c-4ee9-b6b2-2514ffd5476c`) failed immediately on the first
  video and audio import on the test phone. Immediate failure proves the newly added transaction-
  start cleanup ran before native inspection/export: it called `replace(null)` on an already-empty
  singleton player. That eager preflight cleanup is removed, and idle coordinator cleanup again
  avoids touching Media3. Strict unload remains after a staging source is actually validated, and
  loaded Project sources are still unloaded before deletion. Replacement Preview build 22
  (`a73f2202-4d5b-494b-a8e7-1f9a802a49b4`) completed successfully; physical-device import and
  deletion results remain **Not tested** until that APK is installed.
- Practice timing now supports `0/2/4/6/8` second lead-ins. When a Segment begins too close to the
  source start to supply the full lead-in, the JavaScript playback coordinator fills only the
  missing wall-clock duration with a silent visual countdown before starting at source time zero.
  Reaching the saved Segment end starts a fixed two-second wall-clock post-roll; speed changes do
  not restart that deadline, and natural media completion may end it early. The editor waveform
  default and maximum viewport are now 60 seconds, with the existing 10-second minimum zoom.
