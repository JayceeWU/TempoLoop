import ExpoModulesCore

public enum DanceAudioErrorCode: String, CaseIterable, Sendable {
  case invalidUri = "E_INVALID_URI"
  case fileNotFound = "E_FILE_NOT_FOUND"
  case noAudioTrack = "E_NO_AUDIO_TRACK"
  case exportUnsupported = "E_EXPORT_UNSUPPORTED"
  case exportFailed = "E_EXPORT_FAILED"
  case waveformFailed = "E_WAVEFORM_FAILED"
  case invalidPointCount = "E_INVALID_POINT_COUNT"
  case invalidRange = "E_INVALID_RANGE"
  case audioNotLoaded = "E_AUDIO_NOT_LOADED"
  case seekFailed = "E_SEEK_FAILED"
  case playbackFailed = "E_PLAYBACK_FAILED"
  case cancelled = "E_CANCELLED"
  case audioSessionFailed = "E_AUDIO_SESSION_FAILED"
  case insufficientStorage = "E_INSUFFICIENT_STORAGE"
  case internalError = "E_INTERNAL"

  public var defaultMessage: String {
    switch self {
    case .invalidUri:
      return "A valid local file URI is required."
    case .fileNotFound:
      return "The requested local file does not exist."
    case .noAudioTrack:
      return "The selected video does not contain a usable audio track."
    case .exportUnsupported:
      return "This video's audio cannot be exported in a supported format."
    case .exportFailed:
      return "The audio could not be extracted from this video."
    case .waveformFailed:
      return "The audio waveform could not be created."
    case .invalidPointCount:
      return "The waveform point count is invalid."
    case .invalidRange:
      return "The requested playback position or range is invalid."
    case .audioNotLoaded:
      return "No project audio is loaded."
    case .seekFailed:
      return "The audio position could not be changed."
    case .playbackFailed:
      return "The project audio could not be played."
    case .cancelled:
      return "The operation was cancelled."
    case .audioSessionFailed:
      return "The iOS audio session could not be configured."
    case .insufficientStorage:
      return "There is not enough free storage for this operation."
    case .internalError:
      return "The native audio operation could not be completed."
    }
  }
}

public final class DanceAudioException: Exception, @unchecked Sendable {
  private let errorMessage: String
  public let errorCode: DanceAudioErrorCode

  public init(
    _ code: DanceAudioErrorCode,
    message: String? = nil,
    cause: Error? = nil,
    file: String = #fileID,
    line: UInt = #line,
    function: String = #function
  ) {
    let resolvedMessage = message ?? code.defaultMessage
    self.errorMessage = resolvedMessage
    self.errorCode = code
    super.init(
      name: "DanceAudioException",
      description: resolvedMessage,
      code: code.rawValue,
      file: file,
      line: line,
      function: function
    )
    self.cause = cause
  }

  public override var reason: String {
    errorMessage
  }

  public var isCancellation: Bool {
    errorCode == .cancelled
  }

}
