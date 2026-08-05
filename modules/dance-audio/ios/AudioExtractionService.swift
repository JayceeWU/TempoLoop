import AVFoundation
import Foundation

final class AudioExtractionService {
  private let taskRegistry: NativeTaskRegistry
  private let transcodeFallback: AudioTranscodeFallback
  private let fileManager: FileManager

  init(
    taskRegistry: NativeTaskRegistry,
    fileManager: FileManager = .default
  ) {
    self.taskRegistry = taskRegistry
    self.fileManager = fileManager
    self.transcodeFallback = AudioTranscodeFallback(
      taskRegistry: taskRegistry,
      fileManager: fileManager
    )
  }

  func extractAudio(
    handle: NativeTaskHandle,
    inputURL: URL,
    outputURL: URL,
    progressReporter: NativeImportProgressReporter
  ) async throws -> NativeExtractAudioResult {
    try validatePaths(inputURL: inputURL, outputURL: outputURL)
    try taskRegistry.throwIfCancelled(handle)

    let sourceAsset = AVURLAsset(url: inputURL)
    taskRegistry.setCancellationHandler(
      {
        sourceAsset.cancelLoading()
      },
      for: handle
    )
    let sourceTracks: [AVAssetTrack]
    do {
      sourceTracks = try await sourceAsset.loadTracks(withMediaType: .audio)
    } catch {
      taskRegistry.clearCancellationHandler(for: handle)
      if !taskRegistry.isActive(handle) {
        throw DanceAudioException(.cancelled, cause: error)
      }
      throw DanceAudioException(
        .exportFailed,
        message: "The source video's audio tracks could not be loaded.",
        cause: error
      )
    }
    taskRegistry.clearCancellationHandler(for: handle)
    try taskRegistry.throwIfCancelled(handle)

    guard !sourceTracks.isEmpty else {
      throw DanceAudioException(.noAudioTrack)
    }

    do {
      try await exportAppleM4A(
        asset: sourceAsset,
        outputURL: outputURL,
        handle: handle,
        progressReporter: progressReporter
      )
      try taskRegistry.throwIfCancelled(handle)
      let result = try await validateOutput(at: outputURL, handle: handle)
      try taskRegistry.throwIfCancelled(handle)
      progressReporter.report(1)
      return result
    } catch {
      if isCancellation(error) {
        removePartialOutput(at: outputURL)
        throw DanceAudioException(.cancelled, cause: error)
      }
      removePartialOutput(at: outputURL)
    }

    do {
      try taskRegistry.throwIfCancelled(handle)
      try await transcodeFallback.transcode(
        handle: handle,
        inputURL: inputURL,
        outputURL: outputURL,
        progressReporter: progressReporter
      )
      try taskRegistry.throwIfCancelled(handle)
      let result = try await validateOutput(at: outputURL, handle: handle)
      try taskRegistry.throwIfCancelled(handle)
      progressReporter.report(1)
      return result
    } catch {
      removePartialOutput(at: outputURL)
      if isCancellation(error) {
        throw DanceAudioException(.cancelled, cause: error)
      }
      throw DanceAudioException(
        .exportFailed,
        message: "Both Apple M4A export and AAC transcoding failed.",
        cause: error
      )
    }
  }

  private func validatePaths(inputURL: URL, outputURL: URL) throws {
    guard
      inputURL.isFileURL,
      fileManager.fileExists(atPath: inputURL.path)
    else {
      throw DanceAudioException(.fileNotFound)
    }

    guard outputURL.isFileURL, outputURL.pathExtension.lowercased() == "m4a" else {
      throw DanceAudioException(
        .invalidUri,
        message: "outputAudioUri must be a local .m4a file URI."
      )
    }

    guard !fileManager.fileExists(atPath: outputURL.path) else {
      throw DanceAudioException(
        .exportFailed,
        message: "The audio output path must not already exist."
      )
    }

    var isDirectory: ObjCBool = false
    let parentPath = outputURL.deletingLastPathComponent().path
    guard
      fileManager.fileExists(atPath: parentPath, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      throw DanceAudioException(
        .invalidUri,
        message: "The audio output directory does not exist."
      )
    }
  }

  private func exportAppleM4A(
    asset: AVAsset,
    outputURL: URL,
    handle: NativeTaskHandle,
    progressReporter: NativeImportProgressReporter
  ) async throws {
    let isCompatible = await determineAppleM4ACompatibility(for: asset)
    guard isCompatible else {
      throw DanceAudioException(.exportUnsupported)
    }

    guard
      let exportSession = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetAppleM4A
      )
    else {
      throw DanceAudioException(.exportUnsupported)
    }

    exportSession.outputURL = outputURL
    exportSession.outputFileType = .m4a
    exportSession.shouldOptimizeForNetworkUse = false

    taskRegistry.setCancellationHandler(
      {
        exportSession.cancelExport()
      },
      for: handle
    )
    defer {
      taskRegistry.clearCancellationHandler(for: handle)
    }

