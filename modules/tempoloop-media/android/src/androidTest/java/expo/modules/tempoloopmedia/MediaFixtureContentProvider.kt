package expo.modules.tempoloopmedia

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/** Exposes only runtime-generated instrumentation fixtures through content://. */
class MediaFixtureContentProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String = "video/mp4"

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor {
    val file = requireFixture(uri)
    val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return MatrixCursor(columns, 1).apply {
      addRow(
        columns.map { column ->
          when (column) {
            OpenableColumns.DISPLAY_NAME -> file.name
            OpenableColumns.SIZE -> file.length()
            else -> null
          }
        }
      )
    }
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") {
      throw FileNotFoundException("Instrumentation fixtures are read-only")
    }
    return ParcelFileDescriptor.open(requireFixture(uri), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
    val file = requireFixture(uri)
    val descriptor = openFile(uri, mode)
    return AssetFileDescriptor(descriptor, 0L, file.length())
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? =
    throw UnsupportedOperationException("Instrumentation fixtures are read-only")

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = throw UnsupportedOperationException("Instrumentation fixtures are read-only")

  override fun delete(
    uri: Uri,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = throw UnsupportedOperationException("Instrumentation fixtures are read-only")

  private fun requireFixture(uri: Uri): File {
    if (uri.authority != AUTHORITY || uri.pathSegments.size != 1) {
      throw FileNotFoundException("Unknown instrumentation fixture")
    }
    val fileName = uri.lastPathSegment
      ?.takeIf { name -> FILE_NAME.matches(name) }
      ?: throw FileNotFoundException("Invalid instrumentation fixture name")
    val providerContext = context ?: throw FileNotFoundException("Provider is unavailable")
    val root = File(providerContext.cacheDir, FIXTURE_DIRECTORY).canonicalFile
    val candidate = File(root, fileName).canonicalFile
    if (candidate.parentFile != root || !candidate.isFile || !candidate.canRead()) {
      throw FileNotFoundException("Instrumentation fixture is unavailable")
    }
    return candidate
  }

  companion object {
    const val AUTHORITY = "expo.modules.tempoloopmedia.instrumentation.fixtures"
    const val FIXTURE_DIRECTORY = "tempoloop-media-content-fixtures"
    private val FILE_NAME = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
  }
}
