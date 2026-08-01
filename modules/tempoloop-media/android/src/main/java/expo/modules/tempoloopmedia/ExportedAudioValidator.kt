package expo.modules.tempoloopmedia

import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.IOException

internal data class ValidatedAudioOutput(
  val sizeBytes: Long,
  val durationMs: Long
)

internal object ExportedAudioValidator {
  fun validate(file: File): ValidatedAudioOutput {
    val sizeBytes = file.length()
    if (!file.isFile || sizeBytes <= 0L) {
      throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)
    }

    val extractor = MediaExtractor()
    try {
      try {
        extractor.setDataSource(file.absolutePath)
      } catch (error: IOException) {
        throw mediaError(TempoLoopMediaError.EXPORT_EMPTY, error)
      } catch (error: RuntimeException) {
        throw mediaError(TempoLoopMediaError.EXPORT_EMPTY, error)
      }

      try {
        var audioDurationUs: Long? = null
        var audioTrackCount = 0
        for (trackIndex in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(trackIndex)
          val mimeType = format.getString(MediaFormat.KEY_MIME)
          when {
            mimeType?.startsWith("video/") == true ->
              throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)

            mimeType?.startsWith("audio/") == true -> {
              audioTrackCount += 1
              if (mimeType != AAC_MIME_TYPE) {
                throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA)
              }
              val durationUs = format.readPositiveLong(MediaFormat.KEY_DURATION)
              if (durationUs != null) {
                audioDurationUs = maxOf(audioDurationUs ?: 0L, durationUs)
              }
            }
          }
        }

        val durationMs = audioDurationUs?.div(MICROSECONDS_PER_MILLISECOND)
        if (audioTrackCount != 1 || durationMs == null || durationMs <= 0L) {
          throw mediaError(TempoLoopMediaError.EXPORT_EMPTY)
        }
        return ValidatedAudioOutput(sizeBytes = sizeBytes, durationMs = durationMs)
      } catch (error: TempoLoopMediaException) {
        throw error
      } catch (error: RuntimeException) {
        throw mediaError(TempoLoopMediaError.EXPORT_EMPTY, error)
      }
    } finally {
      extractor.release()
    }
  }

  private fun MediaFormat.readPositiveLong(key: String): Long? =
    if (!containsKey(key)) {
      null
    } else {
      try {
        getLong(key).takeIf { it > 0L }
      } catch (_: RuntimeException) {
        null
      }
    }

  private const val AAC_MIME_TYPE = "audio/mp4a-latm"
  private const val MICROSECONDS_PER_MILLISECOND = 1_000L
}
