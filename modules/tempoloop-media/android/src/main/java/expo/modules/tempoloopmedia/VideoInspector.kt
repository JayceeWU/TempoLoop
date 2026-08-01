package expo.modules.tempoloopmedia

import android.content.ContentResolver
import android.content.Context
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

internal class MediaInspector(
  context: Context,
  private val ioDispatcher: CoroutineDispatcher
) {
  private val applicationContext = context.applicationContext
  private val resolver = applicationContext.contentResolver

  suspend fun inspect(options: InspectMediaOptions): MediaInspection =
    inspectForImport(options).inspection

  suspend fun inspectForImport(options: InspectMediaOptions): MediaInspectionDetails =
    withContext(ioDispatcher) {
      currentCoroutineContext().ensureActive()

      val parsedSource = SourceUriParser.parse(options.sourceUri)
      val sourceUri = Uri.parse(parsedSource.raw)
      requireReadableSource(parsedSource, sourceUri)

      val sourceSizeBytes = SourceSizeLookup(resolver).lookup(sourceUri)
      currentCoroutineContext().ensureActive()
      inspectTracks(sourceUri, sourceSizeBytes, options)
    }

  private fun inspectTracks(
    sourceUri: Uri,
    sourceSizeBytes: Long?,
    options: InspectMediaOptions
  ): MediaInspectionDetails {
    val extractor = MediaExtractor()
    try {
      try {
        extractor.setDataSource(applicationContext, sourceUri, null)
      } catch (error: SecurityException) {
        throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
      } catch (error: IOException) {
        throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA, error)
      } catch (error: IllegalArgumentException) {
        throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA, error)
      }

      if (extractorHasDrm(extractor)) {
        throw mediaError(TempoLoopMediaError.DRM_UNSUPPORTED)
      }
      if (extractor.trackCount <= 0) {
        throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA)
      }

      var audioFormat: MediaFormat? = null
      var audioMimeType: String? = null
      var hasVideoTrack = false
      for (trackIndex in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(trackIndex)
        if (formatMarksProtected(format)) {
          throw mediaError(TempoLoopMediaError.DRM_UNSUPPORTED)
        }

        val mimeType = format.getString(MediaFormat.KEY_MIME)
        if (mimeType?.startsWith("video/") == true) {
          hasVideoTrack = true
        }
        if (audioFormat == null && mimeType?.startsWith("audio/") == true) {
          audioFormat = format
          audioMimeType = mimeType
        }
      }

      val selectedAudioFormat = audioFormat
        ?: throw mediaError(TempoLoopMediaError.NO_AUDIO_TRACK)
      val sourceKind = if (hasVideoTrack) SourceMediaKind.VIDEO else SourceMediaKind.AUDIO
      SourceSizePolicy.requireWithinLimit(
        sourceSizeBytes = sourceSizeBytes,
        sourceKind = sourceKind,
        requestedMaxAudioSourceBytes = options.maxAudioSourceBytes,
        requestedMaxVideoSourceBytes = options.maxVideoSourceBytes
      )
      if (!hasDecoder(selectedAudioFormat)) {
        throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA)
      }
      val durationUs = selectedAudioFormat.readLong(MediaFormat.KEY_DURATION)
      val durationMs = durationUs?.div(MICROSECONDS_PER_MILLISECOND)
      if (durationMs == null || durationMs <= 0L) {
        throw mediaError(TempoLoopMediaError.INVALID_DURATION)
      }

      return MediaInspectionDetails(
        inspection = MediaInspection(
          sourceKind = sourceKind,
          sourceSizeBytes = sourceSizeBytes,
          durationMs = durationMs,
          audioMimeType = audioMimeType,
          sampleRate = selectedAudioFormat.readPositiveInt(MediaFormat.KEY_SAMPLE_RATE),
          channelCount = selectedAudioFormat.readPositiveInt(MediaFormat.KEY_CHANNEL_COUNT)
        ),
        audioBitrateBitsPerSecond =
          selectedAudioFormat.readPositiveInt(MediaFormat.KEY_BIT_RATE)?.toLong()
      )
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: RuntimeException) {
      throw mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA, error)
    } finally {
      extractor.release()
    }
  }

  private fun requireReadableSource(parsedSource: ParsedSourceUri, sourceUri: Uri) {
    when (parsedSource.kind) {
      SourceUriKind.FILE -> {
        val sourcePath = parsedSource.uri.path
          ?: throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
        val file = try {
          if (parsedSource.uri.authority.isNullOrEmpty()) {
            File(parsedSource.uri)
          } else {
            File(sourcePath)
          }
        } catch (error: IllegalArgumentException) {
          throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
        }
        if (!file.isAbsolute || !file.isFile || !file.canRead()) {
          throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
        }
      }

      SourceUriKind.CONTENT -> requireReadableContentUri(sourceUri)
    }
  }

  private fun requireReadableContentUri(sourceUri: Uri) {
    var lastFailure: Throwable? = null
    try {
      resolver.openAssetFileDescriptor(sourceUri, "r")?.use { return }
    } catch (error: IOException) {
      lastFailure = error
    } catch (error: SecurityException) {
      lastFailure = error
    } catch (error: IllegalArgumentException) {
      lastFailure = error
    }

    try {
      resolver.openFileDescriptor(sourceUri, "r")?.use { return }
    } catch (error: IOException) {
      lastFailure = error
    } catch (error: SecurityException) {
      lastFailure = error
    } catch (error: IllegalArgumentException) {
      lastFailure = error
    }

    throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, lastFailure)
  }

  private fun extractorHasDrm(extractor: MediaExtractor): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      return false
    }
    return try {
      extractor.drmInitData != null
    } catch (_: RuntimeException) {
      false
    }
  }

  private fun formatMarksProtected(format: MediaFormat): Boolean {
    if (format.containsKey(KEY_CRYPTO_MODE) || format.containsKey(KEY_CA_SYSTEM_ID)) {
      return true
    }
    if (!format.containsKey(KEY_IS_DRM)) {
      return false
    }
    return try {
      format.getInteger(KEY_IS_DRM) != 0
    } catch (_: RuntimeException) {
      true
    }
  }

  private fun hasDecoder(format: MediaFormat): Boolean = try {
    MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(format) != null
  } catch (_: RuntimeException) {
    false
  }

  private fun MediaFormat.readLong(key: String): Long? =
    if (!containsKey(key)) {
      null
    } else {
      try {
        getLong(key)
      } catch (_: RuntimeException) {
        null
      }
    }

  private fun MediaFormat.readPositiveInt(key: String): Int? =
    if (!containsKey(key)) {
      null
    } else {
      try {
        getInteger(key).takeIf { it > 0 }
      } catch (_: RuntimeException) {
        null
      }
    }

  private companion object {
    const val MICROSECONDS_PER_MILLISECOND = 1_000L
    const val KEY_IS_DRM = "is-drm"
    const val KEY_CRYPTO_MODE = "crypto-mode"
    const val KEY_CA_SYSTEM_ID = "ca-system-id"
  }
}

