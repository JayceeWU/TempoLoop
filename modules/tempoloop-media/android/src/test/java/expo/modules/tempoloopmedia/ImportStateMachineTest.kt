package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ImportStateMachineTest {
  @Test
  fun `accepts the complete ordered import path`() {
    val machine = ImportStateMachine()

    machine.transition(ImportOperationState.INSPECTING)
    machine.transition(ImportOperationState.EXPORTING)
    machine.transition(ImportOperationState.FINALIZING)
    machine.transition(ImportOperationState.COMPLETED)

    assertEquals(ImportOperationState.COMPLETED, machine.state)
  }

  @Test
  fun `rejects skipped and post-terminal transitions`() {
    val machine = ImportStateMachine()
    machine.transition(ImportOperationState.INSPECTING)

    assertThrows(IllegalStateException::class.java) {
      machine.transition(ImportOperationState.FINALIZING)
    }

    machine.cancel()
    assertEquals(ImportOperationState.CANCELLED, machine.state)
    assertThrows(IllegalStateException::class.java) {
      machine.transition(ImportOperationState.EXPORTING)
    }
  }

  @Test
  fun `failure and cancellation are idempotent terminal states`() {
    val failed = ImportStateMachine().also {
      it.transition(ImportOperationState.INSPECTING)
      it.fail()
      it.fail()
    }
    val cancelled = ImportStateMachine().also {
      it.transition(ImportOperationState.INSPECTING)
      it.cancel()
      it.cancel()
    }

    assertEquals(ImportOperationState.FAILED, failed.state)
    assertEquals(ImportOperationState.CANCELLED, cancelled.state)
  }
}
