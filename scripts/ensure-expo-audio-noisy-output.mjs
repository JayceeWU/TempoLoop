import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve(
  process.cwd(),
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt',
);
const original = '.setAudioAttributes(AudioAttributes.DEFAULT, false)';
const configured = `${original}\n    .setHandleAudioBecomingNoisy(true)`;
const source = readFileSync(sourcePath, 'utf8');

if (source.includes(configured)) {
  process.exit(0);
}

const occurrences = source.split(original).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Unsupported expo-audio AudioPlayer.kt layout: expected one audio-attributes marker, found ${occurrences}.`,
  );
}

writeFileSync(sourcePath, source.replace(original, configured), 'utf8');
