package expo.modules.tempoloopmedia

import android.os.SystemClock

internal fun interface ImportProgressSink {
  fun emit(event: ImportProgressEvent)
}

internal fun interface ProgressClock {
  fun elapsedRealtimeMs(): Long
}

internal class ImportProgressTracker(
  private val operationId: String,
  private val sink: ImportProgressSink,
  private val clock: ProgressClock = ProgressClock(SystemClock::elapsedRealtime),
  private val minimumIntervalMs: Long = DEFAULT_MINIMUM_INTERVAL_MS
) {
  private var stage: ImportStage? = null
  private var stageProgress: Double? = null
  private var overallProgress: Double? = null
  private var lastEmissionMs = Long.MIN_VALUE

  @Synchronized
  fun begin(nextStage: ImportStage, determinate: Boolean = true) {
    val currentStageIndex = stage?.ordinal ?: -1
    require(nextStage.ordinal > currentStageIndex) {
      "Import progress stages must advance in order."
    }

    stage = nextStage
    stageProgress = if (determinate) 0.0 else null
    emit(force = true)
  }

  @Synchronized
  fun update(progress: Double, force: Boolean = false) {
    val currentStage = checkNotNull(stage) { "Begin a progress stage before updating it." }
    val clamped = progress.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0) ?: return
    val previousStageProgress = stageProgress
    if (previousStageProgress != null && clamped < previousStageProgress) {
      return
    }

    stageProgress = clamped
    val stageOverall = overallFor(currentStage, clamped)
    overallProgress = maxOf(overallProgress ?: 0.0, stageOverall)
    emit(force = force || clamped == 1.0)
  }

  @Synchronized
  fun completeStage() {
    update(1.0, force = true)
  }

  /** Emits an indeterminate keepalive at the normal throttle rate. */
  @Synchronized
  fun heartbeat() {
    emit(force = false)
  }

  private fun emit(force: Boolean) {
    val currentStage = stage ?: return
    val now = clock.elapsedRealtimeMs()
    val canEmit = force ||
      lastEmissionMs == Long.MIN_VALUE ||
      now - lastEmissionMs >= minimumIntervalMs
    if (!canEmit) {
      return
    }

    lastEmissionMs = now
    sink.emit(
      ImportProgressEvent(
        operationId = operationId,
        stage = currentStage,
        stageProgress = stageProgress,
        overallProgress = overallProgress
      )
    )
  }

  private fun overallFor(stage: ImportStage, stageProgress: Double): Double {
    val range = STAGE_RANGES.getValue(stage)
    return range.start + (range.endInclusive - range.start) * stageProgress
  }

  private companion object {
    const val DEFAULT_MINIMUM_INTERVAL_MS = 125L

    val STAGE_RANGES = mapOf(
      ImportStage.INSPECTING to (0.0..0.10),
      ImportStage.EXPORTING to (0.10..0.70),
      ImportStage.WAVEFORM to (0.70..0.95),
      ImportStage.FINALIZING to (0.95..1.0)
    )
  }
}
