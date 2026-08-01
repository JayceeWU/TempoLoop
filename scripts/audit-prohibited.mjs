import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const activeRoots = [
  'app',
  'src',
  'modules/tempoloop-media/src',
  'modules/tempoloop-media/android/src/main',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.kt', '.kts', '.gradle']);

const forbiddenSourcePatterns = [
  ['expo-av', /(?:from\s+|require\s*\()\s*['"]expo-av['"]/],
  ['expo-image-picker', /(?:from\s+|require\s*\()\s*['"]expo-image-picker['"]/],
  ['FFmpeg', /\bffmpeg\b/i],
  ['retained iOS module import', /modules\/dance-audio|modules\\dance-audio|DanceAudio/],
  ['legacy native audio service', /NativeAudioService|useNativePlaybackEvents|usePlaybackStore/],
  ['network fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['Base64 media read', /EncodingType\.Base64|readAsStringAsync\s*\([^)]*base64/i],
  ['standalone polling interval', /\bsetInterval\s*\(/],
  ['internal coroutine continuation API', /\b(?:tryResume(?:WithException)?|completeResume)\s*\(/],
];

function sourceFiles(directory) {
  const absoluteDirectory = path.join(repositoryRoot, directory);
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(relative);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [relative] : [];
  });
}

const violations = [];
for (const file of activeRoots.flatMap(sourceFiles)) {
  const contents = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
  for (const [label, pattern] of forbiddenSourcePatterns) {
    if (pattern.test(contents)) {
      violations.push(`${file}: ${label}`);
    }
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const installedPackages = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
for (const packageName of ['expo-av', 'expo-image-picker']) {
  if (Object.hasOwn(installedPackages, packageName)) {
    violations.push(`package.json: prohibited dependency ${packageName}`);
  }
}

const noisyOutputPostinstall = 'node scripts/ensure-expo-audio-noisy-output.mjs';
if (packageJson.scripts?.postinstall !== noisyOutputPostinstall) {
  violations.push('package.json: expo-audio noisy-output postinstall is missing');
}

const expoAudioPlayerPath = path.join(
  repositoryRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt',
);
if (
  !fs.existsSync(expoAudioPlayerPath) ||
  !fs.readFileSync(expoAudioPlayerPath, 'utf8').includes('.setHandleAudioBecomingNoisy(true)')
) {
  violations.push('expo-audio: Android noisy-output pause is not configured');
}

const retainedModuleConfig = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'modules/dance-audio/expo-module.config.json'), 'utf8'),
);
if (JSON.stringify(retainedModuleConfig.platforms) !== JSON.stringify(['apple'])) {
  violations.push('modules/dance-audio: retained module must remain Apple-only');
}

const androidModuleConfig = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, 'modules/tempoloop-media/expo-module.config.json'),
    'utf8',
  ),
);
if (JSON.stringify(androidModuleConfig.platforms) !== JSON.stringify(['android'])) {
  violations.push('modules/tempoloop-media: active module must remain Android-only');
}

if (violations.length > 0) {
  console.error(`Static policy audit failed:\n- ${violations.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Static policy audit passed.');
}
