import AVFoundation
import Foundation

enum AudioSessionEvent: Sendable {
  case interruptionBegan
  case interruptionEnded(shouldResume: Bool)
  case oldDeviceUnavailable
  case mediaServicesWereReset
}

@MainActor
final class AudioSessionCoordinator {
  private let session: AVAudioSession
  private let notificationCenter: NotificationCenter
  private let eventHandler: (AudioSessionEvent) -> Void

  private var notificationTokens: [NSObjectProtocol] = []
  private var isObserving = false
  private var isConfigured = false

  init(
    session: AVAudioSession = .sharedInstance(),
    notificationCenter: NotificationCenter = .default,
    eventHandler: @escaping (AudioSessionEvent) -> Void
  ) {
    self.session = session
    self.notificationCenter = notificationCenter
    self.eventHandler = eventHandler
  }

  func configureForPlayback() throws {
    installObserversIfNeeded()

    do {
      try session.setCategory(.playback, mode: .default, options: [])
      try session.setActive(true)
      isConfigured = true
    } catch {
      throw DanceAudioException(
        .audioSessionFailed,
        message: "The iOS playback audio session could not be activated.",
        cause: error
      )
    }
  }

  func deactivate() throws {
    removeObservers()
    guard isConfigured else {
      return
    }

    do {
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      isConfigured = false
    } catch {
      isConfigured = false
      throw DanceAudioException(
        .audioSessionFailed,
        message: "The iOS playback audio session could not be deactivated.",
        cause: error
      )
    }
  }

  private func installObserversIfNeeded() {
    guard !isObserving else {
      return
    }

    isObserving = true

    notificationTokens.append(
      notificationCenter.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: session,
        queue: .main
      ) { [weak self] notification in
        Task { @MainActor [weak self] in
          self?.handleInterruption(notification)
        }
      }
    )

    notificationTokens.append(
      notificationCenter.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: session,
        queue: .main
      ) { [weak self] notification in
        Task { @MainActor [weak self] in
          self?.handleRouteChange(notification)
        }
      }
    )

    notificationTokens.append(
      notificationCenter.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification,
        object: session,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.eventHandler(.mediaServicesWereReset)
        }
      }
    )
  }

  private func handleInterruption(_ notification: Notification) {
    guard
      let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let interruptionType = AVAudioSession.InterruptionType(rawValue: rawType)
    else {
      return
    }

    switch interruptionType {
    case .began:
      eventHandler(.interruptionBegan)
    case .ended:
      let rawOptions =
        notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
      eventHandler(.interruptionEnded(shouldResume: options.contains(.shouldResume)))
    @unknown default:
      break
    }
  }

  private func handleRouteChange(_ notification: Notification) {
    guard
      let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason),
      reason == .oldDeviceUnavailable
    else {
      return
    }

    eventHandler(.oldDeviceUnavailable)
  }

  private func removeObservers() {
    notificationTokens.forEach { notificationCenter.removeObserver($0) }
    notificationTokens.removeAll()
    isObserving = false
  }

  deinit {
    notificationTokens.forEach { notificationCenter.removeObserver($0) }
  }
}
