const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};

const CONTROLLER_SOURCE = readFileSync(
  'modules/dance-audio/ios/DanceAudioController.swift',
  'utf8',
);
const MODELS_SOURCE = readFileSync('modules/dance-audio/ios/NativeModels.swift', 'utf8');

describe('native playback command generations', () => {
  it('keeps a single player and serializes a JavaScript-safe generation', () => {
    expect(CONTROLLER_SOURCE.match(/\bAVPlayer\(\)/g)).toHaveLength(1);
    expect(CONTROLLER_SOURCE).toContain('commandGeneration += 1');
    expect(CONTROLLER_SOURCE).toContain('maximumExactJavaScriptGeneration');
    expect(MODELS_SOURCE).toContain('let commandGeneration: UInt64');
    expect(MODELS_SOURCE).toContain('payload["commandGeneration"] = Double(commandGeneration)');
    expect(CONTROLLER_SOURCE).toContain('commandGeneration: generation');
  });

  it('captures and checks the generation for queued observer callbacks', () => {
    expect(CONTROLLER_SOURCE).toContain(
      'private func installPeriodicTimeObserver(generation: UInt64)',
    );
    expect(CONTROLLER_SOURCE).toContain('self?.handlePeriodicTime(time, generation: generation)');
    expect(CONTROLLER_SOURCE).toContain(
      'installPeriodicTimeObserver(generation: commandGeneration)',
    );
    expect(CONTROLLER_SOURCE).toMatch(
      /installItemNotifications\(\s+for: itemForRefreshedNotifications,\s+generation: commandGeneration/,
    );
    expect(CONTROLLER_SOURCE).toMatch(
      /private func handlePeriodicTime\(_ time: CMTime, generation: UInt64\) \{\s+guard generation == commandGeneration else \{\s+return\s+\}/,
    );
    expect(CONTROLLER_SOURCE).toContain('self?.completeActiveRange(generation: generation)');
    expect(CONTROLLER_SOURCE).toMatch(
      /generation == self\.commandGeneration,\s+self\.player\.currentItem === item/,
    );
  });

  it('reactivates the playback audio session before every native start or resume', () => {
    const playbackSessionActivations = CONTROLLER_SOURCE.match(
      /try audioSessionCoordinator\.configureForPlayback\(\)/g,
    );

    // loadAudio, playRange, playFrom, resume, and interruption-end handling.
    // Explicit user resume remains reliable even when iOS ended the
    // interruption without recommending automatic resumption.
    expect(playbackSessionActivations).toHaveLength(5);
  });
});
