package expo.modules.tempoloopmedia

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.InputStream

/**
 * Counts an unknown-size provider stream without copying it. The read stops on
 * the first byte beyond the effective source limit.
 */
internal object BoundedSourceReader {
  suspend fun verifyWithinLimit(
    context: Context,
    sourceUri: String,
    sourceKind: SourceMediaKind,
    requestedMaxAudioSourceBytes: Long,
    requestedMaxVideoSourceBytes: Long,
    cancellationCheck: () -> Unit = {},
    onBytesRead: (Long) -> Unit = {},
    ioDispatcher: CoroutineDispatcher = Dispatchers.IO
  ): Long = withContext(ioDispatcher) {
    val coroutineContext = currentCoroutineContext()
    coroutineContext.ensureActive()
    cancellationCheck()

    val parsedSource = SourceUriParser.parse(sourceUri)
    val uri = Uri.parse(parsedSource.raw)
    val limit = SourceSizePolicy.effectiveLimit(
      sourceKind,
      requestedMaxAudioSourceBytes,
      requestedMaxVideoSourceBytes
    )

    try {
      val stream = context.applicationContext.contentResolver.openInputStream(uri)
        ?: throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE)
      stream.use {
        BoundedInputStreamCounter.count(
          input = it,
          maxBytes = limit,
          tooLargeError = { SourceSizePolicy.tooLargeError(sourceKind) },
          cancellationCheck = {
            coroutineContext.ensureActive()
            cancellationCheck()
          },
          onBytesRead = onBytesRead
        )
      }
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: ImportCancellationSignal) {
      throw error
    } catch (error: SecurityException) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
    } catch (error: IllegalArgumentException) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
    } catch (error: IOException) {
      throw mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
    }
  }
}

internal object BoundedInputStreamCounter {
  private const val BUFFER_SIZE_BYTES = 64 * 1024

  fun count(
    input: InputStream,
    maxBytes: Long,
    tooLargeError: () -> TempoLoopMediaException = {
      mediaError(TempoLoopMediaError.VIDEO_TOO_LARGE)
    },
    cancellationCheck: () -> Unit = {},
    onBytesRead: (Long) -> Unit = {}
  ): Long {
    require(maxBytes >= 0L) { "maxBytes must not be negative" }

    val buffer = ByteArray(BUFFER_SIZE_BYTES)
    var totalBytes = 0L
    while (true) {
      cancellationCheck()

      // Read at most one byte beyond the limit so rejection is immediate and
      // a source exactly at the boundary still gets an EOF check.
      val bytesRemainingAtLimit = maxBytes - totalBytes
      val requestedRead = minOf(
        buffer.size.toLong(),
        bytesRemainingAtLimit.coerceAtLeast(0L) + 1L
      ).toInt()
      val readCount = input.read(buffer, 0, requestedRead)
      if (readCount < 0) {
        return totalBytes
      }
      if (readCount == 0) {
        val singleByte = input.read()
        if (singleByte < 0) {
          return totalBytes
        }
        totalBytes += 1L
      } else {
        totalBytes += readCount.toLong()
      }

      onBytesRead(totalBytes)

      if (totalBytes > maxBytes) {
        throw tooLargeError()
      }
    }
  }
}
