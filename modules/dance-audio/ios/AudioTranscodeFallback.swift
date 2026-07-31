import AudioToolbox
import AVFoundation
import CoreMedia
import Foundation

final class AudioTranscodeFallback {
  private struct SourceAudioFormat {
    let sampleRate: Double
    let channelCount: Int
  }

  private let taskRegistry: NativeTaskRegistry
  private let fileManager: FileManager

  init(
    taskRegistry: NativeTaskRegistry,
    fileManager: FileManager = .default
  ) {
    self.taskRegistry = taskRegistry
    self.fileManager = fileManager
  }

  func transcode(
    handle: NativeTaskHandle,
    inputURL: URL,
    outputURL: URL,
    progressReporter: NativeImportProgressReporter
  ) async throws {
    try taskRegistry.throwIfCancelled(handle)

    let asset = AVURLAsset(url: inputURL)
    taskRegistry.setCancellationHandler(
      {
        asset.cancelLoading()
      },
      for: handle
    )
    let tracks: [AVAssetTrack]
    let duration: CMTime
    do {
      tracks = try await asset.loadTracks(withMediaType: .audio)
      duration = try await asset.load(.duration)
    } catch {
      taskRegistry.clearCancellationHandler(for: handle)
      if !taskRegistry.isActive(handle) {
        throw DanceAudioException(.cancelled, cause: error)
      }
      throw DanceAudioException(
        .exportFailed,
        message: "The audio track could not be prepared for transcoding.",
        cause: error
      )
    }

    guard let audioTrack = tracks.first else {
      taskRegistry.clearCancellationHandler(for: handle)
      throw DanceAudioException(.noAudioTrack)
    }

    let durationSeconds = CMTimeGetSeconds(duration)
    guard duration.isValid, durationSeconds.isFinite, durationSeconds > 0 else {
      throw DanceAudioException(
        .exportFailed,
        message: "The source audio duration is invalid."
      )
    }

    let sourceFormat: SourceAudioFormat
    do {
      sourceFormat = try await loadSourceFormat(from: audioTrack)
    } catch {
      taskRegistry.clearCancellationHandler(for: handle)
      if !taskRegistry.isActive(handle) {
        throw DanceAudioException(.cancelled, cause: error)
      }
      throw error
    }
    taskRegistry.clearCancellationHandler(for: handle)
    try taskRegistry.throwIfCancelled(handle)
    let targetSampleRate = preferredTargetSampleRate(
      sourceSampleRate: sourceFormat.sampleRate
    )
    let targetChannelCount = min(max(sourceFormat.channelCount, 1), 2)

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
    } catch {
      throw DanceAudioException(
        .exportFailed,
        message: "The AAC transcoder could not be created.",
        cause: error
      )
    }

    let readerSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: targetSampleRate,
      AVNumberOfChannelsKey: targetChannelCount,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let readerOutput = AVAssetReaderTrackOutput(
      track: audioTrack,
      outputSettings: readerSettings
    )
    readerOutput.alwaysCopiesSampleData = false

    guard reader.canAdd(readerOutput) else {
      throw DanceAudioException(
        .exportUnsupported,
        message: "The source audio cannot be decoded as linear PCM."
      )
    }
    reader.add(readerOutput)

