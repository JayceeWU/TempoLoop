package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportProgressTrackerTest {
  @Test
  fun `throttles updates while forcing stage boundaries`() {
    val clock = FakeProgressClock()
    val events = mutableListOf<ImportProgressEvent>()
    val tracker = ImportProgressTracker(
      operationId = "operation-1",
      sink = ImportProgressSink(events::add),
      clock = clock,
      minimumIntervalMs = 125L
    )

    tracker.begin(ImportStage.INSPECTING, determinate = false)
    assertEquals(1, events.size)
    assertNull(events.single().stageProgress)
    assertNull(events.single().overallProgress)

    tracker.update(0.2)
    tracker.update(0.4)
    assertEquals(1, events.size)

    clock.advance(125L)
    tracker.update(0.6)
    assertEquals(2, events.size)
    assertEquals(0.06, events.last().overallProgress!!, 0.000_001)

    tracker.completeStage()
    tracker.begin(ImportStage.EXPORTING)
    assertEquals(4, events.size)
    assertEquals(0.10, events.last().overallProgress!!, 0.000_001)
  }

  @Test
  fun `never regresses stage or overall progress`() {
    val clock = FakeProgressClock()
    val events = mutableListOf<ImportProgressEvent>()
    val tracker = ImportProgressTracker(
      operationId = "operation-2",
      sink = ImportProgressSink(events::add),
      clock = clock,
      minimumIntervalMs = 0L
    )

    tracker.begin(ImportStage.INSPECTING)
    tracker.update(0.8)
    tracker.update(0.3)
    tracker.completeStage()
    tracker.begin(ImportStage.EXPORTING)
    tracker.update(0.5)
    tracker.completeStage()
    tracker.begin(ImportStage.WAVEFORM)
    tracker.completeStage()
    tracker.begin(ImportStage.FINALIZING)
    tracker.completeStage()

    val numericOverall = events.mapNotNull(ImportProgressEvent::overallProgress)
    assertTrue(numericOverall.zipWithNext().all { (left, right) -> right >= left })
    assertEquals(1.0, numericOverall.last(), 0.000_001)
    assertEquals(1, events.count { it.stageProgress == 0.8 })
    assertEquals(0, events.count { it.stageProgress == 0.3 })

    assertThrows(IllegalArgumentException::class.java) {
      tracker.begin(ImportStage.EXPORTING)
    }
  }

  @Test
  fun `indeterminate heartbeat is throttled and keeps progress null`() {
    val clock = FakeProgressClock()
    val events = mutableListOf<ImportProgressEvent>()
    val tracker = ImportProgressTracker(
      operationId = "operation-heartbeat",
      sink = ImportProgressSink(events::add),
      clock = clock,
      minimumIntervalMs = 125L
    )

    tracker.begin(ImportStage.INSPECTING, determinate = false)
    tracker.heartbeat()
    assertEquals(1, events.size)

    clock.advance(125L)
    tracker.heartbeat()
    assertEquals(2, events.size)
    assertNull(events.last().stageProgress)
    assertNull(events.last().overallProgress)
  }

  private class FakeProgressClock : ProgressClock {
    private var nowMs = 1_000L

    override fun elapsedRealtimeMs(): Long = nowMs

    fun advance(milliseconds: Long) {
      nowMs += milliseconds
    }
  }
}
