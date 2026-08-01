package expo.modules.tempoloopmedia

internal enum class ImportOperationState {
  IDLE,
  INSPECTING,
  EXPORTING,
  WAVEFORM,
  FINALIZING,
  COMPLETED,
  FAILED,
  CANCELLED
}

internal class ImportStateMachine {
  private var currentState = ImportOperationState.IDLE

  val state: ImportOperationState
    @Synchronized get() = currentState

  @Synchronized
  fun transition(nextState: ImportOperationState) {
    val allowed = when (currentState) {
      ImportOperationState.IDLE -> setOf(ImportOperationState.INSPECTING)
      ImportOperationState.INSPECTING -> setOf(
        ImportOperationState.EXPORTING,
        ImportOperationState.FAILED,
        ImportOperationState.CANCELLED
      )
      ImportOperationState.EXPORTING -> setOf(
        ImportOperationState.WAVEFORM,
        ImportOperationState.FAILED,
        ImportOperationState.CANCELLED
      )
      ImportOperationState.WAVEFORM -> setOf(
        ImportOperationState.FINALIZING,
        ImportOperationState.FAILED,
        ImportOperationState.CANCELLED
      )
      ImportOperationState.FINALIZING -> setOf(
        ImportOperationState.COMPLETED,
        ImportOperationState.FAILED,
        ImportOperationState.CANCELLED
      )
      ImportOperationState.COMPLETED,
      ImportOperationState.FAILED,
      ImportOperationState.CANCELLED -> emptySet()
    }

    check(nextState in allowed) {
      "Invalid import transition: $currentState -> $nextState"
    }
    currentState = nextState
  }

  @Synchronized
  fun fail() {
    if (!currentState.isTerminal()) {
      transition(ImportOperationState.FAILED)
    }
  }

  @Synchronized
  fun cancel() {
    if (!currentState.isTerminal()) {
      transition(ImportOperationState.CANCELLED)
    }
  }

  private fun ImportOperationState.isTerminal(): Boolean =
    this == ImportOperationState.COMPLETED ||
      this == ImportOperationState.FAILED ||
      this == ImportOperationState.CANCELLED
}
