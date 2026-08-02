package expo.modules.tempoloopmedia

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.sqrt

/**
 * Pure waveform reduction helpers. The decoder owns PCM buffers; this class
 * retains only one sum and sample count per requested waveform bin.
 */
internal class WaveformAccumulator(
  private val durationUs: Long,
  val binCount: Int,
  private val maximumSamplesPerBin: Int = Int.MAX_VALUE
) {
  private val sumOfSquares = DoubleArray(binCount)
  private val sampleCounts = LongArray(binCount)

  init {
    require(durationUs > 0L) { "durationUs must be positive" }
    require(binCount > 0) { "binCount must be positive" }
  }

  fun addEnergy(timeUs: Long, energy: Double): Boolean {
    if (!energy.isFinite()) return false
    val index = WaveformMath.binIndex(timeUs, durationUs, binCount)
    if (sampleCounts[index] >= maximumSamplesPerBin.toLong()) return false
    sumOfSquares[index] += energy.coerceIn(0.0, 1.0)
    sampleCounts[index] += 1L
    return true
  }

  fun add(timeUs: Long, amplitude: Double) {
    addEnergy(timeUs, amplitude * amplitude)
  }

  fun sampledFrameCount(): Long = sampleCounts.sum()

  fun finish(): List<Double> {
    val rmsBins = DoubleArray(binCount)
    val populated = BooleanArray(binCount)

    for (index in 0 until binCount) {
      val count = sampleCounts[index]
      if (count > 0L) {
        rmsBins[index] = sqrt(sumOfSquares[index] / count.toDouble())
        populated[index] = true
      }
    }

    val filled = WaveformMath.fillEmptyBins(rmsBins, populated)
    return WaveformMath.normalizeAtPercentile(filled).toList()
  }
}

internal object WaveformMath {
  private const val NORMALIZATION_PERCENTILE = 0.95
  private const val SILENCE_EPSILON = 1e-12

  fun binIndex(timeUs: Long, durationUs: Long, binCount: Int): Int {
    require(durationUs > 0L) { "durationUs must be positive" }
    require(binCount > 0) { "binCount must be positive" }

    val ratio = timeUs.coerceAtLeast(0L).toDouble() / durationUs.toDouble()
    return floor(ratio * binCount.toDouble())
      .toInt()
      .coerceIn(0, binCount - 1)
  }

  /**
   * Fills interior gaps with local linear interpolation and edge gaps with
   * the nearest populated value. A waveform with no decoded samples is silent.
   */
  fun fillEmptyBins(
    values: DoubleArray,
    populated: BooleanArray
  ): DoubleArray {
    require(values.size == populated.size) {
      "values and populated must have the same size"
    }
    if (values.isEmpty()) {
      return DoubleArray(0)
    }

    val sanitized = DoubleArray(values.size) { index ->
      values[index].takeIf(Double::isFinite)?.coerceAtLeast(0.0) ?: 0.0
    }
    val firstPopulated = populated.indexOfFirst { it }
    if (firstPopulated < 0) {
      return DoubleArray(values.size)
    }

    for (index in 0 until firstPopulated) {
      sanitized[index] = sanitized[firstPopulated]
    }

    var leftIndex = firstPopulated
    while (leftIndex < values.lastIndex) {
      var rightIndex = leftIndex + 1
      while (rightIndex <= values.lastIndex && !populated[rightIndex]) {
        rightIndex += 1
      }

      if (rightIndex > values.lastIndex) {
        for (index in (leftIndex + 1)..values.lastIndex) {
          sanitized[index] = sanitized[leftIndex]
        }
        break
      }

      val leftValue = sanitized[leftIndex]
      val rightValue = sanitized[rightIndex]
      val span = (rightIndex - leftIndex).toDouble()
      for (index in (leftIndex + 1) until rightIndex) {
        val fraction = (index - leftIndex).toDouble() / span
        sanitized[index] = leftValue + ((rightValue - leftValue) * fraction)
      }
      leftIndex = rightIndex
    }

    return sanitized
  }

  /**
   * Scales by the nearest-rank 95th percentile of non-silent bins. Ignoring
   * zero bins keeps genuine silent regions at zero instead of making them set
   * the scale for a track with long rests.
   */
  fun normalizeAtPercentile(values: DoubleArray): DoubleArray {
    if (values.isEmpty()) {
      return DoubleArray(0)
    }

    val sanitized = DoubleArray(values.size) { index ->
      values[index]
        .takeIf(Double::isFinite)
        ?.coerceAtLeast(0.0)
        ?: 0.0
    }
    val nonSilent = sanitized
      .filter { it > SILENCE_EPSILON }
      .sorted()

    if (nonSilent.isEmpty()) {
      return DoubleArray(values.size)
    }

    val nearestRank = ceil(NORMALIZATION_PERCENTILE * nonSilent.size.toDouble())
      .toInt()
      .coerceIn(1, nonSilent.size)
    val scale = nonSilent[nearestRank - 1]
    if (!scale.isFinite() || scale <= SILENCE_EPSILON) {
      return DoubleArray(values.size)
    }

    return DoubleArray(sanitized.size) { index ->
      (sanitized[index] / scale)
        .takeIf(Double::isFinite)
        ?.coerceIn(0.0, 1.0)
        ?: 0.0
    }
  }
}
