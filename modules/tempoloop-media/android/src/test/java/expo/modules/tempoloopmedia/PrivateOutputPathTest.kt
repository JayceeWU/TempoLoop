package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PrivateOutputPathTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `accepts a canonical child of an app private root`() {
    val privateRoot = temporaryFolder.newFolder("files")
    val output = File(privateRoot, "TempoLoop/imports/.import-1/audio.m4a.partial")

    val validated = PrivateOutputPath.requireSafeFileUri(
      output.toURI().toString(),
      listOf(privateRoot)
    )

    assertEquals(output.canonicalFile, validated)
  }

  @Test
  fun `rejects traversal sibling prefixes and the root itself`() {
    val privateRoot = temporaryFolder.newFolder("files")
    val sibling = temporaryFolder.newFolder("files-other")
    val traversal = File(privateRoot, "../outside/audio.m4a")

    listOf(traversal, File(sibling, "audio.m4a"), privateRoot).forEach { output ->
      val error = assertThrows(TempoLoopMediaException::class.java) {
        PrivateOutputPath.requireSafeFileUri(
          output.toURI().toString(),
          listOf(privateRoot)
        )
      }
      assertEquals("E_PATH_OUTSIDE_APP", error.code)
    }
  }

  @Test
  fun `rejects content output and empty root lists`() {
    val contentError = assertThrows(TempoLoopMediaException::class.java) {
      PrivateOutputPath.requireSafeFileUri(
        "content://provider/output/audio.m4a",
        listOf(temporaryFolder.root)
      )
    }
    assertEquals("E_PATH_OUTSIDE_APP", contentError.code)

    val output = File(temporaryFolder.root, "audio.m4a")
    val rootError = assertThrows(TempoLoopMediaException::class.java) {
      PrivateOutputPath.requireSafeFileUri(output.toURI().toString(), emptyList())
    }
    assertTrue(rootError.code == "E_PATH_OUTSIDE_APP")
  }

  @Test
  fun `rejects a file source that canonicalizes to the output before it can be deleted`() {
    val privateRoot = temporaryFolder.newFolder("private-source")
    val sourceAndOutput = File(privateRoot, "TempoLoop/imports/.import-1/audio.m4a.partial")
    sourceAndOutput.parentFile.mkdirs()
    sourceAndOutput.writeText("source must remain intact")
    val aliasedSource = File(sourceAndOutput.parentFile, "../.import-1/${sourceAndOutput.name}")

    val error = assertThrows(TempoLoopMediaException::class.java) {
      PrivateOutputPath.requireSafeImportFileUri(
        sourceAndOutput.toURI().toString(),
        listOf(privateRoot),
        SourceUriParser.parse(aliasedSource.toURI().toString())
      )
    }

    assertEquals("E_PATH_OUTSIDE_APP", error.code)
    assertTrue(sourceAndOutput.isFile)
    assertEquals("source must remain intact", sourceAndOutput.readText())
  }
}
