package expo.modules.tempoloopmedia

import java.io.File
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException

internal object PrivateOutputPath {
  fun requireSafeImportFileUri(
    outputUri: String,
    allowedRoots: Collection<File>,
    sourceUri: ParsedSourceUri
  ): File {
    val outputFile = requireSafeFileUri(outputUri, allowedRoots)

    if (sourceUri.kind == SourceUriKind.FILE) {
      val sourcePath = sourceUri.uri.path
        ?: throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
      val sourceFile = try {
        if (sourceUri.uri.authority.isNullOrEmpty()) {
          File(sourceUri.uri)
        } else {
          File(sourcePath)
        }
      } catch (error: IllegalArgumentException) {
        throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
      }
      val canonicalSource = try {
        sourceFile.canonicalFile
      } catch (error: IOException) {
        throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
      }

      if (outputFile.path == canonicalSource.path) {
        throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP)
      }
    }

    return outputFile
  }

  fun requireSafeFileUri(
    outputUri: String,
    allowedRoots: Collection<File>
  ): File {
    if (outputUri.isBlank() || outputUri.any(Char::isISOControl)) {
      throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP)
    }

    val uri = try {
      URI(outputUri)
    } catch (error: URISyntaxException) {
      throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP, error)
    }

    val authority = uri.authority
    val path = uri.path
    if (path == null) {
      throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP)
    }
    if (
      !uri.scheme.equals("file", true) ||
      uri.isOpaque ||
      !(authority.isNullOrEmpty() || authority.equals("localhost", true)) ||
      path.isBlank() ||
      !path.startsWith('/') ||
      path.split('/').any { segment -> segment == ".." } ||
      uri.query != null ||
      uri.fragment != null
    ) {
      throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP)
    }

    val candidate = canonicalFile(fileFromUri(uri, path))
    val isInsidePrivateRoot = allowedRoots.any { root ->
      val canonicalRoot = canonicalFile(root)
      candidate.path != canonicalRoot.path &&
        candidate.path.startsWith(canonicalRoot.path.withTrailingSeparator())
    }

    if (!isInsidePrivateRoot) {
      throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP)
    }
    return candidate
  }

  private fun canonicalFile(file: File): File = try {
    file.canonicalFile
  } catch (error: IOException) {
    throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP, error)
  }

  private fun String.withTrailingSeparator(): String =
    if (endsWith(File.separator)) this else this + File.separator

  private fun fileFromUri(uri: URI, path: String): File = try {
    if (uri.authority.isNullOrEmpty()) File(uri) else File(path)
  } catch (error: IllegalArgumentException) {
    throw mediaError(TempoLoopMediaError.PATH_OUTSIDE_APP, error)
  }
}
