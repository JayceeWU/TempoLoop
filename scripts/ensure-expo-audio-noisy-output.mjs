import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const playerSourcePath = resolve(
  process.cwd(),
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt',
);
const moduleSourcePath = resolve(
  process.cwd(),
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt',
);

function applyExactPatch(sourcePath, original, configured, label) {
  const source = readFileSync(sourcePath, 'utf8');

  if (source.includes(configured)) {
    return;
  }

  const occurrences = source.split(original).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Unsupported expo-audio source layout for ${label}: expected one marker, found ${occurrences}.`,
    );
  }

  writeFileSync(sourcePath, source.replace(original, configured), 'utf8');
}

const audioAttributes = '.setAudioAttributes(AudioAttributes.DEFAULT, false)';
applyExactPatch(
  playerSourcePath,
  audioAttributes,
  `${audioAttributes}\n    .setHandleAudioBecomingNoisy(true)`,
  'headphone-disconnect handling',
);

const replaceMediaSource = `            mediaSource?.let {
              player.setMediaSource(it)
              if (wasPlaying) {
                if (!shouldPlayInSilentMode()) {
                  return@runOnMain
                }
                if (!focusAcquired) {
                  requestAudioFocus()
                }
                player.ref.play()
              }
            }`;

applyExactPatch(
  moduleSourcePath,
  replaceMediaSource,
  `${replaceMediaSource} ?: run {
              // AudioSource explicitly includes null. Clear Media3 so a
              // staging file can be atomically renamed after validation.
              player.ref.stop()
              player.ref.clearMediaItems()
            }`,
  'replace(null) source clearing',
);
