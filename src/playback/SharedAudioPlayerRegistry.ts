import type { AudioPlayer } from 'expo-audio';

let registeredPlayer: AudioPlayer | null = null;
let registeredImportPreparation: (() => void) | null = null;

/** Registers the one expo-audio player owned by the root provider. */
export function registerSharedAudioPlayer(player: AudioPlayer): () => void {
  if (registeredPlayer !== null && registeredPlayer !== player) {
    throw new Error('TempoLoop attempted to register more than one expo-audio player.');
  }
  registeredPlayer = player;

  return () => {
    if (registeredPlayer === player) {
      registeredPlayer = null;
    }
  };
}

/** Lets import validation invalidate playback before borrowing the shared player. */
export function registerImportPlaybackPreparation(prepare: () => void): () => void {
  registeredImportPreparation = prepare;
  return () => {
    if (registeredImportPreparation === prepare) {
      registeredImportPreparation = null;
    }
  };
}

export function prepareSharedAudioPlayerForImport(): void {
  registeredImportPreparation?.();
}

export function getSharedAudioPlayer(): AudioPlayer {
  if (registeredPlayer === null) {
    throw new Error('TempoLoop audio player is not registered.');
  }
  return registeredPlayer;
}