internal data class MediaInspectionDetails(
  val inspection: MediaInspection,
  val audioBitrateBitsPerSecond: Long?
)

internal class SourceSizeLookup(
  private val resolver: ContentResolver
) {
  fun lookup(uri: Uri): Long? = ReliableSizeResolver.resolve(
    querySize = { queryOpenableSize(uri) },
    assetDescriptorLength = { assetDescriptorLength(uri) },
    parcelDescriptorSize = { parcelDescriptorSize(uri) }
  )

  private fun queryOpenableSize(uri: Uri): Long? = try {
    resolver.query(
      uri,
      arrayOf(OpenableColumns.SIZE),
      null,
      null,
      null
    )?.use { cursor ->
      val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
      if (
        sizeColumn >= 0 &&
        cursor.moveToFirst() &&
        !cursor.isNull(sizeColumn)
      ) {
        SourceSizePolicy.normalizeReportedSize(cursor.getLong(sizeColumn))
      } else {
        null
      }
    }
  } catch (_: IOException) {
    null
  } catch (_: SecurityException) {
    null
  } catch (_: IllegalArgumentException) {
    null
  } catch (_: RuntimeException) {
    null
  }

  private fun assetDescriptorLength(uri: Uri): Long? = try {
    resolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
      SourceSizePolicy.normalizeReportedSize(descriptor.length)
    }
  } catch (_: IOException) {
    null
  } catch (_: SecurityException) {
    null
  } catch (_: IllegalArgumentException) {
    null
  }

  private fun parcelDescriptorSize(uri: Uri): Long? = try {
    resolver.openFileDescriptor(uri, "r")?.use { descriptor ->
      SourceSizePolicy.normalizeReportedSize(descriptor.statSize)
    }
  } catch (_: IOException) {
    null
  } catch (_: SecurityException) {
    null
  } catch (_: IllegalArgumentException) {
    null
  }
}
