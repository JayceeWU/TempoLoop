import AVFoundation
import Foundation
import UIKit

@MainActor
final class DanceAudioController {
  typealias PlaybackEventEmitter = (NativePlaybackEvent) -> Void

  private static let maximumExactJavaScriptGeneration: UInt64 =
    9_007_199_254_740_991

  private let player = AVPlayer()
  private var periodicTimeObserver: Any?
  private var boundaryTimeObserver: Any?
  private var currentItemStatusObservation: NSKeyValueObservation?
  private var itemDidPlayToEndObserver: NSObjectProtocol?
  private var itemFailedToPlayToEndObserver: NSObjectProtocol?

  private var itemReadinessContinuation: CheckedContinuation<Void, Error>?
  private var itemReadinessGeneration: UInt64?

  private var commandGeneration: UInt64 = 0
  private var loadedURL: URL?
  private var durationMs = 0
  private var activeRangeStartMs: Int?
  private var activeRangeEndMs: Int?
  private var selectedRate = NativePlaybackRate.normal
  private var state = NativePlaybackState.idle
  private var completionInProgress = false

  private let eventEmitter: PlaybackEventEmitter

  private lazy var audioSessionCoordinator = AudioSessionCoordinator {
    [weak self] event in
    self?.handleAudioSessionEvent(event)
  }

  init(eventEmitter: @escaping PlaybackEventEmitter) {
    self.eventEmitter = eventEmitter
    configurePlayerDefaults()
  }

  func loadAudio(from url: URL) async throws -> NativePlaybackSnapshot {
    guard
      url.isFileURL,
      FileManager.default.fileExists(atPath: url.path)
    else {
      throw DanceAudioException(.fileNotFound)
    }

    let generation = beginCommand(refreshObservers: false)
    player.pause()
    removeItemObservers()
    player.replaceCurrentItem(with: nil)
    resetLoadedState()
    loadedURL = url.standardizedFileURL
    state = .loading
    emitPlaybackChanged(generation: generation)

    do {
      try audioSessionCoordinator.configureForPlayback()

      let asset = AVURLAsset(url: url)
      let isPlayable = try await asset.load(.isPlayable)
      try ensureCurrentGeneration(generation, operation: "loadAudio")
      guard isPlayable else {
        throw DanceAudioException(
          .playbackFailed,
          message: "The local audio asset is not playable."
        )
      }

      let duration = try await asset.load(.duration)
      try ensureCurrentGeneration(generation, operation: "loadAudio")
      durationMs = try Self.validDurationMilliseconds(duration)

      let item = AVPlayerItem(asset: asset)
      item.audioTimePitchAlgorithm = .spectral
      player.replaceCurrentItem(with: item)
      installItemNotifications(for: item, generation: generation)
      try await waitUntilReady(item, generation: generation)
      try ensureCurrentGeneration(generation, operation: "loadAudio")

      installPeriodicTimeObserver(generation: generation)
      state = .ready
      emitPlaybackChanged(generation: generation)
      return makeSnapshot()
    } catch {
      let normalizedError = normalizePlaybackError(
        error,
        fallbackCode: .playbackFailed
      )
      if generation == commandGeneration, !normalizedError.isCancellation {
        failLoad(normalizedError, generation: generation)
      }
      throw normalizedError
    }
  }

  func playRange(
    startMs: Int,
    endMs: Int,
    rate: NativePlaybackRate
  ) async throws -> NativePlaybackSnapshot {
    let item = try requireReadyItem()
    guard
      startMs >= 0,
      startMs < endMs,
      endMs <= durationMs
    else {
      throw DanceAudioException(
        .invalidRange,
        message: "The playback range must be inside the loaded audio duration."
      )
    }

    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false
    activeRangeStartMs = startMs
    activeRangeEndMs = endMs
    selectedRate = rate
    state = .seeking
    emitPlaybackChanged(reason: .user, generation: generation)

    do {
      try audioSessionCoordinator.configureForPlayback()
      try await seekPlayer(to: startMs, generation: generation)
      try ensureCurrentGeneration(generation, operation: "playRange")
      item.audioTimePitchAlgorithm = .spectral
      installBoundaryTimeObserver(endMs: endMs, generation: generation)
      player.defaultRate = rate.floatValue
      player.playImmediately(atRate: rate.floatValue)
      state = .playing
      emitPlaybackChanged(reason: .user, generation: generation)
      return makeSnapshot()
    } catch {
      throw handleCommandFailure(
        error,
        generation: generation,
        fallbackCode: .seekFailed
      )
    }
  }

