package expo.modules.tempoloopmedia

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.Enumerable
import expo.modules.kotlin.types.OptimizedRecord

@OptimizedRecord
data class InspectMediaOptions(
  @Field val sourceUri: String,
  @Field val maxAudioSourceBytes: Long,
  @Field val maxVideoSourceBytes: Long
) : Record

@OptimizedRecord
data class PickedMediaSource(
  @Field val uri: String,
  @Field val sizeBytes: Long?,
  @Field val mimeType: String?,
  @Field val fileName: String?
) : Record

enum class SourceMediaKind(val value: String) : Enumerable {
  AUDIO("audio"),
  VIDEO("video")
}

@OptimizedRecord
data class MediaInspection(
  @Field val sourceKind: SourceMediaKind,
  @Field val sourceSizeBytes: Long?,
  @Field val durationMs: Long,
  @Field val audioMimeType: String?,
  @Field val sampleRate: Int?,
  @Field val channelCount: Int?
) : Record

@OptimizedRecord
data class ImportMediaOptions(
  @Field val operationId: String,
  @Field val sourceUri: String,
  @Field val outputAudioUri: String,
  @Field val maxAudioSourceBytes: Long,
  @Field val maxVideoSourceBytes: Long
) : Record

@OptimizedRecord
data class ImportMediaResult(
  @Field val audioUri: String,
  @Field val audioSizeBytes: Long,
  @Field val durationMs: Long
) : Record

@OptimizedRecord
data class GenerateWaveformOptions(
  @Field val operationId: String,
  @Field val audioUri: String,
  @Field val durationMs: Long,
  @Field val waveformBinCount: Int
) : Record

@OptimizedRecord
data class GenerateWaveformResult(
  @Field val durationMs: Long,
  @Field val sampleCount: Int,
  @Field val samples: List<Double>,
  @Field val decodedFrameCount: Long,
  @Field val sampledFrameCount: Long,
  @Field val elapsedMs: Long
) : Record

enum class ImportStage(val value: String) : Enumerable {
  INSPECTING("inspecting"),
  EXPORTING("exporting"),
  FINALIZING("finalizing")
}

@OptimizedRecord
data class ImportProgressEvent(
  @Field val operationId: String,
  @Field val stage: ImportStage,
  @Field val stageProgress: Double?,
  @Field val overallProgress: Double?
) : Record

@OptimizedRecord
data class WaveformProgressEvent(
  @Field val operationId: String,
  @Field val progress: Double
) : Record
