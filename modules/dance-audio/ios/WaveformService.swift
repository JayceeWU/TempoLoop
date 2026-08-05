import AudioToolbox
import AVFoundation
import CoreMedia
import Foundation

final class WaveformService {
  private struct DecodedAudioFormat {
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

  func generateWaveform(
    handle: NativeTaskHandle,
    audioURL: URL,
    pointCount: Int,
    progressReporter: NativeImportProgressReporter
  ) async throws -> [Double] {
    guard pointCount == NativeArgumentValidator.requiredWaveformPointCount else {
      throw DanceAudioException(.invalidPointCount)
    }
    guard
      audioURL.isFileURL,
      fileManager.fileExists(atPath: audioURL.path)
    else {
      throw DanceAudioException(.fileNotFound)
    }

    try taskRegistry.throwIfCancelled(handle)

    do {
      let asset = AVURLAsset(url: audioURL)
      taskRegistry.setCancellationHandler(
        {
          asset.cancelLoading()
        },
        for: handle
      )

      let tracks: [AVAssetTrack]
      do {
        tracks = try await asset.loadTracks(withMediaType: .audio)
      } catch {
        taskRegistry.clearCancellationHandler(for: handle)
        if !taskRegistry.isActive(handle) {
          throw DanceAudioException(.cancelled, cause: error)
        }
        throw error
      }
      guard let track = tracks.first else {
        taskRegistry.clearCancellationHandler(for: handle)
        throw DanceAudioException(
          .waveformFailed,
          message: "The extracted audio does not contain a readable track."
        )
      }

      let duration: CMTime
      let audioFormat: DecodedAudioFormat
      do {
        duration = try await asset.load(.duration)
        audioFormat = try await loadDecodedAudioFormat(from: track)
      } catch {
        taskRegistry.clearCancellationHandler(for: handle)
        if !taskRegistry.isActive(handle) {
          throw DanceAudioException(.cancelled, cause: error)
        }
        throw error
      }
      taskRegistry.clearCancellationHandler(for: handle)
      try taskRegistry.throwIfCancelled(handle)

      let durationSeconds = CMTimeGetSeconds(duration)
      guard duration.isValid, durationSeconds.isFinite, durationSeconds > 0 else {
        throw DanceAudioException(
          .waveformFailed,
          message: "The extracted audio duration is invalid."
        )
      }

      let reader = try AVAssetReader(asset: asset)
      let outputSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: audioFormat.sampleRate,
        AVNumberOfChannelsKey: audioFormat.channelCount,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ]
      let output = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: outputSettings
      )
      output.alwaysCopiesSampleData = false

      guard reader.canAdd(output) else {
        throw DanceAudioException(
          .waveformFailed,
          message: "The audio track cannot be decoded for waveform generation."
        )
      }
      reader.add(output)

      taskRegistry.setCancellationHandler(
        {
          reader.cancelReading()
        },
        for: handle
      )
      defer {
        taskRegistry.clearCancellationHandler(for: handle)
      }

      try taskRegistry.throwIfCancelled(handle)
      guard reader.startReading() else {
        throw DanceAudioException(
          .waveformFailed,
          message: "The waveform audio reader could not start.",
          cause: reader.error
        )
      }

      var squareSums = [Double](repeating: 0, count: pointCount)
      var sampleCounts = [UInt64](repeating: 0, count: pointCount)

      while let sampleBuffer = output.copyNextSampleBuffer() {
        try Task.checkCancellation()
        try taskRegistry.throwIfCancelled(handle)

        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let presentationSeconds = CMTimeGetSeconds(presentationTime)
        let bufferStartSeconds =
          presentationSeconds.isFinite ? max(presentationSeconds, 0) : 0

        try accumulate(
          sampleBuffer: sampleBuffer,
          bufferStartSeconds: bufferStartSeconds,
          sampleRate: audioFormat.sampleRate,
          durationSeconds: durationSeconds,
          squareSums: &squareSums,
          sampleCounts: &sampleCounts
        )

        let sampleDuration = CMSampleBufferGetDuration(sampleBuffer)
        let sampleDurationSeconds = CMTimeGetSeconds(sampleDuration)
        let progressTime =
          sampleDurationSeconds.isFinite
            ? bufferStartSeconds + max(sampleDurationSeconds, 0)
            : bufferStartSeconds
        progressReporter.report(progressTime / durationSeconds)
      }

      try taskRegistry.throwIfCancelled(handle)
      switch reader.status {
      case .completed:
        break
      case .cancelled:
        throw DanceAudioException(.cancelled, cause: reader.error)
      case .failed:
        throw DanceAudioException(
          .waveformFailed,
          message: "The waveform audio reader failed.",
          cause: reader.error
        )
      case .unknown, .reading:
        throw DanceAudioException(
          .waveformFailed,
          message: "The waveform audio reader ended in an unexpected state.",
          cause: reader.error
        )
      @unknown default:
        throw DanceAudioException(
          .waveformFailed,
          message: "The waveform audio reader returned an unknown status.",
          cause: reader.error
        )
      }

