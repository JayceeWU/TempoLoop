package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportStorageEstimatorTest {
  @Test
  fun `uses conservative bitrate when source audio bitrate is unknown`() {
    val estimate = ImportStorageEstimator.estimate(
      durationMs = 60_000L,
      sourceAudioBitrateBitsPerSecond = null
    )

    assertEquals(3_840_000L, estimate.expectedAudioBytes)
    assertEquals(16L * 1024L * 1024L, estimate.transformationOverheadBytes)
    assertEquals(32L * 1024L * 1024L, estimate.minimumFreeReserveBytes)
    assertEquals(54_171_648L, estimate.requiredUsableBytes)
  }

  @Test
  fun `uses higher source audio bitrate when transmux may retain it`() {
    val estimate = ImportStorageEstimator.estimate(
      durationMs = 60_000L,
      sourceAudioBitrateBitsPerSecond = 320_000L,
      targetAudioBitrateBitsPerSecond = 192_000L
    )

    assertEquals(2_400_000L, estimate.expectedAudioBytes)
  }

  @Test
  fun `rounds fractional encoded bytes upward`() {
    val estimate = ImportStorageEstimator.estimate(
      durationMs = 1L,
      sourceAudioBitrateBitsPerSecond = 1L,
      targetAudioBitrateBitsPerSecond = 1L
    )

    assertEquals(1L, estimate.expectedAudioBytes)
  }

  @Test
  fun `near limit source does not reserve a second full video`() {
    val estimate = ImportStorageEstimator.estimate(
      durationMs = 10L * 60L * 1_000L,
      sourceAudioBitrateBitsPerSecond = 192_000L
    )

    assertTrue(estimate.requiredUsableBytes < 100L * 1024L * 1024L)
  }

  @Test
  fun `space comparison accepts exact boundary and rejects one byte less`() {
    val estimate = ImportStorageEstimator.estimate(
      durationMs = 60_000L,
      sourceAudioBitrateBitsPerSecond = null
    )

    assertTrue(
      ImportStorageEstimator.hasSufficientSpace(
        estimate.requiredUsableBytes,
        estimate
      )
    )
    assertFalse(
      ImportStorageEstimator.hasSufficientSpace(
        estimate.requiredUsableBytes - 1L,
        estimate
      )
    )
  }
}
