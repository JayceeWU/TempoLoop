package expo.modules.tempoloopmedia

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File

internal class MediaImportPipeline(
  context: Context,
  private val ioDispatcher: CoroutineDispatcher,
  private val mediaInspector: MediaInspector,
  private val waveformGenerator: WaveformGenerator,
  private val audioExporter: Media3AudioExporter,
  private val taskRegistry: NativeTaskRegistry,
  private val progressSink: ImportProgressSink,
  private val allowedOutputRoots: () -> Collection<File>
) {
  private val applicationContext = context.applicationContext

  suspend fun import(options: ImportMediaOptions): ImportMediaResult {
    val stateMachine = ImportStateMachine()
    val progress = ImportProgressTracker(options.operationId, progressSink)
    var partialOutput: File? = null
    var completed = false
    var terminalError: Throwable? = null

    stateMachine.transition(ImportOperationState.INSPECTING)
    progress.begin(ImportStage.INSPECTING, determinate = false)

    return try {
      withContext(ioDispatcher) {
        val parsedSource = validateOptions(options)
        val outputFile = PrivateOutputPath.requireSafeImportFileUri(
          options.outputAudioUri,
          allowedOutputRoots(),
          parsedSource
        )
        // Assign only after source/output equality has been rejected. Otherwise
        // failure cleanup could delete a file:// source that aliases the output.
        partialOutput = outputFile
        prepareOutput(outputFile)
        checkCancellation(options.operationId)

        val inspectionDetails = mediaInspector.inspectForImport(
          InspectMediaOptions(
            sourceUri = options.sourceUri,
            maxAudioSourceBytes = options.maxAudioSourceBytes,
            maxVideoSourceBytes = options.maxVideoSourceBytes
          )
        )
        val inspection = inspectionDetails.inspection
        if (inspection.sourceSizeBytes == null) {
          BoundedSourceReader.verifyWithinLimit(
            context = applicationContext,
            sourceUri = options.sourceUri,
            sourceKind = inspection.sourceKind,
            requestedMaxAudioSourceBytes = options.maxAudioSourceBytes,
            requestedMaxVideoSourceBytes = options.maxVideoSourceBytes,
            cancellationCheck = { checkCancellationSignal(options.operationId) },
            onBytesRead = { progress.heartbeat() },
            ioDispatcher = ioDispatcher
          )
        }
        checkCancellation(options.operationId)

        val storageEstimate = ImportStorageEstimator.estimate(
          durationMs = inspection.durationMs,
          sourceAudioBitrateBitsPerSecond = inspectionDetails.audioBitrateBitsPerSecond
        )
        AppPrivateStorageGuard.requireSpace(outputFile, storageEstimate)
        progress.completeStage()

        stateMachine.transition(ImportOperationState.EXPORTING)
        progress.begin(ImportStage.EXPORTING, determinate = false)
        val exportResult = audioExporter.export(
          sourceUri = options.sourceUri,
          sourceKind = inspection.sourceKind,
          outputFile = outputFile,
          onProgress = { value -> progress.update(value) },
          onHeartbeat = { progress.heartbeat() },
          attachResource = { resource ->
            taskRegistry.attachResource(options.operationId, resource)
          },
          detachResource = { resource ->
            taskRegistry.detachResource(options.operationId, resource)
          }
        )
        checkCancellation(options.operationId)
        if (
          !exportResult.audioWasExported ||
          !outputFile.isFile ||
          outputFile.length() <= 0L
        ) {
          throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)
        }
        val exportedOutput = ExportedAudioValidator.validate(outputFile)
        progress.completeStage()

        stateMachine.transition(ImportOperationState.WAVEFORM)
        progress.begin(ImportStage.WAVEFORM)
        val waveform = waveformGenerator.generate(
          audioFile = outputFile,
          durationMs = exportedOutput.durationMs,
          binCount = options.waveformBinCount,
          onProgress = { value -> progress.update(value) },
          cancellationCheck = { checkCancellationSignal(options.operationId) }
        )
        validateWaveform(waveform, options.waveformBinCount)
        checkCancellation(options.operationId)
        progress.completeStage()

        stateMachine.transition(ImportOperationState.FINALIZING)
        progress.begin(ImportStage.FINALIZING)
        val validatedOutput = ExportedAudioValidator.validate(outputFile)
        if (
          validatedOutput.durationMs != exportedOutput.durationMs ||
          validatedOutput.sizeBytes != exportedOutput.sizeBytes
        ) {
          throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)
        }
        checkCancellation(options.operationId)
        progress.completeStage()

        stateMachine.transition(ImportOperationState.COMPLETED)
        ImportMediaResult(
          // PrivateOutputPath already parsed, canonicalized, and constrained
          // this exact caller-provided URI to app-private storage. Return the
          // contract value verbatim instead of rebuilding an equivalent URI
          // with Android Uri, which can change file:/ vs file:/// formatting
          // and make the TypeScript destination-integrity check fail.
          audioUri = options.outputAudioUri,
          audioSizeBytes = validatedOutput.sizeBytes,
          durationMs = validatedOutput.durationMs,
          waveform = waveform
        ).also {
          completed = true
        }
      }
    } catch (error: CancellationException) {
      completed = false
      stateMachine.cancel()
      terminalError = error
      throw error
    } catch (error: TempoLoopMediaException) {
      completed = false
      if (error.error == TempoLoopMediaError.IMPORT_CANCELLED) {
        stateMachine.cancel()
      } else {
        stateMachine.fail()
      }
      terminalError = error
      throw error
    } catch (error: Throwable) {
      completed = false
      stateMachine.fail()
      val mappedError = mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error)
      terminalError = mappedError
      throw mappedError
    } finally {
      if (!completed) {
        withContext(NonCancellable + ioDispatcher) {
          val output = partialOutput
          if (output != null && !deletePartialOutput(output)) {
            val cleanupError = mediaError(TempoLoopMediaError.OUTPUT_WRITE_FAILED)
            val originalError = terminalError
            if (originalError == null) {
              throw cleanupError
            }
            originalError.addSuppressed(cleanupError)
          }
        }
      }
    }
  }

  private suspend fun checkCancellation(operationId: String) {
    currentCoroutineContext().ensureActive()
    checkCancellationSignal(operationId)
  }

  private fun checkCancellationSignal(operationId: String) {
    if (taskRegistry.isCancellationRequested(operationId)) {
      throw ImportCancellationSignal()
    }
  }

  private fun validateOptions(options: ImportMediaOptions): ParsedSourceUri {
    if (
      options.operationId.isBlank() ||
      options.operationId.any(Char::isISOControl) ||
      options.waveformBinCount <= 0 ||
      options.waveformBinCount > MAX_WAVEFORM_BIN_COUNT
    ) {
      throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE)
    }
    val parsedSource = SourceUriParser.parse(options.sourceUri)
    SourceSizePolicy.effectiveLimit(
      SourceMediaKind.AUDIO,
      options.maxAudioSourceBytes,
      options.maxVideoSourceBytes
    )
    SourceSizePolicy.effectiveLimit(
      SourceMediaKind.VIDEO,
      options.maxAudioSourceBytes,
      options.maxVideoSourceBytes
    )
    return parsedSource
  }

  private fun prepareOutput(outputFile: File) {
    val parent = outputFile.parentFile
      ?: throw mediaError(TempoLoopMediaError.OUTPUT_WRITE_FAILED)
    if ((!parent.exists() && !parent.mkdirs()) || !parent.isDirectory || !parent.canWrite()) {
      throw mediaError(TempoLoopMediaError.OUTPUT_WRITE_FAILED)
    }
    if (outputFile.exists() && !outputFile.delete()) {
      throw mediaError(TempoLoopMediaError.OUTPUT_WRITE_FAILED)
    }
  }

  private fun deletePartialOutput(outputFile: File): Boolean {
    repeat(PARTIAL_DELETE_ATTEMPTS) {
      if (!outputFile.exists() || outputFile.delete()) {
        return true
      }
    }
    return !outputFile.exists()
  }

  private fun validateWaveform(waveform: List<Double>, expectedBinCount: Int) {
    if (
      waveform.size != expectedBinCount ||
      waveform.any { sample -> !sample.isFinite() || sample !in 0.0..1.0 }
    ) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
    }
  }

  private companion object {
    const val MAX_WAVEFORM_BIN_COUNT = 16_384
    const val PARTIAL_DELETE_ATTEMPTS = 3
  }
}
