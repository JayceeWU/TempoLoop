import Foundation
import UIKit

struct NativeTaskHandle: Hashable, Sendable {
  let taskId: String
  fileprivate let token: UUID
}

final class NativeTaskRegistry: @unchecked Sendable {
  private static let maximumPendingCancellationCount = 32

  private struct Entry {
    let token: UUID
    var isCancelled: Bool
    var cancellationHandler: (() -> Void)?
  }

  private let lock = NSLock()
  private var entries: [String: Entry] = [:]
  private var pendingCancellations: Set<String> = []
  private var pendingCancellationOrder: [String] = []

  func begin(taskId: String) throws -> NativeTaskHandle {
    lock.lock()
    defer { lock.unlock() }

    guard entries[taskId] == nil else {
      throw DanceAudioException(
        .internalError,
        message: "An import task with this taskId is already active."
      )
    }

    let handle = NativeTaskHandle(taskId: taskId, token: UUID())
    let wasCancelledBeforeRegistration =
      consumePendingCancellationLocked(taskId: taskId)
    entries[taskId] = Entry(
      token: handle.token,
      isCancelled: wasCancelledBeforeRegistration,
      cancellationHandler: nil
    )
    return handle
  }

  func setCancellationHandler(
    _ handler: @escaping () -> Void,
    for handle: NativeTaskHandle
  ) {
    var invokeImmediately = false

    lock.lock()
    if var entry = entries[handle.taskId], entry.token == handle.token {
      entry.cancellationHandler = handler
      invokeImmediately = entry.isCancelled
      entries[handle.taskId] = entry
    }
    lock.unlock()

    if invokeImmediately {
      handler()
    }
  }

  func clearCancellationHandler(for handle: NativeTaskHandle) {
    lock.lock()
    if var entry = entries[handle.taskId], entry.token == handle.token {
      entry.cancellationHandler = nil
      entries[handle.taskId] = entry
    }
    lock.unlock()
  }

  func cancel(taskId: String) {
    var handler: (() -> Void)?

    lock.lock()
    if var entry = entries[taskId] {
      entry.isCancelled = true
      handler = entry.cancellationHandler
      entries[taskId] = entry
    } else {
      recordPendingCancellationLocked(taskId: taskId)
    }
    lock.unlock()

    handler?()
  }

  func isActive(_ handle: NativeTaskHandle) -> Bool {
    lock.lock()
    defer { lock.unlock() }

    guard let entry = entries[handle.taskId], entry.token == handle.token else {
      return false
    }
    return !entry.isCancelled
  }

  func throwIfCancelled(_ handle: NativeTaskHandle) throws {
    guard isActive(handle) else {
      throw DanceAudioException(.cancelled)
    }
  }

  func finish(_ handle: NativeTaskHandle) {
    lock.lock()
    if let entry = entries[handle.taskId], entry.token == handle.token {
      entries.removeValue(forKey: handle.taskId)
    }
    lock.unlock()
  }

  private func recordPendingCancellationLocked(taskId: String) {
    guard pendingCancellations.insert(taskId).inserted else {
      return
    }

    pendingCancellationOrder.append(taskId)
    while
      pendingCancellationOrder.count
        > Self.maximumPendingCancellationCount
    {
      let expiredTaskId = pendingCancellationOrder.removeFirst()
      pendingCancellations.remove(expiredTaskId)
    }
  }

  private func consumePendingCancellationLocked(taskId: String) -> Bool {
    guard pendingCancellations.remove(taskId) != nil else {
      return false
    }

    pendingCancellationOrder.removeAll { $0 == taskId }
    return true
  }
}

@MainActor
final class NativeBackgroundTask {
  private var identifier: UIBackgroundTaskIdentifier = .invalid

  init(
    name: String,
    expirationHandler: @escaping () -> Void
  ) {
    identifier = UIApplication.shared.beginBackgroundTask(
      withName: name,
      expirationHandler: expirationHandler
    )
  }

  func end() {
    guard identifier != .invalid else {
      return
    }

    UIApplication.shared.endBackgroundTask(identifier)
    identifier = .invalid
  }
}
