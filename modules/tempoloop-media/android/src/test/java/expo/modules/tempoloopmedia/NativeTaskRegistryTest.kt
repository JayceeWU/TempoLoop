package expo.modules.tempoloopmedia

import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class NativeTaskRegistryTest {
  @Test
  fun `only one import may be active`() {
    val registry = NativeTaskRegistry()
    val firstJob = Job()
    registry.registerImport("operation-1", firstJob)

    val error = assertThrows(TempoLoopMediaException::class.java) {
      registry.registerImport("operation-2", Job())
    }

    assertEquals("E_IMPORT_BUSY", error.code)
    registry.completeImport("operation-1", firstJob)
    assertFalse(registry.hasActiveImport())
  }

  @Test
  fun `completion releases resources and opens the import slot`() {
    val registry = NativeTaskRegistry()
    val firstJob = Job()
    val releaseCount = AtomicInteger(0)
    registry.registerImport("operation-1", firstJob)
    registry.attachResource("operation-1") {
      releaseCount.incrementAndGet()
    }

    registry.completeImport("operation-1", firstJob)
    registry.registerImport("operation-2", Job())

    assertEquals(1, releaseCount.get())
    assertTrue(registry.hasActiveImport())
  }

  @Test
  fun `cancellation is idempotent and releases registered resources`() {
    val registry = NativeTaskRegistry()
    val job = Job()
    val releaseCount = AtomicInteger(0)
    registry.registerImport("operation-1", job)
    registry.attachResource("operation-1") {
      releaseCount.incrementAndGet()
    }

    runBlocking {
      registry.cancelImport("operation-1")
      registry.cancelImport("operation-1")
      registry.cancelImport("unknown-operation")
    }

    assertTrue(job.isCancelled)
    assertTrue(registry.isCancellationRequested("operation-1"))
    assertEquals(1, releaseCount.get())
  }

  @Test
  fun `a resource attached after cancellation is immediately released`() {
    val registry = NativeTaskRegistry()
    val job = Job()
    val releaseCount = AtomicInteger(0)
    registry.registerImport("operation-1", job)
    runBlocking {
      registry.cancelImport("operation-1")
    }

    val error = assertThrows(TempoLoopMediaException::class.java) {
      registry.attachResource("operation-1") {
        releaseCount.incrementAndGet()
      }
    }

    assertEquals("E_IMPORT_CANCELLED", error.code)
    assertEquals(1, releaseCount.get())
  }

  @Test
  fun `explicit cancellation awaits native resource shutdown before cancelling the job`() =
    runBlocking {
      val registry = NativeTaskRegistry()
      val job = Job()
      val events = mutableListOf<String>()
      val resource = object : NativeOperationResource {
        override fun cancel() {
          events += "cancel"
        }

        override suspend fun cancelAndAwait() {
          assertFalse(job.isCancelled)
          cancel()
          events += "stopped"
        }
      }
      registry.registerImport("operation-await", job)
      registry.attachResource("operation-await", resource)

      registry.cancelImport("operation-await")

      assertEquals(listOf("cancel", "stopped"), events)
      assertTrue(job.isCancelled)
    }

  @Test
  fun `module destruction cancels tracked work and releases resources`() {
    val registry = NativeTaskRegistry()
    val inspectionJob = Job()
    val importJob = Job()
    val releaseCount = AtomicInteger(0)
    registry.track(inspectionJob)
    registry.registerImport("operation-1", importJob)
    registry.attachResource("operation-1") {
      releaseCount.incrementAndGet()
    }

    registry.cancelAll()
    registry.cancelAll()

    assertTrue(inspectionJob.isCancelled)
    assertTrue(importJob.isCancelled)
    assertEquals(1, releaseCount.get())
    assertFalse(registry.hasActiveImport())
  }
}
