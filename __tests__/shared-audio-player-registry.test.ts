import type { AudioPlayer } from 'expo-audio';

import {
  getSharedAudioPlayer,
  prepareSharedAudioPlayerForImport,
  registerImportPlaybackPreparation,
  registerSharedAudioPlayer,
} from '@/playback/SharedAudioPlayerRegistry';

describe('SharedAudioPlayerRegistry', () => {
  it('exposes one provider-owned player to import validation', () => {
    const player = { id: 'tempo-loop-player' } as AudioPlayer;
    const unregister = registerSharedAudioPlayer(player);
    try {
      expect(getSharedAudioPlayer()).toBe(player);
      expect(() => registerSharedAudioPlayer({ id: 'second-player' } as AudioPlayer)).toThrow(
        /more than one expo-audio player/,
      );
    } finally {
      unregister();
    }
  });

  it('invalidates playback whenever import borrows the player', () => {
    const prepare = jest.fn();
    const unregister = registerImportPlaybackPreparation(prepare);
    try {
      prepareSharedAudioPlayerForImport();
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});
