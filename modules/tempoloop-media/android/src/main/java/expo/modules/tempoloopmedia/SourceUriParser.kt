package expo.modules.tempoloopmedia

import java.net.URI
import java.net.URISyntaxException

internal enum class SourceUriKind {
  CONTENT,
  FILE
}

internal data class ParsedSourceUri(
  val raw: String,
  val uri: URI,
  val kind: SourceUriKind
)

internal object SourceUriParser {
  fun parse(raw: String): ParsedSourceUri {
    if (raw.isBlank() || raw.any(Char::isISOControl)) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    }

    val uri = try {
      URI(raw)
    } catch (error: URISyntaxException) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
    }

    return when (uri.scheme?.lowercase()) {
      "content" -> parseContent(raw, uri)
      "file" -> parseFile(raw, uri)
      else -> throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    }
  }

  private fun parseContent(raw: String, uri: URI): ParsedSourceUri {
    if (uri.isOpaque || uri.authority.isNullOrBlank()) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    }
    return ParsedSourceUri(raw, uri, SourceUriKind.CONTENT)
  }

  private fun parseFile(raw: String, uri: URI): ParsedSourceUri {
    val authority = uri.authority
    val hasSupportedAuthority = authority.isNullOrEmpty() || authority.equals("localhost", true)
    val path = uri.path
    if (path == null) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    }
    if (
      uri.isOpaque ||
      !hasSupportedAuthority ||
      path.isBlank() ||
      !path.startsWith('/') ||
      uri.query != null ||
      uri.fragment != null
    ) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
    }
    return ParsedSourceUri(raw, uri, SourceUriKind.FILE)
  }
}