  func playFrom(
    positionMs: Int,
    rate: NativePlaybackRate
  ) async throws -> NativePlaybackSnapshot {
    let item = try requireReadyItem()
    try validatePosition(positionMs)

    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false
    activeRangeStartMs = nil
    activeRangeEndMs = nil
    selectedRate = rate
    state = .seeking
    emitPlaybackChanged(reason: .user, generation: generation)

    // Starting from the exact end would immediately complete. Treat that
    // editor action as "play again" and restart from zero.
    let effectivePosition = positionMs == durationMs ? 0 : positionMs

    do {
      try audioSessionCoordinator.configureForPlayback()
      try await seekPlayer(to: effectivePosition, generation: generation)
      try ensureCurrentGeneration(generation, operation: "playFrom")
      item.audioTimePitchAlgorithm = .spectral
      player.defaultRate = rate.floatValue
      player.playImmediately(atRate: rate.floatValue)
      state = .playing
      emitPlaybackChanged(reason: .user, generation: generation)
      return makeSnapshot()
    } catch {
      throw handleCommandFailure(
        error,
        generation: generation,
        fallbackCode: .seekFailed
      )
    }
  }

  func pause() -> NativePlaybackSnapshot {
    pause(reason: .user)
    return makeSnapshot()
  }

  func resume() async throws -> NativePlaybackSnapshot {
    let item = try requireReadyItem()
    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false

    let currentPosition = currentTimeMilliseconds()
    var resumePosition: Int?
    if
      let rangeEnd = activeRangeEndMs,
      let rangeStart = activeRangeStartMs,
      currentPosition >= rangeEnd
    {
      resumePosition = rangeStart
    } else if activeRangeEndMs == nil, currentPosition >= durationMs {
      resumePosition = 0
    }

    do {
      try audioSessionCoordinator.configureForPlayback()
      if let resumePosition {
        state = .seeking
        emitPlaybackChanged(reason: .user, generation: generation)
        try await seekPlayer(to: resumePosition, generation: generation)
        try ensureCurrentGeneration(generation, operation: "resume")
      }

      if let rangeEnd = activeRangeEndMs {
        installBoundaryTimeObserver(endMs: rangeEnd, generation: generation)
      }

      item.audioTimePitchAlgorithm = .spectral
      player.defaultRate = selectedRate.floatValue
      player.playImmediately(atRate: selectedRate.floatValue)
      state = .playing
      emitPlaybackChanged(reason: .user, generation: generation)
      return makeSnapshot()
    } catch {
      throw handleCommandFailure(
        error,
        generation: generation,
        fallbackCode: .seekFailed
      )
    }
  }

  func seek(positionMs: Int) async throws -> NativePlaybackSnapshot {
    _ = try requireReadyItem()
    try validatePosition(positionMs)

    let previousState = state
    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false
    state = .seeking
    emitPlaybackChanged(reason: .user, generation: generation)

    do {
      try await seekPlayer(to: positionMs, generation: generation)
      try ensureCurrentGeneration(generation, operation: "seek")
      state = previousState == .ready ? .ready : .paused
      emitPlaybackChanged(reason: .user, generation: generation)
      return makeSnapshot()
    } catch {
      throw handleCommandFailure(
        error,
        generation: generation,
        fallbackCode: .seekFailed
      )
    }
  }

  func setRate(_ rate: NativePlaybackRate) throws -> NativePlaybackSnapshot {
    let item = try requireReadyItem()
    selectedRate = rate
    item.audioTimePitchAlgorithm = .spectral
    player.defaultRate = rate.floatValue
    if state == .playing {
      player.rate = rate.floatValue
    }
    emitPlaybackChanged(reason: .user, generation: commandGeneration)
    return makeSnapshot()
  }

  func stopAndSeek(positionMs: Int) async throws -> NativePlaybackSnapshot {
    _ = try requireReadyItem()
    try validatePosition(positionMs)

    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false
    activeRangeStartMs = nil
    activeRangeEndMs = nil
    state = .seeking
    emitPlaybackChanged(reason: .user, generation: generation)

    do {
      try await seekPlayer(to: positionMs, generation: generation)
      try ensureCurrentGeneration(generation, operation: "stopAndSeek")
      state = .ready
      emitPlaybackChanged(reason: .user, generation: generation)
      return makeSnapshot()
    } catch {
      throw handleCommandFailure(
        error,
        generation: generation,
        fallbackCode: .seekFailed
      )
    }
  }

