package expo.modules.tempoloopmedia

import kotlinx.coroutines.Job

internal fun interface NativeOperationResource {
  fun cancel()

  suspend fun cancelAndAwait() {
    cancel()
  }
}

internal class NativeTaskRegistry {
  private data class ImportTask(
    val operationId: String,
    val job: Job,
    val resources: MutableSet<NativeOperationResource> = linkedSetOf(),
    var cancellationRequested: Boolean = false
  )

  private val lock = Any()
  private val trackedJobs = linkedSetOf<Job>()
  private var activeImport: ImportTask? = null

  fun track(job: Job) {
    synchronized(lock) {
      trackedJobs += job
    }
  }

  fun untrack(job: Job) {
    synchronized(lock) {
      trackedJobs -= job
    }
  }

  fun registerImport(operationId: String, job: Job) {
    if (operationId.isBlank()) {
      throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE)
    }

    synchronized(lock) {
      if (activeImport != null) {
        throw mediaError(TempoLoopMediaError.IMPORT_BUSY)
      }
      activeImport = ImportTask(operationId, job)
      trackedJobs += job
    }
  }

  fun attachResource(operationId: String, resource: NativeOperationResource) {
    val accepted = synchronized(lock) {
      val task = activeImport
      if (
        task == null ||
        task.operationId != operationId ||
        task.cancellationRequested
      ) {
        false
      } else {
        task.resources += resource
        true
      }
    }

    if (!accepted) {
      runCatching(resource::cancel)
      throw mediaError(TempoLoopMediaError.IMPORT_CANCELLED)
    }
  }

  fun detachResource(operationId: String, resource: NativeOperationResource) {
    synchronized(lock) {
      activeImport
        ?.takeIf { it.operationId == operationId }
        ?.resources
        ?.remove(resource)
    }
  }

  suspend fun cancelImport(operationId: String) {
    val cancellation = synchronized(lock) {
      val task = activeImport
      if (
        task == null ||
        task.operationId != operationId ||
        task.cancellationRequested
      ) {
        null
      } else {
        task.cancellationRequested = true
        val resources = task.resources.toList()
        task.resources.clear()
        CancellationWork(task.job, resources)
      }
    } ?: return

    try {
      releaseResourcesAndAwait(cancellation.resources)
    } finally {
      cancellation.job.cancel(ImportCancellationSignal())
    }
  }

  fun isCancellationRequested(operationId: String): Boolean = synchronized(lock) {
    activeImport
      ?.takeIf { it.operationId == operationId }
      ?.cancellationRequested == true
  }

  fun completeImport(operationId: String, job: Job) {
    val resources = synchronized(lock) {
      val task = activeImport
      if (task?.operationId == operationId && task.job === job) {
        val attachedResources = task.resources.toList()
        task.resources.clear()
        activeImport = null
        trackedJobs -= job
        attachedResources
      } else {
        emptyList()
      }
    }
    releaseResources(resources)
  }

  fun cancelAll() {
    val cancellation = synchronized(lock) {
      val task = activeImport
      val resources = task?.resources?.toList().orEmpty()
      task?.resources?.clear()
      val jobs = trackedJobs.toList()
      trackedJobs.clear()
      activeImport = null
      CancellationBatch(jobs, resources)
    }

    releaseResources(cancellation.resources)
    cancellation.jobs.forEach { job ->
      job.cancel(ImportCancellationSignal())
    }
  }

  internal fun hasActiveImport(): Boolean = synchronized(lock) {
    activeImport != null
  }

  private fun releaseResources(resources: Collection<NativeOperationResource>) {
    resources.forEach { resource ->
      runCatching(resource::cancel)
    }
  }

  private suspend fun releaseResourcesAndAwait(
    resources: Collection<NativeOperationResource>
  ) {
    resources.forEach { resource ->
      try {
        resource.cancelAndAwait()
      } catch (_: Throwable) {
        // Import coroutine cancellation still has to proceed; pipeline cleanup
        // owns the partial-file deletion and stable E_IMPORT_CANCELLED result.
      }
    }
  }

  private data class CancellationWork(
    val job: Job,
    val resources: List<NativeOperationResource>
  )

  private data class CancellationBatch(
    val jobs: List<Job>,
    val resources: List<NativeOperationResource>
  )
}
