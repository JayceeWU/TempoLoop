package expo.modules.tempoloopmedia

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class AudioExportResult(
  val approximateDurationMs: Long?,
  val reportedFileSizeBytes: Long?,
  val audioWasExported: Boolean
)

@OptIn(UnstableApi::class)
internal class Media3AudioExporter(
  context: Context,
  private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {
  private val applicationContext = context.applicationContext

  suspend fun export(
    sourceUri: String,
    sourceKind: SourceMediaKind,
    outputFile: File,
    onProgress: (Double) -> Unit,
    onHeartbeat: () -> Unit,
    attachResource: (NativeOperationResource) -> Unit,
    detachResource: (NativeOperationResource) -> Unit
  ): AudioExportResult {
    var session: ExportSession? = null
    try {
      return suspendCancellableCoroutine { continuation ->
        val activeSession = ExportSession(
          applicationContext = applicationContext,
          sourceUri = sourceUri,
          sourceKind = sourceKind,
          outputFile = outputFile,
          mainHandler = mainHandler,
          onProgress = onProgress,
          onHeartbeat = onHeartbeat,
          detachResource = detachResource,
          onSuccess = { result ->
            continuation.resume(result)
          },
          onFailure = { error ->
            continuation.resumeWithException(error)
          }
        )
        session = activeSession

        continuation.invokeOnCancellation {
          activeSession.cancel()
        }

        try {
          attachResource(activeSession)
          activeSession.start()
        } catch (error: Throwable) {
          activeSession.cancel()
          continuation.resumeWithException(error)
        }
      }
    } catch (error: CancellationException) {
      // Await the main-Looper Transformer cancellation before the pipeline's
      // NonCancellable IO cleanup is allowed to delete the partial file.
      withContext(NonCancellable) {
        session?.cancelAndAwait()
      }
      throw error
    }
  }

  private class ExportSession(
    private val applicationContext: Context,
    private val sourceUri: String,
    private val sourceKind: SourceMediaKind,
    private val outputFile: File,
    private val mainHandler: Handler,
    private val onProgress: (Double) -> Unit,
    private val onHeartbeat: () -> Unit,
    private val detachResource: (NativeOperationResource) -> Unit,
    private val onSuccess: (AudioExportResult) -> Unit,
    private val onFailure: (Throwable) -> Unit
  ) : NativeOperationResource {
    private val finished = AtomicBoolean(false)
    private val terminationFinished = CompletableDeferred<Unit>()
    private var transformer: Transformer? = null

    private val listener = object : Transformer.Listener {
      override fun onCompleted(composition: Composition, exportResult: ExportResult) {
        complete(exportResult)
      }

      override fun onError(
        composition: Composition,
        exportResult: ExportResult,
        exportException: ExportException
      ) {
        // Media3 has already ended this export before dispatching onError.
        fail(mapExportError(exportException), cancelActiveExport = false)
      }
    }

    private val progressPoll = object : Runnable {
      override fun run() {
        if (finished.get()) {
          return
        }
        val activeTransformer = transformer ?: return
        try {
          val progress = ProgressHolder()
          if (activeTransformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
            runCatching {
              onProgress((progress.progress / 100.0).coerceIn(0.0, 1.0))
            }
          } else {
            runCatching(onHeartbeat)
          }
          mainHandler.postDelayed(this, PROGRESS_POLL_INTERVAL_MS)
        } catch (error: Throwable) {
          // A progress API failure does not imply the export itself stopped.
          fail(
            mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error),
            cancelActiveExport = true
          )
        }
      }
    }

    fun start() {
      val scheduled = runOnMain {
        if (finished.get()) {
          return@runOnMain
        }
        try {
          val editedMediaItemBuilder = EditedMediaItem.Builder(MediaItem.fromUri(sourceUri))
          if (sourceKind == SourceMediaKind.VIDEO) {
            editedMediaItemBuilder.setRemoveVideo(true)
          }
          val editedMediaItem = editedMediaItemBuilder.build()
          val activeTransformer = Transformer.Builder(applicationContext)
            .setLooper(mainHandler.looper)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setUsePlatformDiagnostics(false)
            .addListener(listener)
            .build()

          transformer = activeTransformer
          activeTransformer.start(editedMediaItem, outputFile.absolutePath)
          mainHandler.post(progressPoll)
        } catch (error: Throwable) {
          fail(mapStartError(error), cancelActiveExport = true)
        }
      }
      if (!scheduled) {
        fail(
          mediaError(TempoLoopMediaError.UNKNOWN_NATIVE),
          cancelActiveExport = false
        )
      }
    }

    override fun cancel() {
      if (!finished.compareAndSet(false, true)) {
        return
      }

      val cancelOnMain = {
        try {
          runCatching { transformer?.cancel() }
          cleanupOnMain()
          detachResource(this)
        } finally {
          terminationFinished.complete(Unit)
        }
      }
      if (!runOnMain(cancelOnMain)) {
        // The application looper is already shutting down. Avoid retaining the
        // session in the registry while process teardown completes.
        cleanupOnMain()
        detachResource(this)
        terminationFinished.complete(Unit)
      }
    }

    override suspend fun cancelAndAwait() {
      cancel()
      terminationFinished.await()
    }

    private fun complete(exportResult: ExportResult) {
      if (!finished.compareAndSet(false, true)) {
        return
      }
      runCatching { onProgress(1.0) }
      cleanupOnMain()
      detachResource(this)
      terminationFinished.complete(Unit)
      onSuccess(
        AudioExportResult(
          approximateDurationMs = exportResult.approximateDurationMs.takeIf { it > 0L },
          reportedFileSizeBytes = exportResult.fileSizeBytes.takeIf { it > 0L },
          audioWasExported =
            exportResult.audioConversionProcess != ExportResult.CONVERSION_PROCESS_NA
        )
      )
    }

    private fun fail(error: Throwable, cancelActiveExport: Boolean) {
      if (!finished.compareAndSet(false, true)) {
        return
      }
      if (cancelActiveExport) {
        runCatching { transformer?.cancel() }
      }
      cleanupOnMain()
      detachResource(this)
      terminationFinished.complete(Unit)
      onFailure(error)
    }

    private fun cleanupOnMain() {
      mainHandler.removeCallbacks(progressPoll)
      runCatching { transformer?.removeListener(listener) }
      transformer = null
    }

    private fun runOnMain(block: () -> Unit): Boolean =
      if (Looper.myLooper() == mainHandler.looper) {
        block()
        true
      } else {
        mainHandler.post { block() }
      }
  }

  private companion object {
    const val PROGRESS_POLL_INTERVAL_MS = 125L

    fun mapStartError(error: Throwable): TempoLoopMediaException = when (error) {
      is TempoLoopMediaException -> error
      is SecurityException -> mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)
      is IllegalArgumentException,
      is IllegalStateException -> mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA, error)
      else -> mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error)
    }

    fun mapExportError(error: ExportException): TempoLoopMediaException = when (error.errorCode) {
      ExportException.ERROR_CODE_IO_FILE_NOT_FOUND,
      ExportException.ERROR_CODE_IO_NO_PERMISSION,
      ExportException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
      ExportException.ERROR_CODE_IO_UNSPECIFIED ->
        mediaError(TempoLoopMediaError.SOURCE_UNREADABLE, error)

      ExportException.ERROR_CODE_MUXING_FAILED,
      ExportException.ERROR_CODE_MUXING_TIMEOUT,
      ExportException.ERROR_CODE_MUXING_APPEND ->
        mediaError(TempoLoopMediaError.OUTPUT_WRITE_FAILED, error)

      ExportException.ERROR_CODE_DECODER_INIT_FAILED,
      ExportException.ERROR_CODE_DECODING_FAILED,
      ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
      ExportException.ERROR_CODE_ENCODER_INIT_FAILED,
      ExportException.ERROR_CODE_ENCODING_FAILED,
      ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED,
      ExportException.ERROR_CODE_AUDIO_PROCESSING_FAILED ->
        mediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA, error)

      else -> mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error)
    }
  }
}
