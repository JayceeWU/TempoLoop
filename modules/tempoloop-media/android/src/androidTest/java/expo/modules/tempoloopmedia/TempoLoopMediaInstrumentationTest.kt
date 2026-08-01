package expo.modules.tempoloopmedia

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.Collections
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeNoException
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TempoLoopMediaInstrumentationTest {
  private val context: Context
    get() = InstrumentationRegistry.getInstrumentation().targetContext

  private lateinit var cacheRoot: File
  private lateinit var contentFixtureRoot: File
  private lateinit var outputRoot: File

  @Before
  fun createTestDirectories() {
    val runId = UUID.randomUUID().toString()
    cacheRoot = File(context.cacheDir, "tempoloop-media-instrumentation/$runId")
    contentFixtureRoot = File(
      InstrumentationRegistry.getInstrumentation().context.cacheDir,
      MediaFixtureContentProvider.FIXTURE_DIRECTORY
    )
    outputRoot = File(context.filesDir, "tempoloop-media-instrumentation/$runId")
    assertTrue(cacheRoot.mkdirs())
    if (contentFixtureRoot.exists()) {
      assertTrue(contentFixtureRoot.deleteRecursively())
    }
    assertTrue(contentFixtureRoot.mkdirs())
    assertTrue(outputRoot.mkdirs())
  }

  @After
  fun removeTestDirectories() {
    cacheRoot.deleteRecursively()
    contentFixtureRoot.deleteRecursively()
    outputRoot.deleteRecursively()
  }

  @Test
  fun aacVideoCompletesAudioOnlyImportAndWaveform() = runBlocking {
    val sourceFile = fixture {
      MediaFixtureFactory.createAacAvcVideo(File(contentFixtureRoot, "aac-video.mp4"))
    }
    val sourceUri = Uri.Builder()
      .scheme("content")
      .authority(MediaFixtureContentProvider.AUTHORITY)
      .appendPath(sourceFile.name)
      .build()
      .toString()
    val inspection = MediaInspector(context, Dispatchers.IO).inspect(
      InspectMediaOptions(
        sourceUri = sourceUri,
        maxAudioSourceBytes = MAX_AUDIO_SOURCE_BYTES,
        maxVideoSourceBytes = MAX_VIDEO_SOURCE_BYTES
      )
    )

    assertEquals("audio/mp4a-latm", inspection.audioMimeType)
    assertEquals(SourceMediaKind.VIDEO, inspection.sourceKind)
    assertEquals(1, inspection.channelCount)
    assertEquals(44_100, inspection.sampleRate)
    assertTrue(inspection.durationMs > 0L)

    val output = File(outputRoot, "audio.m4a.partial")
    val (result, progressEvents) = importFixture(sourceUri, output)

    assertEquals(Uri.fromFile(output).toString(), result.audioUri)
    assertTrue(result.audioSizeBytes > 0L)
    assertTrue(result.durationMs > 0L)
    assertEquals(WAVEFORM_BIN_COUNT, result.waveform.size)
    assertTrue(result.waveform.all { it.isFinite() && it in 0.0..1.0 })
    assertTrue(result.waveform.any { it > 0.0 })
    assertAudioOnlyAac(output)

    assertEquals(
      listOf(
        ImportStage.INSPECTING,
        ImportStage.EXPORTING,
        ImportStage.WAVEFORM,
        ImportStage.FINALIZING
      ),
      progressEvents.map(ImportProgressEvent::stage).distinct()
    )
    val overallProgress = progressEvents.mapNotNull(ImportProgressEvent::overallProgress)
    assertFalse(overallProgress.isEmpty())
    assertTrue(overallProgress.zipWithNext().all { (left, right) -> right >= left })
    assertEquals(1.0, overallProgress.last(), 0.0)
  }

  @Test
  fun videoWithoutAudioTrackIsRejected() = runBlocking {
    val source = fixture {
      MediaFixtureFactory.createVideoOnly(File(cacheRoot, "video-only.mp4"))
    }

    expectMediaError(TempoLoopMediaError.NO_AUDIO_TRACK) {
      MediaInspector(context, Dispatchers.IO).inspect(
        inspectOptions(Uri.fromFile(source).toString())
      )
    }
  }

  @Test
  fun audioOnlyAacCompletesTheSamePrivateM4aTransaction() = runBlocking {
    val source = fixture {
      MediaFixtureFactory.createAacAudio(
        outputFile = File(cacheRoot, "direct-audio.m4a"),
        durationMs = 800L,
        channelCount = 2,
        signal = AudioSignal.TONE
      )
    }
    val sourceUri = Uri.fromFile(source).toString()
    val inspection = MediaInspector(context, Dispatchers.IO).inspect(inspectOptions(sourceUri))
    assertEquals(SourceMediaKind.AUDIO, inspection.sourceKind)

    val output = File(outputRoot, "direct-audio-output.m4a.partial")
    val (result, _) = importFixture(sourceUri, output)

    assertTrue(result.audioSizeBytes > 0L)
    assertEquals(WAVEFORM_BIN_COUNT, result.waveform.size)
    assertTrue(result.waveform.all { it.isFinite() && it in 0.0..1.0 })
    assertAudioOnlyAac(output)
  }

  @Test
  fun shortAacAudioStillProducesExactFiniteWaveform() = runBlocking {
    val source = fixture {
      MediaFixtureFactory.createAacAudio(
        outputFile = File(cacheRoot, "short-audio.m4a"),
        durationMs = 120L,
        channelCount = 1,
        signal = AudioSignal.TONE
      )
    }
    val validated = ExportedAudioValidator.validate(source)
    val waveform = WaveformGenerator(Dispatchers.IO).generate(
      audioFile = source,
      durationMs = validated.durationMs,
      binCount = WAVEFORM_BIN_COUNT
    )

    assertTrue(validated.durationMs in 1L..1_000L)
    assertEquals(WAVEFORM_BIN_COUNT, waveform.size)
    assertTrue(waveform.all { it.isFinite() && it in 0.0..1.0 })
    assertTrue(waveform.any { it > 0.0 })
  }

  @Test
  fun silentAacAudioProducesZeroWaveform() = runBlocking {
    val source = fixture {
      MediaFixtureFactory.createAacAudio(
        outputFile = File(cacheRoot, "silence.m4a"),
        durationMs = 400L,
        channelCount = 1,
        signal = AudioSignal.SILENCE
      )
    }
    val validated = ExportedAudioValidator.validate(source)
    val waveform = WaveformGenerator(Dispatchers.IO).generate(
      audioFile = source,
      durationMs = validated.durationMs,
      binCount = WAVEFORM_BIN_COUNT
    )

    assertEquals(List(WAVEFORM_BIN_COUNT) { 0.0 }, waveform)
  }

  @Test
  fun stereoAacAudioRetainsChannelMetadataAndDecodes() = runBlocking {
    val source = fixture {
      MediaFixtureFactory.createAacAudio(
        outputFile = File(cacheRoot, "stereo.m4a"),
        durationMs = 400L,
        channelCount = 2,
        signal = AudioSignal.TONE
      )
    }
    val inspection = MediaInspector(context, Dispatchers.IO).inspect(
      inspectOptions(Uri.fromFile(source).toString())
    )
    val waveform = WaveformGenerator(Dispatchers.IO).generate(
      audioFile = source,
      durationMs = inspection.durationMs,
      binCount = WAVEFORM_BIN_COUNT
    )

    assertEquals(2, inspection.channelCount)
    assertEquals(SourceMediaKind.AUDIO, inspection.sourceKind)
    assertEquals(WAVEFORM_BIN_COUNT, waveform.size)
    assertTrue(waveform.all { it.isFinite() && it in 0.0..1.0 })
    assertTrue(waveform.any { it > 0.0 })
  }

  @Test
  fun malformedMediaIsRejectedWithoutCreatingOutput() = runBlocking {
    val source = File(cacheRoot, "malformed.mp4")
    source.outputStream().use { stream ->
      stream.write("not a media container".toByteArray(Charsets.US_ASCII))
    }
    val output = File(outputRoot, "malformed-output.m4a.partial")

    expectMediaError(TempoLoopMediaError.UNSUPPORTED_MEDIA) {
      MediaInspector(context, Dispatchers.IO).inspect(
        inspectOptions(Uri.fromFile(source).toString())
      )
    }
    assertFalse(output.exists())
  }

  private suspend fun importFixture(
    sourceUri: String,
    output: File
  ): Pair<ImportMediaResult, List<ImportProgressEvent>> = coroutineScope {
    val operationId = "instrumentation-${UUID.randomUUID()}"
    val taskRegistry = NativeTaskRegistry()
    val progressEvents = Collections.synchronizedList(mutableListOf<ImportProgressEvent>())
    val pipeline = MediaImportPipeline(
      context = context,
      ioDispatcher = Dispatchers.IO,
      mediaInspector = MediaInspector(context, Dispatchers.IO),
      waveformGenerator = WaveformGenerator(Dispatchers.IO),
      audioExporter = Media3AudioExporter(context, Handler(Looper.getMainLooper())),
      taskRegistry = taskRegistry,
      progressSink = ImportProgressSink { event -> progressEvents.add(event) },
      allowedOutputRoots = { listOf(context.filesDir) }
    )
    val job = currentCoroutineContext().job
    taskRegistry.registerImport(operationId, job)
    try {
      pipeline.import(
        ImportMediaOptions(
          operationId = operationId,
          sourceUri = sourceUri,
          outputAudioUri = Uri.fromFile(output).toString(),
          waveformBinCount = WAVEFORM_BIN_COUNT,
          maxAudioSourceBytes = MAX_AUDIO_SOURCE_BYTES,
          maxVideoSourceBytes = MAX_VIDEO_SOURCE_BYTES
        )
      ) to progressEvents.toList()
    } finally {
      taskRegistry.completeImport(operationId, job)
    }
  }

  private suspend fun expectMediaError(
    expected: TempoLoopMediaError,
    block: suspend () -> Unit
  ) {
    try {
      block()
      fail("Expected ${expected.code}")
    } catch (error: TempoLoopMediaException) {
      assertEquals(expected, error.error)
    }
  }

  private fun inspectOptions(sourceUri: String) = InspectMediaOptions(
    sourceUri = sourceUri,
    maxAudioSourceBytes = MAX_AUDIO_SOURCE_BYTES,
    maxVideoSourceBytes = MAX_VIDEO_SOURCE_BYTES
  )

  private fun assertAudioOnlyAac(file: File) {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.absolutePath)
      var audioTracks = 0
      var videoTracks = 0
      for (trackIndex in 0 until extractor.trackCount) {
        val mimeType = extractor.getTrackFormat(trackIndex).getString(MediaFormat.KEY_MIME)
        if (mimeType?.startsWith("audio/") == true) {
          audioTracks += 1
          assertEquals("audio/mp4a-latm", mimeType)
        }
        if (mimeType?.startsWith("video/") == true) {
          videoTracks += 1
        }
      }
      assertEquals(1, audioTracks)
      assertEquals(0, videoTracks)
    } finally {
      extractor.release()
    }
  }

  private fun fixture(create: () -> File): File = try {
    create()
  } catch (error: FixtureUnavailableException) {
    assumeNoException("Required platform test codec is unavailable", error)
    throw error
  }

  private companion object {
    const val WAVEFORM_BIN_COUNT = 2_048
    const val MAX_AUDIO_SOURCE_BYTES = 209_715_200L
    const val MAX_VIDEO_SOURCE_BYTES = 629_145_600L
  }
}
