package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.Assert.assertThrows

class SourceSizePolicyTest {
  @Test
  fun `unknown sizes remain unknown instead of becoming zero`() {
    assertNull(SourceSizePolicy.normalizeReportedSize(-1L))
    assertNull(SourceSizePolicy.normalizeReportedSize(0L))
    assertEquals(1L, SourceSizePolicy.normalizeReportedSize(1L) ?: -1L)
  }

  @Test
  fun `exactly 600 MiB is accepted`() {
    SourceSizePolicy.requireWithinLimit(
      sourceSizeBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES,
      sourceKind = SourceMediaKind.VIDEO,
      requestedMaxAudioSourceBytes = SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES,
      requestedMaxVideoSourceBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES
    )
  }

  @Test
  fun `one byte above 600 MiB is rejected`() {
    val error = assertThrows(TempoLoopMediaException::class.java) {
      SourceSizePolicy.requireWithinLimit(
        sourceSizeBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES + 1L,
        sourceKind = SourceMediaKind.VIDEO,
        requestedMaxAudioSourceBytes = SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES,
        requestedMaxVideoSourceBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES
      )
    }

    assertEquals("E_VIDEO_TOO_LARGE", error.code)
  }

  @Test
  fun `native hard limit cannot be raised by JavaScript`() {
    val error = assertThrows(TempoLoopMediaException::class.java) {
      SourceSizePolicy.requireWithinLimit(
        sourceSizeBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES + 1L,
        sourceKind = SourceMediaKind.VIDEO,
        requestedMaxAudioSourceBytes = Long.MAX_VALUE,
        requestedMaxVideoSourceBytes = Long.MAX_VALUE
      )
    }

    assertEquals("E_VIDEO_TOO_LARGE", error.code)
  }

  @Test
  fun `a lower requested limit is honored and null size is allowed`() {
    SourceSizePolicy.requireWithinLimit(null, SourceMediaKind.VIDEO, 25L, 50L)

    val error = assertThrows(TempoLoopMediaException::class.java) {
      SourceSizePolicy.requireWithinLimit(51L, SourceMediaKind.VIDEO, 25L, 50L)
    }
    assertEquals("E_VIDEO_TOO_LARGE", error.code)
  }

  @Test
  fun `audio uses an independent 200 MiB limit and error code`() {
    SourceSizePolicy.requireWithinLimit(
      SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES,
      SourceMediaKind.AUDIO,
      SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES,
      SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES
    )

    val error = assertThrows(TempoLoopMediaException::class.java) {
      SourceSizePolicy.requireWithinLimit(
        SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES + 1L,
        SourceMediaKind.AUDIO,
        SourceSizePolicy.MAX_AUDIO_SOURCE_BYTES,
        SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES
      )
    }
    assertEquals("E_AUDIO_TOO_LARGE", error.code)
  }

  @Test
  fun `size candidates are checked in order and the largest reliable value wins`() {
    val calls = mutableListOf<String>()
    val size = ReliableSizeResolver.resolve(
      querySize = {
        calls += "query"
        -1L
      },
      assetDescriptorLength = {
        calls += "afd"
        42L
      },
      parcelDescriptorSize = {
        calls += "pfd"
        99L
      }
    )

    assertEquals(99L, size ?: -1L)
    assertEquals(listOf("query", "afd", "pfd"), calls)
  }

  @Test
  fun `all unavailable size candidates resolve to null`() {
    val size = ReliableSizeResolver.resolve(
      querySize = { null },
      assetDescriptorLength = { -1L },
      parcelDescriptorSize = { null }
    )

    assertNull(size)
  }
}