      let amplitudes = Self.normalizeRMS(
        squareSums: squareSums,
        sampleCounts: sampleCounts
      )
      guard
        amplitudes.count == pointCount,
        amplitudes.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 })
      else {
        throw DanceAudioException(
          .waveformFailed,
          message: "Waveform normalization produced invalid values."
        )
      }

      try taskRegistry.throwIfCancelled(handle)
      progressReporter.report(1)
      return amplitudes
    } catch is CancellationError {
      throw DanceAudioException(.cancelled)
    } catch let error as DanceAudioException {
      throw error
    } catch {
      throw DanceAudioException(
        .waveformFailed,
        message: "The audio waveform could not be generated.",
        cause: error
      )
    }
  }

  static func normalizeRMS(
    squareSums: [Double],
    sampleCounts: [UInt64]
  ) -> [Double] {
    guard squareSums.count == sampleCounts.count else {
      return []
    }

    let rmsValues = zip(squareSums, sampleCounts).map { squareSum, sampleCount in
      guard
        squareSum.isFinite,
        squareSum > 0,
        sampleCount > 0
      else {
        return 0.0
      }

      let meanSquare = squareSum / Double(sampleCount)
      guard meanSquare.isFinite, meanSquare > 0 else {
        return 0.0
      }
      return sqrt(meanSquare)
    }

    let positiveValues = rmsValues
      .filter { $0.isFinite && $0 > 0 }
      .sorted()
    guard !positiveValues.isEmpty else {
      return [Double](repeating: 0, count: rmsValues.count)
    }

    let percentilePosition = Double(positiveValues.count - 1) * 0.99
    let percentileIndex = min(
      max(Int(percentilePosition.rounded(.up)), 0),
      positiveValues.count - 1
    )
    let robustPeak = positiveValues[percentileIndex]
    let maximum = positiveValues[positiveValues.count - 1]
    let normalizationScale =
      robustPeak.isFinite && robustPeak > Double.ulpOfOne
        ? robustPeak
        : maximum

    guard normalizationScale.isFinite, normalizationScale > 0 else {
      return [Double](repeating: 0, count: rmsValues.count)
    }

    return rmsValues.map { value in
      guard value.isFinite, value > 0 else {
        return 0
      }
      return min(max(value / normalizationScale, 0), 1)
    }
  }

  private func loadDecodedAudioFormat(
    from track: AVAssetTrack
  ) async throws -> DecodedAudioFormat {
    let descriptions = try await track.load(.formatDescriptions)

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
        return DecodedAudioFormat(
          sampleRate: sampleRate,
          channelCount: channelCount
        )
      }
    }

    throw DanceAudioException(
      .waveformFailed,
      message: "The extracted audio format is not usable."
    )
  }

  private func accumulate(
    sampleBuffer: CMSampleBuffer,
    bufferStartSeconds: Double,
    sampleRate: Double,
    durationSeconds: Double,
    squareSums: inout [Double],
    sampleCounts: inout [UInt64]
  ) throws {
    var requiredBufferListSize = 0
    let sizeStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: &requiredBufferListSize,
      bufferListOut: nil,
      bufferListSize: 0,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
      blockBufferOut: nil
    )

    guard
      sizeStatus == noErr,
      requiredBufferListSize >= MemoryLayout<AudioBufferList>.size
    else {
      throw DanceAudioException(
        .waveformFailed,
        message: "An audio sample buffer could not be inspected."
      )
    }

    let rawBufferList = UnsafeMutableRawPointer.allocate(
      byteCount: requiredBufferListSize,
      alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer {
      rawBufferList.deallocate()
    }

    let bufferList = rawBufferList.bindMemory(
      to: AudioBufferList.self,
      capacity: 1
    )
    var retainedBlockBuffer: CMBlockBuffer?
    let bufferStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: nil,
      bufferListOut: bufferList,
      bufferListSize: requiredBufferListSize,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
      blockBufferOut: &retainedBlockBuffer
    )

    guard bufferStatus == noErr else {
      throw DanceAudioException(
        .waveformFailed,
        message: "PCM audio samples could not be accessed."
      )
    }

    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0 else {
      return
    }

    let audioBuffers = UnsafeMutableAudioBufferListPointer(bufferList)
    for audioBuffer in audioBuffers {
      let byteCount = Int(audioBuffer.mDataByteSize)
      guard
        let data = audioBuffer.mData,
        byteCount >= MemoryLayout<Float>.size
      else {
        continue
      }

      let channelsInBuffer = max(Int(audioBuffer.mNumberChannels), 1)
      let valueCount = byteCount / MemoryLayout<Float>.size
      let availableFrames = min(frameCount, valueCount / channelsInBuffer)
      let samples = data.assumingMemoryBound(to: Float.self)

      for frameIndex in 0..<availableFrames {
        let sampleTime =
          bufferStartSeconds + (Double(frameIndex) / sampleRate)
        let bucketPosition =
          (sampleTime / durationSeconds) * Double(squareSums.count)
        let bucketIndex = min(
          max(Int(bucketPosition), 0),
          squareSums.count - 1
        )
        let frameOffset = frameIndex * channelsInBuffer

        for channelIndex in 0..<channelsInBuffer {
          let sample = Double(samples[frameOffset + channelIndex])
          guard sample.isFinite else {
            continue
          }

          let boundedMagnitude = min(abs(sample), 16)
          squareSums[bucketIndex] += boundedMagnitude * boundedMagnitude
          sampleCounts[bucketIndex] += 1
        }
      }
    }

    _ = retainedBlockBuffer
  }
}
