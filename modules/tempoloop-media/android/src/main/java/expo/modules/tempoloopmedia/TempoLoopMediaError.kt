package expo.modules.tempoloopmedia

import expo.modules.kotlin.exception.CodedException
import java.util.concurrent.CancellationException

internal enum class TempoLoopMediaError(
  val code: String,
  val safeMessage: String
) {
  VIDEO_TOO_LARGE(
    "E_VIDEO_TOO_LARGE",
    "The selected video is larger than 600 MiB."
  ),
  AUDIO_TOO_LARGE(
    "E_AUDIO_TOO_LARGE",
    "The selected audio file is larger than 200 MiB."
  ),
  PICKER_UNAVAILABLE(
    "E_PICKER_UNAVAILABLE",
    "No compatible video picker is available."
  ),
  SOURCE_UNREADABLE(
    "E_SOURCE_UNREADABLE",
    "The selected media cannot be opened."
  ),
  NO_AUDIO_TRACK(
    "E_NO_AUDIO_TRACK",
    "The selected video does not contain an audio track."
  ),
  DRM_UNSUPPORTED(
    "E_DRM_UNSUPPORTED",
    "Protected media is not supported."
  ),
  INVALID_DURATION(
    "E_INVALID_DURATION",
    "The selected media has an invalid duration."
  ),
  STORAGE_LOW(
    "E_STORAGE_LOW",
    "There is not enough device storage to import this media."
  ),
  IMPORT_BUSY(
    "E_IMPORT_BUSY",
    "Another import is already in progress."
  ),
  IMPORT_CANCELLED(
    "E_IMPORT_CANCELLED",
    "The import was cancelled."
  ),
  UNSUPPORTED_MEDIA(
    "E_UNSUPPORTED_MEDIA",
    "This media format is not supported on this device."
  ),
  OUTPUT_WRITE_FAILED(
    "E_OUTPUT_WRITE_FAILED",
    "The audio output could not be written."
  ),
  EXPORT_EMPTY(
    "E_EXPORT_EMPTY",
    "The exported audio is empty."
  ),
  WAVEFORM_FAILED(
    "E_WAVEFORM_FAILED",
    "The waveform could not be generated."
  ),
  PATH_OUTSIDE_APP(
    "E_PATH_OUTSIDE_APP",
    "The output path is outside app-private storage."
  ),
  UNKNOWN_NATIVE(
    "E_UNKNOWN_NATIVE",
    "The native media operation failed."
  )
}

internal class TempoLoopMediaException(
  val error: TempoLoopMediaError,
  cause: Throwable? = null
) : CodedException(error.code, error.safeMessage, cause)

internal class ImportCancellationSignal : CancellationException("Import cancelled")

internal fun mediaError(
  error: TempoLoopMediaError,
  cause: Throwable? = null
): TempoLoopMediaException = TempoLoopMediaException(error, cause)
