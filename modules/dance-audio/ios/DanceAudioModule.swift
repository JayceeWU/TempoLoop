import ExpoModulesCore

public final class DanceAudioModule: Module {
  private let taskRegistry = NativeTaskRegistry()
  private lazy var extractionService = AudioExtractionService(
    taskRegistry: taskRegistry
  )
  private lazy var waveformService = WaveformService(
    taskRegistry: taskRegistry
  )
  private var audioController: DanceAudioController?

  public func definition() -> ModuleDefinition {
    Name("DanceAudio")

    Events("onImportProgress", "onPlaybackChanged")

    AsyncFunction("healthCheck") { () -> [String: Any] in
      NativeHealthCheckResult(available: true, apiVersion: 1).dictionary
    }

    AsyncFunction("extractAudio") {
      (
        taskId: String,
        inputVideoUri: String,
        outputAudioUri: String
      ) async throws -> [String: Any] in
      let validatedTaskId = try NativeArgumentValidator.taskId(taskId)
      let inputURL = try NativeArgumentValidator.localFileURL(
        inputVideoUri,
        parameter: "inputVideoUri",
        mustExist: true
      )
      let outputURL = try NativeArgumentValidator.localFileURL(
        outputAudioUri,
        parameter: "outputAudioUri",
        mustExist: false
      )
      guard inputURL != outputURL else {
        throw DanceAudioException(
          .invalidUri,
          message: "inputVideoUri and outputAudioUri must refer to different files."
        )
      }

      let handle = try taskRegistry.begin(taskId: validatedTaskId)
      let progressReporter = makeProgressReporter(
        handle: handle,
        phase: .extracting
      )
      let backgroundTask = await NativeBackgroundTask(
        name: "TempoLoop audio extraction"
      ) {
        self.taskRegistry.cancel(taskId: validatedTaskId)
      }

      do {
        let result = try await extractionService.extractAudio(
          handle: handle,
          inputURL: inputURL,
          outputURL: outputURL,
          progressReporter: progressReporter
        )
        await backgroundTask.end()
        taskRegistry.finish(handle)
        return result.dictionary
      } catch {
        await backgroundTask.end()
        taskRegistry.finish(handle)
        throw normalizedImportError(error, fallbackCode: .exportFailed)
      }
    }

    AsyncFunction("generateWaveform") {
      (
        taskId: String,
        audioUri: String,
        pointCount: Double
      ) async throws -> [Double] in
      let validatedTaskId = try NativeArgumentValidator.taskId(taskId)
      let audioURL = try NativeArgumentValidator.localFileURL(
        audioUri,
        parameter: "audioUri",
        mustExist: true
      )
      let validatedPointCount = try NativeArgumentValidator.waveformPointCount(
        pointCount
      )

      let handle = try taskRegistry.begin(taskId: validatedTaskId)
      let progressReporter = makeProgressReporter(
        handle: handle,
        phase: .waveform
      )
      let backgroundTask = await NativeBackgroundTask(
        name: "TempoLoop waveform generation"
      ) {
        self.taskRegistry.cancel(taskId: validatedTaskId)
      }

      do {
        let amplitudes = try await waveformService.generateWaveform(
          handle: handle,
          audioURL: audioURL,
          pointCount: validatedPointCount,
          progressReporter: progressReporter
        )
        await backgroundTask.end()
        taskRegistry.finish(handle)
        return amplitudes
      } catch {
        await backgroundTask.end()
        taskRegistry.finish(handle)
        throw normalizedImportError(error, fallbackCode: .waveformFailed)
      }
    }

    AsyncFunction("cancelTask") { (taskId: String) throws -> Void in
      let validatedTaskId = try NativeArgumentValidator.taskId(taskId)
      taskRegistry.cancel(taskId: validatedTaskId)
    }

    AsyncFunction("loadAudio") {
      (audioUri: String) async throws -> [String: Any] in
      let audioURL = try NativeArgumentValidator.localFileURL(
        audioUri,
        parameter: "audioUri",
        mustExist: true
      )
      let controller = await self.playbackController()
      return try await controller.loadAudio(from: audioURL).dictionary
    }

    AsyncFunction("playRange") {
      (
        startMs: Double,
        endMs: Double,
        rate: Double
      ) async throws -> [String: Any] in
      let range = try NativeArgumentValidator.playbackRange(
        startMs: startMs,
        endMs: endMs
      )
      let playbackRate = try NativePlaybackRate(validating: rate)
      let controller = await self.playbackController()
      return try await controller.playRange(
        startMs: range.startMs,
        endMs: range.endMs,
        rate: playbackRate
      ).dictionary
    }

    AsyncFunction("playFrom") {
      (
        positionMs: Double,
        rate: Double
      ) async throws -> [String: Any] in
      let position = try NativeArgumentValidator.milliseconds(
        positionMs,
        parameter: "positionMs"
      )
      let playbackRate = try NativePlaybackRate(validating: rate)
      let controller = await self.playbackController()
      return try await controller.playFrom(
        positionMs: position,
        rate: playbackRate
      ).dictionary
    }

    AsyncFunction("pause") { () async throws -> [String: Any] in
      let controller = await self.playbackController()
      return await controller.pause().dictionary
    }

    AsyncFunction("resume") { () async throws -> [String: Any] in
      let controller = await self.playbackController()
      return try await controller.resume().dictionary
    }

    AsyncFunction("seek") {
      (positionMs: Double) async throws -> [String: Any] in
      let position = try NativeArgumentValidator.milliseconds(
        positionMs,
        parameter: "positionMs"
      )
      let controller = await self.playbackController()
      return try await controller.seek(positionMs: position).dictionary
    }

    AsyncFunction("setRate") {
      (rate: Double) async throws -> [String: Any] in
      let playbackRate = try NativePlaybackRate(validating: rate)
      let controller = await self.playbackController()
      return try await controller.setRate(playbackRate).dictionary
    }

    AsyncFunction("stopAndSeek") {
      (positionMs: Double) async throws -> [String: Any] in
      let position = try NativeArgumentValidator.milliseconds(
        positionMs,
        parameter: "positionMs"
      )
      let controller = await self.playbackController()
      return try await controller.stopAndSeek(positionMs: position).dictionary
    }

    AsyncFunction("getPlaybackSnapshot") { () async -> [String: Any] in
      let controller = await self.playbackController()
      return await controller.snapshot().dictionary
    }

    AsyncFunction("unload") { () async throws -> Void in
      let controller = await self.playbackController()
      try await controller.unload()
    }
  }

  private func makeProgressReporter(
    handle: NativeTaskHandle,
    phase: NativeImportPhase
  ) -> NativeImportProgressReporter {
    NativeImportProgressReporter(
      taskId: handle.taskId,
      phase: phase
    ) { [weak self] event in
      guard
        let self,
        self.taskRegistry.isActive(handle)
      else {
        return
      }
      self.sendEvent("onImportProgress", event.dictionary)
    }
  }

  private func normalizedImportError(
    _ error: Error,
    fallbackCode: DanceAudioErrorCode
  ) -> DanceAudioException {
    if error is CancellationError {
      return DanceAudioException(.cancelled, cause: error)
    }
    if let danceAudioError = error as? DanceAudioException {
      return danceAudioError
    }
    return DanceAudioException(fallbackCode, cause: error)
  }

  @MainActor
  private func playbackController() -> DanceAudioController {
    if let audioController {
      return audioController
    }

    let controller = DanceAudioController { [weak self] event in
      self?.sendEvent("onPlaybackChanged", event.dictionary)
    }
    audioController = controller
    return controller
  }
}