    try taskRegistry.throwIfCancelled(handle)

    let progressTask = Task {
      while !Task.isCancelled {
        if !self.taskRegistry.isActive(handle) {
          exportSession.cancelExport()
          return
        }

        progressReporter.report(Double(exportSession.progress))
        do {
          try await Task.sleep(nanoseconds: 200_000_000)
        } catch {
          return
        }
      }
    }

    do {
      try await awaitExportCompletion(exportSession)
    } catch {
      progressTask.cancel()
      await progressTask.value
      throw error
    }

    progressTask.cancel()
    await progressTask.value
    try taskRegistry.throwIfCancelled(handle)
  }

  private func determineAppleM4ACompatibility(for asset: AVAsset) async -> Bool {
    await withCheckedContinuation { continuation in
      AVAssetExportSession.determineCompatibility(
        ofExportPreset: AVAssetExportPresetAppleM4A,
        with: asset,
        outputFileType: .m4a
      ) { isCompatible in
        continuation.resume(returning: isCompatible)
      }
    }
  }

  private func awaitExportCompletion(
    _ exportSession: AVAssetExportSession
  ) async throws {
    try await withCheckedThrowingContinuation { continuation in
      exportSession.exportAsynchronously {
        switch exportSession.status {
        case .completed:
          continuation.resume()
        case .cancelled:
          continuation.resume(throwing: DanceAudioException(.cancelled))
        case .failed:
          continuation.resume(
            throwing: DanceAudioException(
              .exportFailed,
              message: "Apple M4A export failed.",
              cause: exportSession.error
            )
          )
        case .unknown, .waiting, .exporting:
          continuation.resume(
            throwing: DanceAudioException(
              .exportFailed,
              message: "Apple M4A export ended in an unexpected state.",
              cause: exportSession.error
            )
          )
        @unknown default:
          continuation.resume(
            throwing: DanceAudioException(
              .exportFailed,
              message: "Apple M4A export returned an unknown status.",
              cause: exportSession.error
            )
          )
        }
      }
    }
  }

  private func validateOutput(
    at outputURL: URL,
    handle: NativeTaskHandle
  ) async throws -> NativeExtractAudioResult {
    guard fileManager.fileExists(atPath: outputURL.path) else {
      throw DanceAudioException(
        .exportFailed,
        message: "Audio export completed without creating an output file."
      )
    }

    let attributes: [FileAttributeKey: Any]
    do {
      attributes = try fileManager.attributesOfItem(atPath: outputURL.path)
    } catch {
      throw DanceAudioException(
        .exportFailed,
        message: "The exported audio file could not be inspected.",
        cause: error
      )
    }

    guard
      let sizeNumber = attributes[.size] as? NSNumber,
      sizeNumber.int64Value > 0,
      sizeNumber.int64Value <= Int64(Int.max)
    else {
      throw DanceAudioException(
        .exportFailed,
        message: "The exported audio file is empty or too large."
      )
    }

    let outputAsset = AVURLAsset(url: outputURL)
    taskRegistry.setCancellationHandler(
      {
        outputAsset.cancelLoading()
      },
      for: handle
    )
    defer {
      taskRegistry.clearCancellationHandler(for: handle)
    }

    do {
      try taskRegistry.throwIfCancelled(handle)
      let tracks = try await outputAsset.loadTracks(withMediaType: .audio)
      guard !tracks.isEmpty else {
        throw DanceAudioException(
          .exportFailed,
          message: "The exported M4A does not contain an audio track."
        )
      }

      let duration = try await outputAsset.load(.duration)
      try taskRegistry.throwIfCancelled(handle)
      let seconds = CMTimeGetSeconds(duration)
      guard
        duration.isValid,
        seconds.isFinite,
        seconds > 0,
        seconds * 1_000 <= Double(Int.max)
      else {
        throw DanceAudioException(
          .exportFailed,
          message: "The exported audio duration is invalid."
        )
      }

      let durationMs = Int((seconds * 1_000).rounded())
      guard durationMs > 0 else {
        throw DanceAudioException(
          .exportFailed,
          message: "The exported audio duration is too short."
        )
      }

      return NativeExtractAudioResult(
        durationMs: durationMs,
        outputBytes: Int(sizeNumber.int64Value)
      )
    } catch let error as DanceAudioException {
      throw error
    } catch {
      if !taskRegistry.isActive(handle) {
        throw DanceAudioException(.cancelled, cause: error)
      }
      throw DanceAudioException(
        .exportFailed,
        message: "The exported audio metadata could not be loaded.",
        cause: error
      )
    }
  }

  private func removePartialOutput(at outputURL: URL) {
    guard fileManager.fileExists(atPath: outputURL.path) else {
      return
    }
    try? fileManager.removeItem(at: outputURL)
  }

  private func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError {
      return true
    }
    return (error as? DanceAudioException)?.isCancellation == true
  }
}
