package expo.modules.tempoloopmedia

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.SystemClock
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.CoroutineContext
import kotlin.math.sqrt

/**
 * Decodes the exported app-private M4A in bounded MediaCodec output buffers and
 * retains only the requested waveform accumulators.
 */
internal class WaveformGenerator(
  private val ioDispatcher: CoroutineDispatcher
) {
  suspend fun generate(
    audioFile: File,
    durationMs: Long,
    binCount: Int,
    onProgress: (Double) -> Unit = {},
    cancellationCheck: () -> Unit = {}
  ): List<Double> = withContext(ioDispatcher) {
    val coroutineContext = currentCoroutineContext()
    val checkCancellation = {
      coroutineContext.ensureActive()
      cancellationCheck()
    }

    checkCancellation()
    decode(
      audioFile = audioFile,
      durationMs = durationMs,
      binCount = binCount,
      onProgress = onProgress,
      cancellationCheck = checkCancellation,
      coroutineContext = coroutineContext
    )
  }

  private fun decode(
    audioFile: File,
    durationMs: Long,
    binCount: Int,
    onProgress: (Double) -> Unit,
    cancellationCheck: () -> Unit,
    coroutineContext: CoroutineContext
  ): List<Double> {
    if (!audioFile.isFile || !audioFile.canRead() || audioFile.length() <= 0L) {
      throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)
    }
    if (durationMs <= 0L || binCount <= 0) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
    }

    val durationUs = try {
      Math.multiplyExact(durationMs, MICROSECONDS_PER_MILLISECOND)
    } catch (error: ArithmeticException) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED, error)
    }
    val accumulator = WaveformAccumulator(durationUs, binCount)
    val progressReporter = WaveformProgressReporter(durationUs, onProgress)
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    var codecStarted = false

    try {
      extractor.setDataSource(audioFile.absolutePath)
      val track = findAudioTrack(extractor)
        ?: throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
      extractor.selectTrack(track.index)

      val decoder = MediaCodec.createDecoderByType(track.mimeType)
      codec = decoder
      decoder.configure(track.format, null, null, 0)
      decoder.start()
      codecStarted = true

      var pcmFormat = DecodedPcmFormat.from(track.format)
      var inputEnded = false
      var outputEnded = false
      val bufferInfo = MediaCodec.BufferInfo()
      progressReporter.start()

      while (!outputEnded) {
        cancellationCheck()
        coroutineContext.ensureActive()

        if (!inputEnded) {
          val inputIndex = decoder.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (inputIndex >= 0) {
            val inputBuffer = decoder.getInputBuffer(inputIndex)
              ?: throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
            inputBuffer.clear()
            val sampleSize = extractor.readSampleData(inputBuffer, 0)
            if (sampleSize < 0) {
              decoder.queueInputBuffer(
                inputIndex,
                0,
                0,
                0L,
                MediaCodec.BUFFER_FLAG_END_OF_STREAM
              )
              inputEnded = true
            } else {
              decoder.queueInputBuffer(
                inputIndex,
                0,
                sampleSize,
                extractor.sampleTime.coerceAtLeast(0L),
                0
              )
              extractor.advance()
            }
          }
        }

        when (val outputIndex = decoder.dequeueOutputBuffer(bufferInfo, CODEC_TIMEOUT_US)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            pcmFormat = DecodedPcmFormat.from(decoder.outputFormat, pcmFormat)
          }

          MediaCodec.INFO_TRY_AGAIN_LATER,
          MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit

          else -> if (outputIndex >= 0) {
            try {
              val isCodecConfiguration =
                bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
              if (bufferInfo.size > 0 && !isCodecConfiguration) {
                val outputBuffer = decoder.getOutputBuffer(outputIndex)
                  ?: throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
                consumePcmBuffer(
                  buffer = outputBuffer,
                  info = bufferInfo,
                  format = pcmFormat,
                  accumulator = accumulator,
                  cancellationCheck = cancellationCheck
                )
                progressReporter.update(bufferInfo.presentationTimeUs)
              }
              if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                outputEnded = true
              }
            } finally {
              decoder.releaseOutputBuffer(outputIndex, false)
            }
          }
        }
      }

      cancellationCheck()
      val waveform = accumulator.finish()
      if (
        waveform.size != binCount ||
        waveform.any { !it.isFinite() || it !in 0.0..1.0 }
      ) {
        throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
      }
      progressReporter.finish()
      return waveform
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED, error)
    } finally {
      if (codecStarted) {
        runCatching { codec?.stop() }
      }
      runCatching { codec?.release() }
      runCatching { extractor.release() }
    }
  }

  private fun findAudioTrack(extractor: MediaExtractor): AudioTrack? {
    for (index in 0 until extractor.trackCount) {
      val format = extractor.getTrackFormat(index)
      val mimeType = format.readString(MediaFormat.KEY_MIME)
      if (mimeType?.startsWith("audio/") == true) {
        return AudioTrack(index, mimeType, format)
      }
    }
    return null
  }

  private fun consumePcmBuffer(
    buffer: ByteBuffer,
    info: MediaCodec.BufferInfo,
    format: DecodedPcmFormat,
    accumulator: WaveformAccumulator,
    cancellationCheck: () -> Unit
  ) {
    val bytesPerSample = format.bytesPerSample
    val bytesPerFrame = bytesPerSample * format.channelCount
    if (
      info.offset < 0 ||
      info.size < 0 ||
      info.offset > buffer.capacity() - info.size ||
      bytesPerFrame <= 0 ||
      info.size % bytesPerFrame != 0
    ) {
      throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
    }

    val frameCount = info.size / bytesPerFrame
    if (frameCount == 0) {
      return
    }
    val startOffset = info.offset
    val endOffset = startOffset + info.size
    val samples = buffer.duplicate().order(ByteOrder.nativeOrder())
    samples.position(startOffset)
    samples.limit(endOffset)
    val basePresentationTimeUs = info.presentationTimeUs.coerceAtLeast(0L)
    for (frameIndex in 0 until frameCount) {
      if (frameIndex % CANCELLATION_FRAME_INTERVAL == 0) {
        cancellationCheck()
      }
      var channelSquareSum = 0.0
      repeat(format.channelCount) {
        val sample = readPcmSample(samples, format.pcmEncoding)
        channelSquareSum += sample * sample
      }
      val frameRms = sqrt(channelSquareSum / format.channelCount.toDouble())
      val frameOffsetUs =
        (frameIndex.toLong() * MICROSECONDS_PER_SECOND) / format.sampleRate.toLong()
      accumulator.add(basePresentationTimeUs + frameOffsetUs, frameRms)
    }
  }

  private fun readPcmSample(buffer: ByteBuffer, pcmEncoding: Int): Double =
    when (pcmEncoding) {
      AudioFormat.ENCODING_PCM_16BIT -> buffer.short.toDouble() / 32_768.0
      AudioFormat.ENCODING_PCM_FLOAT -> {
        val value = buffer.float
        if (value.isFinite()) value.coerceIn(-1.0f, 1.0f).toDouble() else 0.0
      }
      else -> throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
    }

  private fun MediaFormat.readString(key: String): String? =
    if (!containsKey(key)) null else runCatching { getString(key) }.getOrNull()

  private data class AudioTrack(
    val index: Int,
    val mimeType: String,
    val format: MediaFormat
  )

  private data class DecodedPcmFormat(
    val sampleRate: Int,
    val channelCount: Int,
    val pcmEncoding: Int
  ) {
    val bytesPerSample: Int
      get() = when (pcmEncoding) {
        AudioFormat.ENCODING_PCM_16BIT -> Short.SIZE_BYTES
        AudioFormat.ENCODING_PCM_FLOAT -> Float.SIZE_BYTES
        else -> throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
      }

    companion object {
      fun from(
        format: MediaFormat,
        fallback: DecodedPcmFormat? = null
      ): DecodedPcmFormat {
        val sampleRate = format.readPositiveInt(MediaFormat.KEY_SAMPLE_RATE)
          ?: fallback?.sampleRate
          ?: throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
        val channelCount = format.readPositiveInt(MediaFormat.KEY_CHANNEL_COUNT)
          ?: fallback?.channelCount
          ?: throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
        val pcmEncoding = format.readInt(MediaFormat.KEY_PCM_ENCODING)
          ?: fallback?.pcmEncoding
          ?: AudioFormat.ENCODING_PCM_16BIT
        if (
          pcmEncoding != AudioFormat.ENCODING_PCM_16BIT &&
          pcmEncoding != AudioFormat.ENCODING_PCM_FLOAT
        ) {
          throw mediaError(TempoLoopMediaError.WAVEFORM_FAILED)
        }
        return DecodedPcmFormat(sampleRate, channelCount, pcmEncoding)
      }

      private fun MediaFormat.readPositiveInt(key: String): Int? =
        readInt(key)?.takeIf { it > 0 }

      private fun MediaFormat.readInt(key: String): Int? =
        if (!containsKey(key)) null else runCatching { getInteger(key) }.getOrNull()
    }
  }

  private class WaveformProgressReporter(
    private val durationUs: Long,
    private val callback: (Double) -> Unit
  ) {
    private var lastEmissionMs = Long.MIN_VALUE
    private var lastProgress = 0.0

    fun start() {
      callback(0.0)
      lastEmissionMs = SystemClock.elapsedRealtime()
    }

    fun update(presentationTimeUs: Long) {
      val progress = (presentationTimeUs.coerceAtLeast(0L).toDouble() / durationUs.toDouble())
        .coerceIn(lastProgress, 1.0)
      val nowMs = SystemClock.elapsedRealtime()
      if (nowMs - lastEmissionMs >= PROGRESS_INTERVAL_MS) {
        callback(progress)
        lastProgress = progress
        lastEmissionMs = nowMs
      }
    }

    fun finish() {
      if (lastProgress < 1.0) {
        callback(1.0)
        lastProgress = 1.0
      }
    }
  }

  private companion object {
    const val MICROSECONDS_PER_MILLISECOND = 1_000L
    const val MICROSECONDS_PER_SECOND = 1_000_000L
    const val CODEC_TIMEOUT_US = 10_000L
    const val CANCELLATION_FRAME_INTERVAL = 4_096
    const val PROGRESS_INTERVAL_MS = 125L
  }
}
