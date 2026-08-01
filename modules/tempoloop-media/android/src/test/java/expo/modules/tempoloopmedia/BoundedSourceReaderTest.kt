package expo.modules.tempoloopmedia

import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BoundedSourceReaderTest {
  @Test
  fun `accepts a stream exactly at its byte limit`() {
    val result = BoundedInputStreamCounter.count(
      input = SizedInputStream(629_145_600L),
      maxBytes = SourceSizePolicy.MAX_VIDEO_SOURCE_BYTES
    )

    assertEquals(629_145_600L, result)
  }

  @Test
  fun `rejects on the first byte over the effective limit`() {
    val stream = SizedInputStream(11L)

    val error = assertThrows(TempoLoopMediaException::class.java) {
      BoundedInputStreamCounter.count(stream, maxBytes = 10L)
    }

    assertEquals(TempoLoopMediaError.VIDEO_TOO_LARGE, error.error)
    assertEquals(11L, stream.bytesRead)
  }

  @Test
  fun `uses the audio-specific overflow error when requested`() {
    val error = assertThrows(TempoLoopMediaException::class.java) {
      BoundedInputStreamCounter.count(
        input = SizedInputStream(11L),
        maxBytes = 10L,
        tooLargeError = { mediaError(TempoLoopMediaError.AUDIO_TOO_LARGE) }
      )
    }

    assertEquals(TempoLoopMediaError.AUDIO_TOO_LARGE, error.error)
  }

  @Test
  fun `checks cancellation between bounded reads`() {
    var checks = 0

    assertThrows(ImportCancellationSignal::class.java) {
      BoundedInputStreamCounter.count(
        input = SizedInputStream(200_000L),
        maxBytes = 200_000L,
        cancellationCheck = {
          checks += 1
          if (checks == 2) throw ImportCancellationSignal()
        }
      )
    }

    assertEquals(2, checks)
  }

  @Test
  fun `reports bounded read progress without retaining source bytes`() {
    val totals = mutableListOf<Long>()

    BoundedInputStreamCounter.count(
      input = SizedInputStream(70_000L),
      maxBytes = 100_000L,
      onBytesRead = { total -> totals += total }
    )

    assertEquals(70_000L, totals.last())
    assertEquals(listOf(65_536L, 70_000L), totals)
  }

  private class SizedInputStream(
    private val size: Long
  ) : InputStream() {
    var bytesRead: Long = 0L
      private set

    override fun read(): Int =
      if (bytesRead >= size) {
        -1
      } else {
        bytesRead += 1L
        0
      }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      if (bytesRead >= size) {
        return -1
      }
      val count = minOf(length.toLong(), size - bytesRead).toInt()
      bytesRead += count.toLong()
      return count
    }
  }
}
