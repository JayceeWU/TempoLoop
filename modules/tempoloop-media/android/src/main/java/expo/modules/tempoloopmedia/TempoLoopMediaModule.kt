package expo.modules.tempoloopmedia

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import java.util.concurrent.atomic.AtomicBoolean

@Suppress("unused")
class TempoLoopMediaModule : Module() {
  private val ioDispatcher = Dispatchers.IO.limitedParallelism(IO_PARALLELISM)
  private val taskRegistry = NativeTaskRegistry()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val destroyed = AtomicBoolean(false)
  private val pickerActive = AtomicBoolean(false)
  private lateinit var galleryVideoPicker: AppContextActivityResultLauncher<
    GalleryVideoPickerOptions,
    GalleryVideoPickerResult
  >

  private val context: Context
    get() = appContext.reactContext
      ?: throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE)

  private val mediaInspector by lazy {
    MediaInspector(context, ioDispatcher)
  }

  private val waveformGenerator by lazy {
    WaveformGenerator(ioDispatcher)
  }

  private val audioExporter by lazy {
    Media3AudioExporter(context, mainHandler)
  }

  private val importPipeline by lazy {
    MediaImportPipeline(
      context = context,
      ioDispatcher = ioDispatcher,
      mediaInspector = mediaInspector,
      waveformGenerator = waveformGenerator,
      audioExporter = audioExporter,
      taskRegistry = taskRegistry,
      progressSink = ImportProgressSink(::emitImportProgress),
      allowedOutputRoots = {
        listOf(appContext.persistentFilesDirectory, context.filesDir)
      }
    )
  }

  override fun definition() = ModuleDefinition {
    Name("TempoLoopMedia")

    Events("onImportProgress")

    RegisterActivityContracts {
      galleryVideoPicker = registerForActivityResult(
        GalleryVideoPickerContract(this@TempoLoopMediaModule)
      )
    }

    AsyncFunction("pickGalleryVideo") Coroutine { ->
      pickGalleryVideo()
    }

    AsyncFunction("inspectMedia") Coroutine { options: InspectMediaOptions ->
      inspectMedia(options)
    }

    AsyncFunction("importProjectMedia") Coroutine { options: ImportMediaOptions ->
      importProjectMedia(options)
    }

    AsyncFunction("cancelImport") Coroutine { operationId: String ->
      taskRegistry.cancelImport(operationId)
    }

    OnDestroy {
      destroyed.set(true)
      pickerActive.set(false)
      taskRegistry.cancelAll()
    }
  }

  private suspend fun pickGalleryVideo(): PickedMediaSource? {
    if (destroyed.get() || !pickerActive.compareAndSet(false, true)) {
      throw mediaError(TempoLoopMediaError.IMPORT_BUSY)
    }
    return try {
      when (val result = galleryVideoPicker.launch(GalleryVideoPickerOptions())) {
        GalleryVideoPickerResult.Cancelled -> null
        is GalleryVideoPickerResult.Success -> result.source
      }
    } finally {
      pickerActive.set(false)
    }
  }

  private suspend fun inspectMedia(options: InspectMediaOptions): MediaInspection {
    val job = currentCoroutineContext().job
    taskRegistry.track(job)
    return try {
      mediaInspector.inspect(options)
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error)
    } finally {
      taskRegistry.untrack(job)
    }
  }

  private suspend fun importProjectMedia(options: ImportMediaOptions): ImportMediaResult {
    val job = currentCoroutineContext().job
    taskRegistry.registerImport(options.operationId, job)
    return try {
      importPipeline.import(options)
    } catch (error: TempoLoopMediaException) {
      throw error
    } catch (error: CancellationException) {
      throw mediaError(TempoLoopMediaError.IMPORT_CANCELLED, error)
    } catch (error: Throwable) {
      throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE, error)
    } finally {
      taskRegistry.completeImport(options.operationId, job)
    }
  }

  private fun emitImportProgress(event: ImportProgressEvent) {
    val emit = {
      if (!destroyed.get()) {
        sendEvent(
          "onImportProgress",
          mapOf(
            "operationId" to event.operationId,
            "stage" to event.stage.value,
            "stageProgress" to event.stageProgress,
            "overallProgress" to event.overallProgress
          )
        )
      }
    }

    if (Looper.myLooper() == mainHandler.looper) {
      emit()
    } else {
      mainHandler.post { emit() }
    }
  }

  private companion object {
    const val IO_PARALLELISM = 2
  }
}
