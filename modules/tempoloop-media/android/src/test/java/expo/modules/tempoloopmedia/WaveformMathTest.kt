package expo.modules.tempoloopmedia

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WaveformMathTest {
  @Test
  fun `maps presentation timestamps to clamped bins`() {
    assertEquals(0, WaveformMath.binIndex(-10L, 1_000L, 4))
    assertEquals(0, WaveformMath.binIndex(0L, 1_000L, 4))
    assertEquals(1, WaveformMath.binIndex(250L, 1_000L, 4))
    assertEquals(3, WaveformMath.binIndex(999L, 1_000L, 4))
    assertEquals(3, WaveformMath.binIndex(1_000L, 1_000L, 4))
    assertEquals(3, WaveformMath.binIndex(10_000L, 1_000L, 4))
  }

  @Test
  fun `fills edge gaps from nearest bin and interior gaps by interpolation`() {
    val result = WaveformMath.fillEmptyBins(
      values = doubleArrayOf(0.0, 0.2, 0.0, 0.0, 0.8, 0.0),
      populated = booleanArrayOf(false, true, false, false, true, false)
    )

    assertArrayEquals(
      doubleArrayOf(0.2, 0.2, 0.4, 0.6, 0.8, 0.8),
      result,
      1e-9
    )
  }

  @Test
  fun `normalizes against non-silent p95 and clamps outliers`() {
    val values = DoubleArray(21) { index ->
      when (index) {
        0 -> 0.0
        20 -> 100.0
        else -> index.toDouble()
      }
    }

    val result = WaveformMath.normalizeAtPercentile(values)

    // Twenty non-zero entries use nearest-rank index 18 (value 19).
    assertEquals(0.0, result[0], 0.0)
    assertEquals(10.0 / 19.0, result[10], 1e-9)
    assertEquals(1.0, result[19], 0.0)
    assertEquals(1.0, result[20], 0.0)
    assertTrue(result.all { it.isFinite() && it in 0.0..1.0 })
  }

  @Test
  fun `silent input returns exact requested zero bins`() {
    val accumulator = WaveformAccumulator(durationUs = 1_000_000L, binCount = 8)
    repeat(10) { index -> accumulator.add(index * 100_000L, 0.0) }

    assertEquals(List(8) { 0.0 }, accumulator.finish())
  }

  @Test
  fun `accumulator returns exact finite bounded bin count`() {
    val accumulator = WaveformAccumulator(durationUs = 1_000L, binCount = 4)
    accumulator.add(0L, 0.25)
    accumulator.add(100L, 0.75)
    accumulator.add(900L, Double.NaN)
    accumulator.add(999L, 2.0)

    val result = accumulator.finish()

    assertEquals(4, result.size)
    assertTrue(result.all { it.isFinite() && it in 0.0..1.0 })
    assertEquals(1.0, result.last(), 0.0)
  }
}