  func snapshot() -> NativePlaybackSnapshot {
    makeSnapshot()
  }

  func unload() throws {
    let generation = beginCommand(refreshObservers: false)
    player.pause()
    removeItemObservers()
    player.replaceCurrentItem(with: nil)
    resetLoadedState()
    state = .idle
    emitPlaybackChanged(generation: generation)
    try audioSessionCoordinator.deactivate()
  }

  private func configurePlayerDefaults() {
    player.actionAtItemEnd = .pause
    player.automaticallyWaitsToMinimizeStalling = true
    player.defaultRate = selectedRate.floatValue
  }

  @discardableResult
  private func beginCommand(refreshObservers: Bool = true) -> UInt64 {
    let shouldRefreshPeriodicObserver =
      refreshObservers && periodicTimeObserver != nil
    let itemForRefreshedNotifications =
      refreshObservers &&
        (itemDidPlayToEndObserver != nil || itemFailedToPlayToEndObserver != nil)
        ? player.currentItem
        : nil

    precondition(
      commandGeneration < Self.maximumExactJavaScriptGeneration,
      "Playback command generation exceeded JavaScript's exact integer range."
    )
    commandGeneration += 1
    cancelPendingItemReadiness()
    completionInProgress = false

    // Observer callbacks already queued by the previous command retain its
    // generation and are ignored. Rebinding active observers makes callbacks
    // scheduled for this command carry the new generation.
    if shouldRefreshPeriodicObserver {
      installPeriodicTimeObserver(generation: commandGeneration)
    }
    if let itemForRefreshedNotifications {
      installItemNotifications(
        for: itemForRefreshedNotifications,
        generation: commandGeneration
      )
    }

    return commandGeneration
  }

  private func ensureCurrentGeneration(
    _ generation: UInt64,
    operation: String
  ) throws {
    guard generation == commandGeneration else {
      throw DanceAudioException(
        .cancelled,
        message: "\(operation) was superseded by a newer playback command."
      )
    }
  }

  private func waitUntilReady(
    _ item: AVPlayerItem,
    generation: UInt64
  ) async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      itemReadinessContinuation = continuation
      itemReadinessGeneration = generation

      currentItemStatusObservation?.invalidate()
      currentItemStatusObservation = item.observe(
        \.status,
        options: [.initial, .new]
      ) { [weak self, weak item] _, _ in
        guard let item else {
          return
        }
        Task { @MainActor [weak self, weak item] in
          guard let self, let item else {
            return
          }
          self.handleItemStatusChange(item, generation: generation)
        }
      }