    let bitrate = targetChannelCount == 1 ? 96_000 : 192_000
    let writerSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: targetSampleRate,
      AVNumberOfChannelsKey: targetChannelCount,
      AVEncoderBitRateKey: bitrate,
      AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]

    guard writer.canApply(outputSettings: writerSettings, forMediaType: .audio) else {
      throw DanceAudioException(
        .exportUnsupported,
        message: "The device cannot apply the requested AAC output settings."
      )
    }

    let writerInput = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: writerSettings
    )
    writerInput.expectsMediaDataInRealTime = false

    guard writer.canAdd(writerInput) else {
      throw DanceAudioException(
        .exportUnsupported,
        message: "The AAC writer cannot accept an audio input."
      )
    }
    writer.add(writerInput)

    taskRegistry.setCancellationHandler(
      {
        reader.cancelReading()
        writer.cancelWriting()
      },
      for: handle
    )
    defer {
      taskRegistry.clearCancellationHandler(for: handle)
    }

    do {
      try taskRegistry.throwIfCancelled(handle)

      guard writer.startWriting() else {
        throw DanceAudioException(
          .exportFailed,
          message: "The AAC writer could not start.",
          cause: writer.error
        )
      }
      writer.startSession(atSourceTime: .zero)

      guard reader.startReading() else {
        writer.cancelWriting()
        throw DanceAudioException(
          .exportFailed,
          message: "The source audio reader could not start.",
          cause: reader.error
        )
      }

      var reachedEndOfInput = false
      while !reachedEndOfInput {
        try Task.checkCancellation()
        try taskRegistry.throwIfCancelled(handle)

        if let failure = terminalFailure(reader: reader, writer: writer) {
          throw failure
        }

        if !writerInput.isReadyForMoreMediaData {
          try await Task.sleep(nanoseconds: 5_000_000)
          continue
        }

        guard let sampleBuffer = readerOutput.copyNextSampleBuffer() else {
          reachedEndOfInput = true
          continue
        }

        guard writerInput.append(sampleBuffer) else {
          throw DanceAudioException(
            .exportFailed,
            message: "An audio sample could not be appended to the AAC writer.",
            cause: writer.error
          )
        }

        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let presentationSeconds = CMTimeGetSeconds(presentationTime)
        if presentationSeconds.isFinite {
          progressReporter.report(presentationSeconds / durationSeconds)
        }
      }

      if reader.status == .failed {
        throw DanceAudioException(
          .exportFailed,
          message: "The source audio reader failed before reaching the end.",
          cause: reader.error
        )
      }
      if reader.status == .cancelled {
        throw DanceAudioException(.cancelled, cause: reader.error)
      }

      writerInput.markAsFinished()
      await finishWriting(writer)

      try taskRegistry.throwIfCancelled(handle)
      switch writer.status {
      case .completed:
        return
      case .cancelled:
        throw DanceAudioException(.cancelled, cause: writer.error)
      case .failed:
        throw DanceAudioException(
          .exportFailed,
          message: "The AAC writer failed to finish the M4A output.",
          cause: writer.error
        )
      case .unknown, .writing:
        throw DanceAudioException(
          .exportFailed,
          message: "The AAC writer ended in an unexpected state.",
          cause: writer.error
        )
      @unknown default:
        throw DanceAudioException(
          .exportFailed,
          message: "The AAC writer returned an unknown status.",
          cause: writer.error
        )
      }
    } catch {
      reader.cancelReading()
      writer.cancelWriting()
      if fileManager.fileExists(atPath: outputURL.path) {
        try? fileManager.removeItem(at: outputURL)
      }

      if error is CancellationError {
        throw DanceAudioException(.cancelled, cause: error)
      }
      if let danceAudioError = error as? DanceAudioException {
        throw danceAudioError
      }
      throw DanceAudioException(
        .exportFailed,
        message: "AAC transcoding failed.",
        cause: error
      )
    }
  }

  private func loadSourceFormat(
    from track: AVAssetTrack
  ) async throws -> SourceAudioFormat {
    let descriptions: [CMFormatDescription]
    do {
      descriptions = try await track.load(.formatDescriptions)
    } catch {
      throw DanceAudioException(
        .exportFailed,
        message: "The source audio format could not be loaded.",
        cause: error
      )
    }

    for description in descriptions {
      guard
        let streamDescription =
          CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee
      else {
        continue
      }

      let sampleRate = streamDescription.mSampleRate
      let channelCount = Int(streamDescription.mChannelsPerFrame)
      if sampleRate.isFinite, sampleRate > 0, channelCount > 0 {
        return SourceAudioFormat(
          sampleRate: sampleRate,
          channelCount: channelCount
        )
      }
    }

    throw DanceAudioException(
      .exportUnsupported,
      message: "The source audio format is not usable."
    )
  }

  private func preferredTargetSampleRate(sourceSampleRate: Double) -> Double {
    sourceSampleRate >= 46_000 ? 48_000 : 44_100
  }

  private func terminalFailure(
    reader: AVAssetReader,
    writer: AVAssetWriter
  ) -> DanceAudioException? {
    switch reader.status {
    case .failed:
      return DanceAudioException(
        .exportFailed,
        message: "The source audio reader failed.",
        cause: reader.error
      )
    case .cancelled:
      return DanceAudioException(.cancelled, cause: reader.error)
    case .unknown, .reading, .completed:
      break
    @unknown default:
      return DanceAudioException(
        .exportFailed,
        message: "The source audio reader returned an unknown status.",
        cause: reader.error
      )
    }

    switch writer.status {
    case .failed:
      return DanceAudioException(
        .exportFailed,
        message: "The AAC writer failed.",
        cause: writer.error
      )
    case .cancelled:
      return DanceAudioException(.cancelled, cause: writer.error)
    case .unknown, .writing, .completed:
      return nil
    @unknown default:
      return DanceAudioException(
        .exportFailed,
        message: "The AAC writer returned an unknown status.",
        cause: writer.error
      )
    }
  }

  private func finishWriting(_ writer: AVAssetWriter) async {
    await withCheckedContinuation { continuation in
      writer.finishWriting {
        continuation.resume()
      }
    }
  }
}
