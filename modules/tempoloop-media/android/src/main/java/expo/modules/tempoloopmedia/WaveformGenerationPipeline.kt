package expo.modules.tempoloopmedia

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File

internal class WaveformGenerationPipeline(
  private val waveformGenerator: WaveformGenerator,
  private val taskRegistry: NativeTaskRegistry,
  private val allowedInputRoots: () -> Collection<File>
) {
  suspend fun generate(
    options: GenerateWaveformOptions,
    onProgress: (Double) -> Unit
  ): GenerateWaveformResult {
    validateOptions(options)
    val audioFile = PrivateOutputPath.requireSafeFileUri(options.audioUri, allowedInputRoots())
    if (!audioFile.isFile || !audioFile.canRead() || audioFile.length() <= 0L) {
      throw mediaError(TempoLoopMediaError.AUDIO_NOT_FOUND)
    }

    return try {
      val generated = waveformGenerator.generate(
        audioFile = audioFile,
        durationMs = options.durationMs,
        binCount = options.waveformBinCount,
        onProgress = onProgress,
        cancellationCheck = {
          if (taskRegistry.isWaveformCancellationRequested(options.operationId)) {
            throw ImportCancellationSignal()
          }
        }
      )
      checkCancellation(options.operationId)
      if (
        generated.samples.size != options.waveformBinCount ||
        generated.sampledFrameCount > options.waveformBinCount.toLong() * MAX_SAMPLES_PER_BIN ||
        generated.samples.any { !it.isFinite() || it !in 0.0..1.0 }
      ) {
        throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
      }
      GenerateWaveformResult(
        durationMs = options.durationMs,
        sampleCount = generated.samples.size,
        samples = generated.samples,
        decodedFrameCount = generated.decodedFrameCount,
        sampledFrameCount = generated.sampledFrameCount,
        elapsedMs = generated.elapsedMs
      )
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED, error)
    }
  }

  private suspend fun checkCancellation(operationId: String) {
    currentCoroutineContext().ensureActive()
    if (taskRegistry.isWaveformCancellationRequested(operationId)) {
      throw ImportCancellationSignal()
    }
  }

  private fun validateOptions(options: GenerateWaveformOptions) {
    if (
      options.operationId.isBlank() ||
      options.operationId.any(Char::isISOControl) ||
      options.durationMs <= 0L ||
      options.waveformBinCount != REQUIRED_WAVEFORM_BIN_COUNT
    ) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
    }
  }

  private companion object {
    const val REQUIRED_WAVEFORM_BIN_COUNT = 2_048
    const val MAX_SAMPLES_PER_BIN = 256L
  }
}