      // The continuation exists before both observer installation and this
      // synchronous status read, so a ready/failed transition cannot be lost
      // between a preflight check and suspension.
      handleItemStatusChange(item, generation: generation)
    }
  }

  private func handleItemStatusChange(
    _ item: AVPlayerItem,
    generation: UInt64
  ) {
    guard player.currentItem === item else {
      return
    }

    switch item.status {
    case .readyToPlay:
      finishItemReadiness(with: .success(()), generation: generation)
    case .failed:
      let error = playbackFailure(for: item)
      if itemReadinessGeneration == generation {
        finishItemReadiness(with: .failure(error), generation: generation)
      } else {
        transitionToFailed(error)
      }
    case .unknown:
      break
    @unknown default:
      let error = DanceAudioException(
        .playbackFailed,
        message: "The audio player item entered an unknown state."
      )
      if itemReadinessGeneration == generation {
        finishItemReadiness(with: .failure(error), generation: generation)
      } else {
        transitionToFailed(error)
      }
    }
  }

  private func finishItemReadiness(
    with result: Result<Void, Error>,
    generation: UInt64
  ) {
    guard
      itemReadinessGeneration == generation,
      let continuation = itemReadinessContinuation
    else {
      return
    }

    itemReadinessContinuation = nil
    itemReadinessGeneration = nil

    switch result {
    case .success:
      continuation.resume()
    case .failure(let error):
      continuation.resume(throwing: error)
    }
  }

  private func cancelPendingItemReadiness() {
    guard let continuation = itemReadinessContinuation else {
      return
    }

    itemReadinessContinuation = nil
    itemReadinessGeneration = nil
    currentItemStatusObservation?.invalidate()
    currentItemStatusObservation = nil
    continuation.resume(
      throwing: DanceAudioException(
        .cancelled,
        message: "The audio load was superseded by a newer playback command."
      )
    )
  }

  private func installPeriodicTimeObserver(generation: UInt64) {
    removePeriodicTimeObserver()
    let interval = CMTime(value: 100, timescale: 1_000)
    periodicTimeObserver = player.addPeriodicTimeObserver(
      forInterval: interval,
      queue: .main
    ) { [weak self] time in
      Task { @MainActor [weak self] in
        self?.handlePeriodicTime(time, generation: generation)
      }
    }
  }

  private func handlePeriodicTime(_ time: CMTime, generation: UInt64) {
    guard generation == commandGeneration else {
      return
    }

    let positionMs = Self.milliseconds(from: time, maximum: durationMs)

    if
      state == .playing,
      let rangeEnd = activeRangeEndMs,
      positionMs >= rangeEnd
    {
      completeActiveRange(generation: generation)
      return
    }

    if
      state == .playing,
      activeRangeEndMs == nil,
      durationMs > 0,
      positionMs >= durationMs
    {
      completeEditorPlayback(generation: generation)
      return
    }

    emitPlaybackChanged(generation: generation)
  }

  private func installBoundaryTimeObserver(
    endMs: Int,
    generation: UInt64
  ) {
    removeBoundaryTimeObserver()
    let boundaryTime = Self.time(milliseconds: endMs)
    boundaryTimeObserver = player.addBoundaryTimeObserver(
      forTimes: [NSValue(time: boundaryTime)],
      queue: .main
    ) { [weak self] in
      Task { @MainActor [weak self] in
        self?.completeActiveRange(generation: generation)
      }
    }
  }

  private func completeActiveRange(generation: UInt64) {
    guard
      generation == commandGeneration,
      state == .playing,
      !completionInProgress,
      let rangeStart = activeRangeStartMs
    else {
      return
    }

    completionInProgress = true
    player.pause()
    removeBoundaryTimeObserver()
    state = .completed
    emitPlaybackChanged(reason: .rangeEnded, generation: generation)

    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      do {
        try await self.seekPlayer(to: rangeStart, generation: generation)
        try self.ensureCurrentGeneration(
          generation,
          operation: "range completion reset"
        )
        self.completionInProgress = false
        self.state = .ready
        self.emitPlaybackChanged(generation: generation)
      } catch {
        guard generation == self.commandGeneration else {
          return
        }
        self.transitionToFailed(
          self.normalizePlaybackError(error, fallbackCode: .seekFailed)
        )
      }
    }
  }

  private func completeEditorPlayback(generation: UInt64) {
    guard
      generation == commandGeneration,
      state == .playing,
      !completionInProgress,
      activeRangeEndMs == nil
    else {
      return
    }

    completionInProgress = true
    player.pause()
    state = .completed
    emitPlaybackChanged(generation: generation)

    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      do {
        try await self.seekPlayer(to: 0, generation: generation)
        try self.ensureCurrentGeneration(
          generation,
          operation: "editor completion reset"
        )
        self.completionInProgress = false
        self.state = .ready
        self.emitPlaybackChanged(generation: generation)
      } catch {
        guard generation == self.commandGeneration else {
          return
        }
        self.transitionToFailed(
          self.normalizePlaybackError(error, fallbackCode: .seekFailed)
        )
      }
    }
  }

  private func seekPlayer(
    to positionMs: Int,
    generation: UInt64
  ) async throws {
    try ensureCurrentGeneration(generation, operation: "seek")
    let didFinish = await withCheckedContinuation {
      (continuation: CheckedContinuation<Bool, Never>) in
      player.seek(
        to: Self.time(milliseconds: positionMs),
        toleranceBefore: .zero,
        toleranceAfter: .zero
      ) { finished in
        continuation.resume(returning: finished)
      }
    }
    try ensureCurrentGeneration(generation, operation: "seek")
    guard didFinish else {
      throw DanceAudioException(.seekFailed)
    }
  }

  private func installItemNotifications(
    for item: AVPlayerItem,
    generation: UInt64
  ) {
    removeItemNotificationObservers()
    let notificationCenter = NotificationCenter.default

    itemDidPlayToEndObserver = notificationCenter.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification,
      object: item,
      queue: .main
    ) { [weak self, weak item] _ in
      Task { @MainActor [weak self, weak item] in
        guard
          let self,
          let item,
          generation == self.commandGeneration,
          self.player.currentItem === item
        else {
          return
        }

        if self.activeRangeEndMs != nil {
          self.completeActiveRange(generation: generation)
        } else {
          self.completeEditorPlayback(generation: generation)
        }
      }
    }

    itemFailedToPlayToEndObserver = notificationCenter.addObserver(
      forName: AVPlayerItem.failedToPlayToEndTimeNotification,
      object: item,
      queue: .main
    ) { [weak self, weak item] notification in
      Task { @MainActor [weak self, weak item] in
        guard
          let self,
          let item,
          generation == self.commandGeneration,
          self.player.currentItem === item
        else {
          return
        }

        let underlyingError =
          notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey]
            as? Error
        self.transitionToFailed(
          DanceAudioException(
            .playbackFailed,
            message: "The audio player could not finish playback.",
            cause: underlyingError
          )
        )
      }
    }
  }

  private func removeItemObservers() {
    cancelPendingItemReadiness()
    currentItemStatusObservation?.invalidate()
    currentItemStatusObservation = nil
    removePeriodicTimeObserver()
    removeBoundaryTimeObserver()
    removeItemNotificationObservers()
  }

  private func removeItemNotificationObservers() {
    let notificationCenter = NotificationCenter.default
    if let itemDidPlayToEndObserver {
      notificationCenter.removeObserver(itemDidPlayToEndObserver)
      self.itemDidPlayToEndObserver = nil
    }
    if let itemFailedToPlayToEndObserver {
      notificationCenter.removeObserver(itemFailedToPlayToEndObserver)
      self.itemFailedToPlayToEndObserver = nil
    }
  }

  private func removePeriodicTimeObserver() {
    guard let periodicTimeObserver else {
      return
    }
    player.removeTimeObserver(periodicTimeObserver)
    self.periodicTimeObserver = nil
  }

  private func removeBoundaryTimeObserver() {
    guard let boundaryTimeObserver else {
      return
    }
    player.removeTimeObserver(boundaryTimeObserver)
    self.boundaryTimeObserver = nil
  }

  private func pause(reason: NativePlaybackReason) {
    let generation = beginCommand()
    player.pause()
    removeBoundaryTimeObserver()
    completionInProgress = false

    switch state {
    case .idle, .ready, .failed:
      break
    case .loading:
      removeItemObservers()
      player.replaceCurrentItem(with: nil)
      resetLoadedState()
      state = .idle
      try? audioSessionCoordinator.deactivate()
    case .playing, .seeking, .completed, .paused:
      state = .paused
    }
    emitPlaybackChanged(reason: reason, generation: generation)
  }

  private func handleAudioSessionEvent(_ event: AudioSessionEvent) {
    switch event {
    case .interruptionBegan:
      pause(reason: .interruption)
    case .interruptionEnded(let shouldResume):
      // Re-activate only when iOS says resumption is appropriate and the app
      // is foregrounded. Playback remains paused until the user resumes it.
      guard
        shouldResume,
        UIApplication.shared.applicationState == .active,
        player.currentItem != nil
      else {
        return
      }
      do {
        try audioSessionCoordinator.configureForPlayback()
      } catch {
        transitionToFailed(
          normalizePlaybackError(error, fallbackCode: .audioSessionFailed)
        )
      }
    case .oldDeviceUnavailable:
      pause(reason: .routeChanged)
    case .mediaServicesWereReset:
      recoverAfterMediaServicesReset()
    }
  }

  private func recoverAfterMediaServicesReset() {
    let urlToReload = loadedURL
    let generation = beginCommand(refreshObservers: false)
    player.pause()
    removeItemObservers()
    player.replaceCurrentItem(with: nil)
    configurePlayerDefaults()
    resetLoadedState()

    guard let urlToReload else {
      state = .idle
      emitPlaybackChanged(generation: generation)
      return
    }

    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      do {
        _ = try await self.loadAudio(from: urlToReload)
      } catch {
        let normalizedError = self.normalizePlaybackError(
          error,
          fallbackCode: .audioSessionFailed
        )
        if !normalizedError.isCancellation {
          self.transitionToFailed(normalizedError)
        }
      }
    }
  }

  private func requireLoadedItem() throws -> AVPlayerItem {
    guard
      loadedURL != nil,
      let item = player.currentItem,
      durationMs > 0
    else {
      throw DanceAudioException(.audioNotLoaded)
    }
    return item
  }

  private func requireReadyItem() throws -> AVPlayerItem {
    let item = try requireLoadedItem()
    guard item.status == .readyToPlay, state != .failed else {
      throw playbackFailure(for: item)
    }
    return item
  }

  private func validatePosition(_ positionMs: Int) throws {
    guard positionMs >= 0, positionMs <= durationMs else {
      throw DanceAudioException(
        .invalidRange,
        message: "positionMs must be inside the loaded audio duration."
      )
    }
  }

  private func handleCommandFailure(
    _ error: Error,
    generation: UInt64,
    fallbackCode: DanceAudioErrorCode
  ) -> DanceAudioException {
    let normalizedError = normalizePlaybackError(
      error,
      fallbackCode: fallbackCode
    )
    if generation == commandGeneration, !normalizedError.isCancellation {
      transitionToFailed(normalizedError)
    }
    return normalizedError
  }

  private func normalizePlaybackError(
    _ error: Error,
    fallbackCode: DanceAudioErrorCode
  ) -> DanceAudioException {
    if let danceAudioError = error as? DanceAudioException {
      return danceAudioError
    }
    if error is CancellationError {
      return DanceAudioException(.cancelled, cause: error)
    }
    return DanceAudioException(fallbackCode, cause: error)
  }

  private func playbackFailure(for item: AVPlayerItem) -> DanceAudioException {
    DanceAudioException(
      .playbackFailed,
      message: item.error?.localizedDescription
        ?? "The audio player item is not ready for playback.",
      cause: item.error
    )
  }

  private func failLoad(
    _: DanceAudioException,
    generation: UInt64
  ) {
    player.pause()
    removeItemObservers()
    player.replaceCurrentItem(with: nil)
    resetLoadedState()
    state = .failed
    emitPlaybackChanged(reason: .error, generation: generation)
    try? audioSessionCoordinator.deactivate()
  }

  private func transitionToFailed(_: DanceAudioException) {
    let generation = beginCommand(refreshObservers: false)
    player.pause()
    removeItemObservers()
    state = .failed
    emitPlaybackChanged(reason: .error, generation: generation)
  }

  private func resetLoadedState() {
    loadedURL = nil
    durationMs = 0
    activeRangeStartMs = nil
    activeRangeEndMs = nil
    selectedRate = .normal
    completionInProgress = false
  }

  private func currentTimeMilliseconds() -> Int {
    Self.milliseconds(from: player.currentTime(), maximum: durationMs)
  }

  private func makeSnapshot() -> NativePlaybackSnapshot {
    NativePlaybackSnapshot(
      state: state,
      currentTimeMs: currentTimeMilliseconds(),
      durationMs: durationMs,
      rate: selectedRate,
      activeRangeStartMs: activeRangeStartMs,
      activeRangeEndMs: activeRangeEndMs
    )
  }

  private func emitPlaybackChanged(
    reason: NativePlaybackReason? = nil,
    generation: UInt64
  ) {
    eventEmitter(
      NativePlaybackEvent(
        snapshot: makeSnapshot(),
        reason: reason,
        commandGeneration: generation
      )
    )
  }

  private static func validDurationMilliseconds(_ time: CMTime) throws -> Int {
    let seconds = CMTimeGetSeconds(time)
    guard time.isValid, seconds.isFinite, seconds > 0 else {
      throw DanceAudioException(
        .playbackFailed,
        message: "The loaded audio duration is invalid."
      )
    }

    let milliseconds = Int((seconds * 1_000).rounded())
    guard milliseconds > 0 else {
      throw DanceAudioException(
        .playbackFailed,
        message: "The loaded audio is too short to play."
      )
    }
    return milliseconds
  }

  private static func milliseconds(from time: CMTime, maximum: Int) -> Int {
    let seconds = CMTimeGetSeconds(time)
    guard time.isValid, seconds.isFinite, seconds >= 0 else {
      return 0
    }

    let milliseconds = Int((seconds * 1_000).rounded())
    return min(max(milliseconds, 0), max(maximum, 0))
  }

  private static func time(milliseconds: Int) -> CMTime {
    CMTime(value: CMTimeValue(milliseconds), timescale: 1_000)
  }

  deinit {
    if let periodicTimeObserver {
      player.removeTimeObserver(periodicTimeObserver)
    }
    if let boundaryTimeObserver {
      player.removeTimeObserver(boundaryTimeObserver)
    }
    currentItemStatusObservation?.invalidate()

    let notificationCenter = NotificationCenter.default
    if let itemDidPlayToEndObserver {
      notificationCenter.removeObserver(itemDidPlayToEndObserver)
    }
    if let itemFailedToPlayToEndObserver {
      notificationCenter.removeObserver(itemFailedToPlayToEndObserver)
    }
  }
}
