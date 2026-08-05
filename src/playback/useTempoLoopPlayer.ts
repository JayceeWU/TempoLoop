import { useMemo } from 'react';

import type { PlaybackRate, PlaybackSnapshot } from '@/domain/playback';
import { usePlaybackCoordinator, usePlaybackSnapshot } from '@/playback/AudioPlayerProvider';
import type { PlaybackProjectInput, PracticeSegmentInput } from '@/playback/PlaybackCoordinator';

export interface TempoLoopPlayerController {
  readonly snapshot: PlaybackSnapshot;
  readonly enterEditor: (input: PlaybackProjectInput) => Promise<boolean>;
  readonly enterPractice: (input: PlaybackProjectInput, rate: PlaybackRate) => Promise<boolean>;
  readonly preparePracticeSegment: (input: PracticeSegmentInput) => Promise<boolean>;
  readonly togglePractice: () => Promise<boolean>;
  readonly playEditor: () => Promise<boolean>;
  readonly pause: () => void;
  readonly seekEditor: (positionMs: number, resumeAfterSeek?: boolean) => Promise<boolean>;
  readonly setRate: (rate: PlaybackRate) => boolean;
  readonly getCurrentPositionMs: () => number;
  readonly deactivate: () => void;
  readonly clearSource: (projectId?: string) => boolean;
}

export function useTempoLoopPlayer(): TempoLoopPlayerController {
  const coordinator = usePlaybackCoordinator();
  const snapshot = usePlaybackSnapshot();

  return useMemo(
    () => ({
      snapshot,
      enterEditor: (input: PlaybackProjectInput) => coordinator.enterEditor(input),
      enterPractice: (input: PlaybackProjectInput, rate: PlaybackRate) =>
        coordinator.enterPractice(input, rate),
      preparePracticeSegment: (input: PracticeSegmentInput) =>
        coordinator.preparePracticeSegment(input),
      togglePractice: () => coordinator.togglePractice(),
      playEditor: () => coordinator.playEditor(),
      pause: () => coordinator.pause(),
      seekEditor: (positionMs: number, resumeAfterSeek = false) =>
        coordinator.seekEditor(positionMs, resumeAfterSeek),
      setRate: (rate: PlaybackRate) => coordinator.setRate(rate),
      getCurrentPositionMs: () => coordinator.getCurrentPositionMs(),
      deactivate: () => coordinator.deactivate(),
      clearSource: (projectId?: string) => coordinator.clearSource(projectId),
    }),
    [coordinator, snapshot],
  );
}
