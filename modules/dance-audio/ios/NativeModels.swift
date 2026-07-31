import Foundation

enum NativePlaybackState: String, Sendable {
  case idle
  case loading
  case ready
  case playing
  case paused
  case seeking
  case completed
  case failed
}

enum NativeImportPhase: String, Sendable {
  case extracting
  case waveform
}

enum NativePlaybackReason: String, Sendable {
  case user
  case rangeEnded = "range-ended"
  case interruption
  case routeChanged = "route-changed"
  case appInactive = "app-inactive"
  case error
}

struct NativePlaybackRate: Equatable, Sendable {
  static let normal = NativePlaybackRate(value: 1.0)
  static let ninetyPercent = NativePlaybackRate(value: 0.9)
  static let eightyPercent = NativePlaybackRate(value: 0.8)
  static let seventyPercent = NativePlaybackRate(value: 0.7)

  let value: Double

  var floatValue: Float {
    Float(value)
  }

  init(validating value: Double) throws {
    switch value {
    case 1.0:
      self = .normal
    case 0.9:
      self = .ninetyPercent
    case 0.8:
      self = .eightyPercent
    case 0.7:
      self = .seventyPercent
    default:
      throw DanceAudioException(
        .invalidRange,
        message: "rate must be exactly 1.0, 0.9, 0.8, or 0.7."
      )
    }
  }

  private init(value: Double) {
    self.value = value
  }
}

struct NativeHealthCheckResult: Sendable {
  let available: Bool
  let apiVersion: Int

  var dictionary: [String: Any] {
    [
      "available": available,
      "apiVersion": apiVersion,
    ]
  }
}

struct NativeExtractAudioResult: Sendable {
  let durationMs: Int
  let outputBytes: Int

  var dictionary: [String: Any] {
    [
      "durationMs": durationMs,
      "outputBytes": outputBytes,
    ]
  }
}

struct NativePlaybackSnapshot: Sendable {
  let state: NativePlaybackState
  let currentTimeMs: Int
  let durationMs: Int
  let rate: NativePlaybackRate
  let activeRangeStartMs: Int?
  let activeRangeEndMs: Int?

  var dictionary: [String: Any] {
    [
      "state": state.rawValue,
      "currentTimeMs": currentTimeMs,
      "durationMs": durationMs,
      "rate": rate.value,
      "activeRangeStartMs": activeRangeStartMs.map { $0 as Any } ?? NSNull(),
      "activeRangeEndMs": activeRangeEndMs.map { $0 as Any } ?? NSNull(),
    ]
  }

  static let idle = NativePlaybackSnapshot(
    state: .idle,
    currentTimeMs: 0,
    durationMs: 0,
    rate: .normal,
    activeRangeStartMs: nil,
    activeRangeEndMs: nil
  )
}

struct NativeImportProgressEvent: Sendable {
  let taskId: String
  let phase: NativeImportPhase
  let progress: Double

  var dictionary: [String: Any] {
    [
      "taskId": taskId,
      "phase": phase.rawValue,
      "progress": min(max(progress.isFinite ? progress : 0, 0), 1),
    ]
  }
}

final class NativeImportProgressReporter: @unchecked Sendable {
  private static let minimumEmissionInterval: TimeInterval = 0.2

  private let taskId: String
  private let phase: NativeImportPhase
  private let emit: (NativeImportProgressEvent) -> Void
  private let lock = NSLock()
  private var lastEmissionTime: TimeInterval?
  private var highestReportedProgress = 0.0

  init(
    taskId: String,
    phase: NativeImportPhase,
    emit: @escaping (NativeImportProgressEvent) -> Void
  ) {
    self.taskId = taskId
    self.phase = phase
    self.emit = emit
  }

  func report(_ rawProgress: Double) {
    let finiteProgress = rawProgress.isFinite ? rawProgress : 0
    let clampedProgress = min(max(finiteProgress, 0), 1)
    let now = ProcessInfo.processInfo.systemUptime
    var event: NativeImportProgressEvent?

    lock.lock()
    highestReportedProgress = max(highestReportedProgress, clampedProgress)

    if
      lastEmissionTime == nil
        || now - (lastEmissionTime ?? now) >= Self.minimumEmissionInterval
    {
      lastEmissionTime = now
      event = NativeImportProgressEvent(
        taskId: taskId,
        phase: phase,
        progress: highestReportedProgress
      )
    }
    lock.unlock()

    if let event {
      emit(event)
    }
  }
}

struct NativePlaybackEvent: Sendable {
  let snapshot: NativePlaybackSnapshot
  let reason: NativePlaybackReason?
  let commandGeneration: UInt64

  var dictionary: [String: Any] {
    var payload = snapshot.dictionary
    // JavaScript numbers exactly represent integers through 2^53 - 1. The
    // controller prevents its process-local generation from exceeding that
    // bound, so this Double remains an exact monotonic command identifier.
    payload["commandGeneration"] = Double(commandGeneration)
    if let reason {
      payload["reason"] = reason.rawValue
    }
    return payload
  }
}

enum NativeArgumentValidator {
  static let requiredWaveformPointCount = 2_048

  static func taskId(_ value: String) throws -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else {
      throw DanceAudioException(
        .internalError,
        message: "taskId must not be empty."
      )
    }
    return trimmedValue
  }

  static func localFileURL(
    _ value: String,
    parameter: String,
    mustExist: Bool
  ) throws -> URL {
    guard
      !value.isEmpty,
      let parsedURL = URL(string: value),
      parsedURL.isFileURL,
      !parsedURL.path.isEmpty
    else {
      throw DanceAudioException(
        .invalidUri,
        message: "\(parameter) must be a valid local file URI."
      )
    }

    let fileURL = parsedURL.standardizedFileURL
    if mustExist && !FileManager.default.fileExists(atPath: fileURL.path) {
      throw DanceAudioException(
        .fileNotFound,
        message: "The local file for \(parameter) does not exist."
      )
    }
    return fileURL
  }

  static func milliseconds(
    _ value: Double,
    parameter: String
  ) throws -> Int {
    guard
      value.isFinite,
      value >= 0,
      let integerValue = Int(exactly: value)
    else {
      throw DanceAudioException(
        .invalidRange,
        message: "\(parameter) must be a non-negative integer number of milliseconds."
      )
    }
    return integerValue
  }

  static func playbackRange(
    startMs: Double,
    endMs: Double
  ) throws -> (startMs: Int, endMs: Int) {
    let validatedStart = try milliseconds(startMs, parameter: "startMs")
    let validatedEnd = try milliseconds(endMs, parameter: "endMs")
    guard validatedStart < validatedEnd else {
      throw DanceAudioException(
        .invalidRange,
        message: "startMs must be less than endMs."
      )
    }
    return (validatedStart, validatedEnd)
  }

  static func waveformPointCount(_ value: Double) throws -> Int {
    guard
      value.isFinite,
      let integerValue = Int(exactly: value),
      integerValue == requiredWaveformPointCount
    else {
      throw DanceAudioException(
        .invalidPointCount,
        message: "pointCount must be exactly \(requiredWaveformPointCount)."
      )
    }
    return integerValue
  }
}
