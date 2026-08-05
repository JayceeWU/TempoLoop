package expo.modules.tempoloopmedia

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.providers.AppContextProvider
import java.io.Serializable

internal data class GalleryVideoPickerOptions(
  val localOnly: Boolean = true
) : Serializable

internal sealed class GalleryVideoPickerResult {
  data class Success(val source: PickedMediaSource) : GalleryVideoPickerResult()
  object Cancelled : GalleryVideoPickerResult()
}

internal enum class GalleryPickerStrategy {
  PHOTO_PICKER,
  MEDIA_STORE_GALLERY,
  DOCUMENTS_SCREENSHOTS
}

internal object GalleryPickerStrategyResolver {
  fun resolve(
    photoPickerAvailable: Boolean,
    galleryAvailable: Boolean,
    documentPickerAvailable: Boolean
  ): GalleryPickerStrategy? = when {
    photoPickerAvailable -> GalleryPickerStrategy.PHOTO_PICKER
    galleryAvailable -> GalleryPickerStrategy.MEDIA_STORE_GALLERY
    documentPickerAvailable -> GalleryPickerStrategy.DOCUMENTS_SCREENSHOTS
    else -> null
  }
}

/**
 * Opens a gallery-first, video-only picker without requesting broad storage
 * permission or copying the selected media into the application cache.
 */
internal class GalleryVideoPickerContract(
  private val appContextProvider: AppContextProvider
) : AppContextActivityResultContract<GalleryVideoPickerOptions, GalleryVideoPickerResult> {
  private val context: Context
    get() = appContextProvider.appContext.reactContext
      ?: throw mediaError(TempoLoopMediaError.PICKER_UNAVAILABLE)

  override fun createIntent(context: Context, input: GalleryVideoPickerOptions): Intent {
    val photoPicker = Intent(MediaStore.ACTION_PICK_IMAGES).apply {
      type = VIDEO_MIME_TYPE
      putExtra(Intent.EXTRA_LOCAL_ONLY, input.localOnly)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val galleryPicker = Intent(
      Intent.ACTION_PICK,
      MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    ).apply {
      type = VIDEO_MIME_TYPE
      putExtra(Intent.EXTRA_LOCAL_ONLY, input.localOnly)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val documentPicker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = VIDEO_MIME_TYPE
      putExtra(Intent.EXTRA_LOCAL_ONLY, input.localOnly)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        putExtra(DocumentsContract.EXTRA_INITIAL_URI, screenshotsDirectoryUri())
      }
    }
    return when (
      GalleryPickerStrategyResolver.resolve(
        photoPickerAvailable = photoPicker.resolveActivity(context.packageManager) != null,
        galleryAvailable = galleryPicker.resolveActivity(context.packageManager) != null,
        documentPickerAvailable = documentPicker.resolveActivity(context.packageManager) != null
      )
    ) {
      GalleryPickerStrategy.PHOTO_PICKER -> photoPicker
      GalleryPickerStrategy.MEDIA_STORE_GALLERY -> galleryPicker
      GalleryPickerStrategy.DOCUMENTS_SCREENSHOTS -> documentPicker
      null -> throw mediaError(TempoLoopMediaError.PICKER_UNAVAILABLE)
    }
  }

  override fun parseResult(
    input: GalleryVideoPickerOptions,
    resultCode: Int,
    intent: Intent?
  ): GalleryVideoPickerResult {
    if (resultCode != Activity.RESULT_OK || intent == null) {
      return GalleryVideoPickerResult.Cancelled
    }

    val uri = intent.data ?: intent.clipData?.getItemAt(0)?.uri
      ?: throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    SourceUriParser.parse(uri.toString())
    return GalleryVideoPickerResult.Success(readSourceMetadata(uri))
  }

  private fun readSourceMetadata(uri: Uri): PickedMediaSource {
    var displayName: String? = null
    var sizeBytes: Long? = null
    try {
      context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameColumn >= 0 && !cursor.isNull(nameColumn)) {
            displayName = cursor.getString(nameColumn)?.trim()?.takeIf(String::isNotEmpty)
          }
          val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
            sizeBytes = SourceSizePolicy.normalizeReportedSize(cursor.getLong(sizeColumn))
          }
        }
      }
    } catch (_: RuntimeException) {
      // Picker metadata is advisory. MediaInspector performs authoritative checks.
    }

    val mimeType = try {
      context.contentResolver.getType(uri)?.trim()?.takeIf(String::isNotEmpty)
    } catch (_: RuntimeException) {
      null
    }

    return PickedMediaSource(
      uri = uri.toString(),
      sizeBytes = sizeBytes,
      mimeType = mimeType,
      fileName = displayName
    )
  }

  private fun screenshotsDirectoryUri(): Uri = DocumentsContract.buildDocumentUri(
    EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY,
    SCREENSHOTS_DOCUMENT_ID
  )

  private companion object {
    const val VIDEO_MIME_TYPE = "video/*"
    const val EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY = "com.android.externalstorage.documents"
    const val SCREENSHOTS_DOCUMENT_ID = "primary:Pictures/Screenshots"
  }
}
