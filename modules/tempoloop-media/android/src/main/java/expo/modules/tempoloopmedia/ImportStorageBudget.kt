package expo.modules.tempoloopmedia

import java.io.File
import java.io.IOException

internal data class ImportStorageEstimate(
  val expectedAudioBytes: Long,
  val transformationOverheadBytes: Long,
  val minimumFreeReserveBytes: Long,
  val requiredUsableBytes: Long
)

/**
 * Estimates only app-owned audio output and bounded transformation overhead.
 * The picked video is streamed in place, so its full size is intentionally not
 * reserved as a second app-private copy.
 */
internal object ImportStorageEstimator {
  const val DEFAULT_TARGET_AAC_BITRATE_BITS_PER_SECOND = 192_000L
  const val DEFAULT_UNKNOWN_SOURCE_AUDIO_BITRATE_BITS_PER_SECOND = 512_000L

  private const val BITS_PER_BYTE_TIMES_MILLISECONDS_PER_SECOND = 8_000L
  private const val MIN_TRANSFORMATION_OVERHEAD_BYTES = 16L * 1024L * 1024L
  private const val MIN_FREE_RESERVE_BYTES = 32L * 1024L * 1024L

  fun estimate(
    durationMs: Long,
    sourceAudioBitrateBitsPerSecond: Long?,
    targetAudioBitrateBitsPerSecond: Long =
      DEFAULT_TARGET_AAC_BITRATE_BITS_PER_SECOND
  ): ImportStorageEstimate {
    require(durationMs > 0L) { "durationMs must be positive" }
    require(targetAudioBitrateBitsPerSecond > 0L) {
      "targetAudioBitrateBitsPerSecond must be positive"
    }

    val effectiveBitrate = maxOf(
      sourceAudioBitrateBitsPerSecond?.takeIf { it > 0L }
        ?: DEFAULT_UNKNOWN_SOURCE_AUDIO_BITRATE_BITS_PER_SECOND,
      targetAudioBitrateBitsPerSecond
    )
    val encodedBitsTimesMilliseconds = saturatedMultiply(durationMs, effectiveBitrate)
    val expectedAudioBytes = ceilDivide(
      encodedBitsTimesMilliseconds,
      BITS_PER_BYTE_TIMES_MILLISECONDS_PER_SECOND
    )

    // Covers muxer bookkeeping, fragmented output and device-specific codec
    // scratch use without pretending that the source video is copied.
    val proportionalOverhead = ceilDivide(expectedAudioBytes, 4L)
    val transformationOverhead = maxOf(
      MIN_TRANSFORMATION_OVERHEAD_BYTES,
      proportionalOverhead
    )
    val requiredUsableBytes = saturatedAdd(
      saturatedAdd(expectedAudioBytes, transformationOverhead),
      MIN_FREE_RESERVE_BYTES
    )

    return ImportStorageEstimate(
      expectedAudioBytes = expectedAudioBytes,
      transformationOverheadBytes = transformationOverhead,
      minimumFreeReserveBytes = MIN_FREE_RESERVE_BYTES,
      requiredUsableBytes = requiredUsableBytes
    )
  }

  fun hasSufficientSpace(
    usableBytes: Long,
    estimate: ImportStorageEstimate
  ): Boolean = usableBytes >= estimate.requiredUsableBytes

  private fun ceilDivide(value: Long, divisor: Long): Long {
    if (value == Long.MAX_VALUE) {
      return Long.MAX_VALUE
    }
    return if (value == 0L) 0L else 1L + ((value - 1L) / divisor)
  }

  private fun saturatedMultiply(left: Long, right: Long): Long = try {
    Math.multiplyExact(left, right)
  } catch (_: ArithmeticException) {
    Long.MAX_VALUE
  }

  private fun saturatedAdd(left: Long, right: Long): Long = try {
    Math.addExact(left, right)
  } catch (_: ArithmeticException) {
    Long.MAX_VALUE
  }
}

internal object AppPrivateStorageGuard {
  fun requireSpace(
    outputFile: File,
    estimate: ImportStorageEstimate
  ) {
    val volumeAnchor = try {
      findExistingAncestor(outputFile.canonicalFile)
    } catch (error: IOException) {
      throw mediaError(TempoLoopMediaError.STORAGE_LOW, error)
    }
    val usableBytes = volumeAnchor.usableSpace
    if (!ImportStorageEstimator.hasSufficientSpace(usableBytes, estimate)) {
      throw mediaError(TempoLoopMediaError.STORAGE_LOW)
    }
  }

  private fun findExistingAncestor(file: File): File {
    var candidate: File? = if (file.isDirectory) file else file.parentFile
    while (candidate != null && !candidate.exists()) {
      candidate = candidate.parentFile
    }
    return candidate ?: throw IOException("No existing storage-volume ancestor")
  }
}
