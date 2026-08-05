import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..');
const patchScript = path.join(repositoryRoot, 'scripts/ensure-expo-audio-noisy-output.mjs');
const playerSource = path.join(
  repositoryRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt',
);
const moduleSource = path.join(
  repositoryRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt',
);
const expoAudioPackage = path.join(repositoryRoot, 'node_modules/expo-audio/package.json');

describe('expo-audio Android postinstall contract', () => {
  it('is idempotent and configures route-loss plus replace(null) cleanup', () => {
    execFileSync(process.execPath, [patchScript], { cwd: repositoryRoot });
    execFileSync(process.execPath, [patchScript], { cwd: repositoryRoot });

    const player = readFileSync(playerSource, 'utf8');
    const module = readFileSync(moduleSource, 'utf8');
    expect(JSON.parse(readFileSync(expoAudioPackage, 'utf8')).version).toBe('57.0.3');
    expect(player.match(/\.setHandleAudioBecomingNoisy\(true\)/g)).toHaveLength(1);
    expect(
      module.match(/Function\("replace"\) \{ player: AudioPlayer, source: AudioSource\? ->/g),
    ).toHaveLength(1);
    expect(module).not.toContain(
      'Function("replace") { player: AudioPlayer, source: AudioSource ->',
    );
    expect(module.match(/\/\/ AudioSource explicitly includes null\./g)).toHaveLength(1);
    expect(module).toContain('player.ref.stop()');
    expect(module).toContain('player.ref.clearMediaItems()');
  });
});
