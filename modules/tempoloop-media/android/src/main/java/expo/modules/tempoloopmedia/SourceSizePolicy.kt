package expo.modules.tempoloopmedia

internal object SourceSizePolicy {
  const val MAX_VIDEO_SOURCE_BYTES = 629_145_600L
  const val MAX_AUDIO_SOURCE_BYTES = 209_715_200L

  // Some document providers use zero as an "unknown" sentinel even though
  // Android's descriptor APIs normally use -1. Only a positive size is
  // reliable enough to skip the bounded import-phase read.
  fun normalizeReportedSize(sizeBytes: Long): Long? = sizeBytes.takeIf { it > 0L }

  fun effectiveLimit(
    sourceKind: SourceMediaKind,
    requestedMaxAudioSourceBytes: Long,
    requestedMaxVideoSourceBytes: Long
  ): Long {
    if (requestedMaxAudioSourceBytes <= 0L || requestedMaxVideoSourceBytes <= 0L) {
      throw mediaError(TempoLoopMediaError.UNKNOWN_NATIVE)
    }
    return when (sourceKind) {
      SourceMediaKind.AUDIO -> minOf(requestedMaxAudioSourceBytes, MAX_AUDIO_SOURCE_BYTES)
      SourceMediaKind.VIDEO -> minOf(requestedMaxVideoSourceBytes, MAX_VIDEO_SOURCE_BYTES)
    }
  }

  fun requireWithinLimit(
    sourceSizeBytes: Long?,
    sourceKind: SourceMediaKind,
    requestedMaxAudioSourceBytes: Long,
    requestedMaxVideoSourceBytes: Long
  ) {
    val limit = effectiveLimit(
      sourceKind,
      requestedMaxAudioSourceBytes,
      requestedMaxVideoSourceBytes
    )
    if (sourceSizeBytes != null && sourceSizeBytes > limit) {
      throw tooLargeError(sourceKind)
    }
  }

  fun tooLargeError(sourceKind: SourceMediaKind): TempoLoopMediaException = mediaError(
    when (sourceKind) {
      SourceMediaKind.AUDIO -> TempoLoopMediaError.AUDIO_TOO_LARGE
      SourceMediaKind.VIDEO -> TempoLoopMediaError.VIDEO_TOO_LARGE
    }
  )
}

internal object ReliableSizeResolver {
  fun resolve(
    querySize: () -> Long?,
    assetDescriptorLength: () -> Long?,
    parcelDescriptorSize: () -> Long?
  ): Long? {
    // Providers occasionally disagree across metadata surfaces. Probe in the
    // contract order, but use the largest positive value so a stale, smaller
    // OpenableColumns value cannot bypass the native source limit.
    val query = SourceSizePolicy.normalizeReportedSize(querySize() ?: -1L)
    val asset = SourceSizePolicy.normalizeReportedSize(assetDescriptorLength() ?: -1L)
    val parcel = SourceSizePolicy.normalizeReportedSize(parcelDescriptorSize() ?: -1L)
    return listOfNotNull(query, asset, parcel).maxOrNull()
  }
}
