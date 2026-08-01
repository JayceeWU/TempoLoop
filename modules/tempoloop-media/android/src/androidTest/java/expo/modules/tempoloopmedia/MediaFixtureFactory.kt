package expo.modules.tempoloopmedia

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.SystemClock
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Creates tiny, deterministic test media entirely with Android platform codecs.
 * Fixtures are generated in the test sandbox, never checked in or transferred
 * through the React Native bridge.
 */
internal object MediaFixtureFactory {
  fun createAacAvcVideo(
    outputFile: File,
    durationMs: Long = 700L,
    channelCount: Int = 1,
    signal: AudioSignal = AudioSignal.TONE
  ): File = mux(
    outputFile,
    listOf(
      encodeAvc(durationMs),
      encodeAac(durationMs, channelCount, signal)
    )
  )

  fun createVideoOnly(
    outputFile: File,
    durationMs: Long = 400L
  ): File = mux(outputFile, listOf(encodeAvc(durationMs)))

  fun createAacAudio(
    outputFile: File,
    durationMs: Long,
    channelCount: Int,
    signal: AudioSignal
  ): File = mux(outputFile, listOf(encodeAac(durationMs, channelCount, signal)))

  private fun encodeAac(
    durationMs: Long,
    channelCount: Int,
    signal: AudioSignal
  ): EncodedTrack {
    require(durationMs > 0L)
    require(channelCount == 1 || channelCount == 2)

    val format = MediaFormat.createAudioFormat(AAC_MIME_TYPE, AUDIO_SAMPLE_RATE, channelCount).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BIT_RATE_PER_CHANNEL * channelCount)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, AUDIO_INPUT_BUFFER_BYTES)
    }
    val codecName = MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format)
      ?: throw FixtureUnavailableException("No AAC encoder is available")
    val codec = MediaCodec.createByCodecName(codecName)
    var frameCursor = 0L
    val totalFrames = ceil(
      durationMs.toDouble() * AUDIO_SAMPLE_RATE.toDouble() / MILLISECONDS_PER_SECOND
    ).toLong().coerceAtLeast(1L)

    return encode(codec, format, durationMs * MICROSECONDS_PER_MILLISECOND) { buffer ->
      if (frameCursor >= totalFrames) {
        null
      } else {
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val bytesPerFrame = channelCount * Short.SIZE_BYTES
        val writableFrames = buffer.remaining() / bytesPerFrame
        if (writableFrames <= 0) {
          throw FixtureUnavailableException("AAC encoder input buffer is too small")
        }
        val frameCount = min(
          AUDIO_FRAMES_PER_INPUT.toLong(),
          min(totalFrames - frameCursor, writableFrames.toLong())
        ).toInt()
        val presentationTimeUs = framesToMicroseconds(frameCursor, AUDIO_SAMPLE_RATE)
        repeat(frameCount) { relativeFrame ->
          val absoluteFrame = frameCursor + relativeFrame
          repeat(channelCount) { channel ->
            val sample = when (signal) {
              AudioSignal.SILENCE -> 0.toShort()
              AudioSignal.TONE -> sineSample(absoluteFrame, channel)
            }
            buffer.putShort(sample)
          }
        }
        frameCursor += frameCount
        InputChunk(frameCount * bytesPerFrame, presentationTimeUs)
      }
    }
  }

  private fun encodeAvc(durationMs: Long): EncodedTrack {
    require(durationMs > 0L)
    val codecSelection = findAvcEncoder()
    val format = MediaFormat.createVideoFormat(AVC_MIME_TYPE, VIDEO_WIDTH, VIDEO_HEIGHT).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, codecSelection.colorFormat)
      setInteger(MediaFormat.KEY_BIT_RATE, VIDEO_BIT_RATE)
      setInteger(MediaFormat.KEY_FRAME_RATE, VIDEO_FRAME_RATE)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, VIDEO_FRAME_BYTES)
    }
    val codec = MediaCodec.createByCodecName(codecSelection.codecName)
    var frameCursor = 0
    val totalFrames = ceil(
      durationMs.toDouble() * VIDEO_FRAME_RATE.toDouble() / MILLISECONDS_PER_SECOND
    ).toInt().coerceAtLeast(2)

    return encode(codec, format, durationMs * MICROSECONDS_PER_MILLISECOND) { buffer ->
      if (frameCursor >= totalFrames) {
        null
      } else {
        if (buffer.remaining() < VIDEO_FRAME_BYTES) {
          throw FixtureUnavailableException("AVC encoder input buffer is too small")
        }
        writeYuv420Frame(buffer, codecSelection.colorFormat, frameCursor)
        val presentationTimeUs = framesToMicroseconds(frameCursor.toLong(), VIDEO_FRAME_RATE)
        frameCursor += 1
        InputChunk(VIDEO_FRAME_BYTES, presentationTimeUs)
      }
    }
  }

  private fun encode(
    codec: MediaCodec,
    format: MediaFormat,
    endPresentationTimeUs: Long,
    writeInput: (ByteBuffer) -> InputChunk?
  ): EncodedTrack {
    var started = false
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      started = true

      val samples = mutableListOf<EncodedSample>()
      val bufferInfo = MediaCodec.BufferInfo()
      var outputFormat: MediaFormat? = null
      var inputEnded = false
      var outputEnded = false
      val deadlineMs = SystemClock.elapsedRealtime() + CODEC_DEADLINE_MS

      while (!outputEnded) {
        if (SystemClock.elapsedRealtime() > deadlineMs) {
          throw FixtureUnavailableException("Platform encoder timed out")
        }

        if (!inputEnded) {
          val inputIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (inputIndex >= 0) {
            val inputBuffer = codec.getInputBuffer(inputIndex)
              ?: throw FixtureUnavailableException("Platform encoder returned no input buffer")
            inputBuffer.clear()
            val chunk = writeInput(inputBuffer)
            if (chunk == null) {
              codec.queueInputBuffer(
                inputIndex,
                0,
                0,
                endPresentationTimeUs,
                MediaCodec.BUFFER_FLAG_END_OF_STREAM
              )
              inputEnded = true
            } else {
              codec.queueInputBuffer(
                inputIndex,
                0,
                chunk.sizeBytes,
                chunk.presentationTimeUs,
                0
              )
            }
          }
        }

        when (val outputIndex = codec.dequeueOutputBuffer(bufferInfo, CODEC_TIMEOUT_US)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            if (outputFormat != null) {
              throw FixtureUnavailableException("Platform encoder changed format twice")
            }
            outputFormat = codec.outputFormat
          }

          MediaCodec.INFO_TRY_AGAIN_LATER,
          MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit

          else -> if (outputIndex >= 0) {
            try {
              val isConfiguration =
                bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
              if (bufferInfo.size > 0 && !isConfiguration) {
                val outputBuffer = codec.getOutputBuffer(outputIndex)
                  ?: throw FixtureUnavailableException("Platform encoder returned no output buffer")
                val copy = outputBuffer.duplicate()
                copy.position(bufferInfo.offset)
                copy.limit(bufferInfo.offset + bufferInfo.size)
                val bytes = ByteArray(bufferInfo.size)
                copy.get(bytes)
                samples += EncodedSample(
                  bytes = bytes,
                  presentationTimeUs = bufferInfo.presentationTimeUs.coerceAtLeast(0L),
                  flags = bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME
                )
              }
              outputEnded = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            } finally {
              codec.releaseOutputBuffer(outputIndex, false)
            }
          }
        }
      }

      if (samples.isEmpty()) {
        throw FixtureUnavailableException("Platform encoder returned no media samples")
      }
      return EncodedTrack(
        format = outputFormat
          ?: throw FixtureUnavailableException("Platform encoder returned no output format"),
        samples = samples
      )
    } finally {
      if (started) {
        runCatching(codec::stop)
      }
      codec.release()
    }
  }

  private fun mux(outputFile: File, tracks: List<EncodedTrack>): File {
    require(tracks.isNotEmpty())
    outputFile.parentFile?.let { parent ->
      if ((!parent.exists() && !parent.mkdirs()) || !parent.isDirectory) {
        throw FixtureUnavailableException("Could not create fixture directory")
      }
    }
    if (outputFile.exists() && !outputFile.delete()) {
      throw FixtureUnavailableException("Could not replace fixture file")
    }

    val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var started = false
    try {
      val trackIndices = tracks.map { track -> muxer.addTrack(track.format) }
      muxer.start()
      started = true
      val interleavedSamples = tracks.flatMapIndexed { trackPosition, track ->
        track.samples.map { sample -> IndexedSample(trackPosition, sample) }
      }.sortedWith(
        compareBy<IndexedSample>(IndexedSample::presentationTimeUs)
          .thenBy(IndexedSample::trackPosition)
      )
      interleavedSamples.forEach { indexedSample ->
        indexedSample.sample.let { sample ->
          val info = MediaCodec.BufferInfo().apply {
            set(0, sample.bytes.size, sample.presentationTimeUs, sample.flags)
          }
          muxer.writeSampleData(
            trackIndices[indexedSample.trackPosition],
            ByteBuffer.wrap(sample.bytes),
            info
          )
        }
      }
    } finally {
      try {
        if (started) {
          muxer.stop()
        }
      } finally {
        muxer.release()
      }
    }
    if (!outputFile.isFile || outputFile.length() <= 0L) {
      throw FixtureUnavailableException("Muxer produced an empty fixture")
    }
    return outputFile
  }

  private fun findAvcEncoder(): VideoCodecSelection {
    val supportedColors = listOf(
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedPlanar,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedSemiPlanar
    )
    MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.forEach { codecInfo ->
      if (!codecInfo.isEncoder || codecInfo.supportedTypes.none { it.equals(AVC_MIME_TYPE, true) }) {
        return@forEach
      }
      val capabilities = runCatching { codecInfo.getCapabilitiesForType(AVC_MIME_TYPE) }
        .getOrNull() ?: return@forEach
      val colorFormat = supportedColors.firstOrNull { candidate ->
        capabilities.colorFormats.contains(candidate)
      }
      if (colorFormat != null) {
        return VideoCodecSelection(codecInfo.name, colorFormat)
      }
    }
    throw FixtureUnavailableException("No byte-buffer AVC encoder is available")
  }

  private fun writeYuv420Frame(buffer: ByteBuffer, colorFormat: Int, frameIndex: Int) {
    val luma = if (frameIndex % 2 == 0) 48.toByte() else 192.toByte()
    repeat(VIDEO_WIDTH * VIDEO_HEIGHT) { buffer.put(luma) }
    val chromaSamples = VIDEO_WIDTH * VIDEO_HEIGHT / 4
    when (colorFormat) {
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420PackedSemiPlanar -> {
        repeat(chromaSamples) {
          buffer.put(128.toByte())
          buffer.put(128.toByte())
        }
      }

      else -> {
        repeat(chromaSamples) { buffer.put(128.toByte()) }
        repeat(chromaSamples) { buffer.put(128.toByte()) }
      }
    }
  }

  private fun sineSample(frame: Long, channel: Int): Short {
    val frequency = if (channel == 0) 440.0 else 660.0
    val radians = 2.0 * PI * frequency * frame.toDouble() / AUDIO_SAMPLE_RATE.toDouble()
    return (sin(radians) * TEST_TONE_AMPLITUDE * Short.MAX_VALUE.toDouble())
      .roundToInt()
      .toShort()
  }

  private fun framesToMicroseconds(frame: Long, rate: Int): Long =
    frame * MICROSECONDS_PER_SECOND / rate.toLong()

  private data class InputChunk(
    val sizeBytes: Int,
    val presentationTimeUs: Long
  )

  private data class EncodedTrack(
    val format: MediaFormat,
    val samples: List<EncodedSample>
  )

  private data class EncodedSample(
    val bytes: ByteArray,
    val presentationTimeUs: Long,
    val flags: Int
  )

  private data class IndexedSample(
    val trackPosition: Int,
    val sample: EncodedSample
  ) {
    val presentationTimeUs: Long
      get() = sample.presentationTimeUs
  }

  private data class VideoCodecSelection(
    val codecName: String,
    val colorFormat: Int
  )

  private const val AAC_MIME_TYPE = "audio/mp4a-latm"
  private const val AVC_MIME_TYPE = "video/avc"
  private const val AUDIO_SAMPLE_RATE = 44_100
  private const val AUDIO_BIT_RATE_PER_CHANNEL = 64_000
  private const val AUDIO_FRAMES_PER_INPUT = 1_024
  private const val AUDIO_INPUT_BUFFER_BYTES = 16 * 1_024
  private const val VIDEO_WIDTH = 64
  private const val VIDEO_HEIGHT = 64
  private const val VIDEO_FRAME_RATE = 10
  private const val VIDEO_BIT_RATE = 128_000
  private const val VIDEO_FRAME_BYTES = VIDEO_WIDTH * VIDEO_HEIGHT * 3 / 2
  private const val TEST_TONE_AMPLITUDE = 0.35
  private const val MICROSECONDS_PER_SECOND = 1_000_000L
  private const val MICROSECONDS_PER_MILLISECOND = 1_000L
  private const val MILLISECONDS_PER_SECOND = 1_000.0
  private const val CODEC_TIMEOUT_US = 10_000L
  private const val CODEC_DEADLINE_MS = 30_000L
}

internal enum class AudioSignal {
  TONE,
  SILENCE
}

internal class FixtureUnavailableException(message: String) : RuntimeException(message)
