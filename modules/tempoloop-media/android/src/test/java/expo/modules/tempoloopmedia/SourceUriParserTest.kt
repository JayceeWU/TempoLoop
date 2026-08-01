package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SourceUriParserTest {
  @Test
  fun `accepts opaque provider content identifiers without path conversion`() {
    val raw = "content://com.example.provider/document/video%3A42?token=opaque%2Fvalue"
    val parsed = SourceUriParser.parse(raw)

    assertEquals(SourceUriKind.CONTENT, parsed.kind)
    assertEquals(raw, parsed.raw)
  }

  @Test
  fun `accepts an absolute local file URI`() {
    val parsed = SourceUriParser.parse("file:///data/user/0/com.tempoloop.app/files/video.mp4")

    assertEquals(SourceUriKind.FILE, parsed.kind)
  }

  @Test
  fun `rejects network and malformed URIs`() {
    listOf(
      "https://example.com/video.mp4",
      "content:/missing-authority/video.mp4",
      "file:relative/video.mp4",
      "file:///data/video.mp4?query=not-allowed",
      "content://provider/video\u0000"
    ).forEach { raw ->
      val error = assertThrows(TempoLoopMediaException::class.java) {
        SourceUriParser.parse(raw)
      }
      assertEquals("E_SOURCE_UNREADABLE", error.code)
    }
  }
}
