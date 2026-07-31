import { useCallback, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { colors, radii } from '@/constants/theme';
import {
  clampWaveformPosition,
  downsampleWaveform,
  getWaveformRenderBarCount,
  waveformPositionFromX,
} from '@/domain/waveform';
import { formatDuration } from '@/utils/time';

const WAVEFORM_HEIGHT = 112;
const WAVEFORM_VERTICAL_PADDING = 12;
const MINIMUM_BAR_HEIGHT = 2;
const PLAYHEAD_WIDTH = 2;
const ACCESSIBILITY_SEEK_STEP_MS = 1_000;

const ACCESSIBILITY_ACTIONS = [
  { name: 'decrement' as const, label: '-1 second' },
  { name: 'increment' as const, label: '+1 second' },
];

export interface WaveformScrubberProps {
  readonly amplitudes: readonly number[];
  readonly durationMs: number;
  readonly currentTimeMs: number;
  readonly disabled?: boolean;
  readonly onSeekRequested: (positionMs: number) => void;
}

function usableDuration(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;
}

function safeCurrentTime(currentTimeMs: number, durationMs: number): number {
  if (!Number.isFinite(currentTimeMs)) {
    return 0;
  }

  return clampWaveformPosition(currentTimeMs, durationMs);
}

export function WaveformScrubber({
  amplitudes,
  durationMs,
  currentTimeMs,
  disabled = false,
  onSeekRequested,
}: WaveformScrubberProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [previewPositionMs, setPreviewPositionMs] = useState<number | null>(null);
  const normalizedDurationMs = usableDuration(durationMs);
  const normalizedCurrentTimeMs = safeCurrentTime(currentTimeMs, normalizedDurationMs);
  const interactionDisabled = disabled || normalizedDurationMs === 0 || measuredWidth === 0;

  const renderAmplitudes = useMemo(() => {
    const renderBarCount = getWaveformRenderBarCount(measuredWidth, amplitudes.length);

    try {
      return downsampleWaveform(amplitudes, renderBarCount, 'maximum');
    } catch {
      return [];
    }
  }, [amplitudes, measuredWidth]);

  const displayedPositionMs =
    previewPositionMs === null ? normalizedCurrentTimeMs : previewPositionMs;

  const positionForEvent = useCallback(
    (event: GestureResponderEvent): number | null => {
      if (interactionDisabled) {
        return null;
      }

      const locationX = event.nativeEvent.locationX;
      if (!Number.isFinite(locationX)) {
        return null;
      }

      return waveformPositionFromX(locationX, measuredWidth, normalizedDurationMs);
    },
    [interactionDisabled, measuredWidth, normalizedDurationMs],
  );

  const updatePreview = useCallback(
    (event: GestureResponderEvent) => {
      const nextPositionMs = positionForEvent(event);
      if (nextPositionMs === null) {
        return;
      }

      setPreviewPositionMs(nextPositionMs);
    },
    [positionForEvent],
  );

  const finishGesture = useCallback(
    (event: GestureResponderEvent) => {
      const requestedPositionMs = positionForEvent(event);
      setPreviewPositionMs(null);

      if (requestedPositionMs !== null && !interactionDisabled) {
        onSeekRequested(requestedPositionMs);
      }
    },
    [interactionDisabled, onSeekRequested, positionForEvent],
  );

  const cancelGesture = useCallback(() => {
    setPreviewPositionMs(null);
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !interactionDisabled,
        onMoveShouldSetPanResponder: () => !interactionDisabled,
        onPanResponderGrant: updatePreview,
        onPanResponderMove: updatePreview,
        onPanResponderRelease: finishGesture,
        onPanResponderTerminate: cancelGesture,
        onPanResponderTerminationRequest: () => true,
      }),
    [cancelGesture, finishGesture, interactionDisabled, updatePreview],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setMeasuredWidth(Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 0);
  }, []);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (interactionDisabled) {
        return;
      }

      if (
        event.nativeEvent.actionName !== 'increment' &&
        event.nativeEvent.actionName !== 'decrement'
      ) {
        return;
      }

      const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
      onSeekRequested(
        clampWaveformPosition(
          normalizedCurrentTimeMs + direction * ACCESSIBILITY_SEEK_STEP_MS,
          normalizedDurationMs,
        ),
      );
    },
    [interactionDisabled, normalizedCurrentTimeMs, normalizedDurationMs, onSeekRequested],
  );

  const playheadX =
    normalizedDurationMs === 0 ? 0 : (displayedPositionMs / normalizedDurationMs) * measuredWidth;
  const barSlotWidth = renderAmplitudes.length === 0 ? 0 : measuredWidth / renderAmplitudes.length;
  const barWidth = Math.max(1, barSlotWidth - 1);
  const accessibilityLabel =
    `Waveform position ${formatDuration(displayedPositionMs)} ` +
    `of ${formatDuration(normalizedDurationMs)}`;

  return (
    <View
      accessible
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled: interactionDisabled }}
      accessibilityValue={{
        min: 0,
        max: normalizedDurationMs,
        now: displayedPositionMs,
      }}
      onAccessibilityAction={handleAccessibilityAction}
      onLayout={handleLayout}
      style={[styles.container, interactionDisabled && styles.disabledContainer]}
      testID="waveform-scrubber"
      {...panResponder.panHandlers}
    >
      <Svg
        accessibilityElementsHidden
        height={WAVEFORM_HEIGHT}
        importantForAccessibility="no-hide-descendants"
        width={measuredWidth}
      >
        <Line
          stroke={colors.border}
          strokeWidth={StyleSheet.hairlineWidth}
          x1={0}
          x2={measuredWidth}
          y1={WAVEFORM_HEIGHT / 2}
          y2={WAVEFORM_HEIGHT / 2}
        />
        {renderAmplitudes.map((amplitude, index) => {
          const availableHeight = WAVEFORM_HEIGHT - WAVEFORM_VERTICAL_PADDING * 2;
          const height = Math.max(MINIMUM_BAR_HEIGHT, amplitude * availableHeight);
          const x = index * barSlotWidth + (barSlotWidth - barWidth) / 2;

          return (
            <Rect
              fill={colors.textMuted}
              height={height}
              key={index}
              rx={barWidth / 2}
              testID={`waveform-bar-${index}`}
              width={barWidth}
              x={x}
              y={(WAVEFORM_HEIGHT - height) / 2}
            />
          );
        })}
        <Line
          stroke={colors.accent}
          strokeWidth={PLAYHEAD_WIDTH}
          testID="waveform-playhead"
          x1={playheadX}
          x2={playheadX}
          y1={0}
          y2={WAVEFORM_HEIGHT}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: WAVEFORM_HEIGHT,
    overflow: 'hidden',
    width: '100%',
  },
  disabledContainer: {
    backgroundColor: colors.disabledBackground,
  },
});
