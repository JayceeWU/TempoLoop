import { useCallback, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { colors, radii } from '@/constants/theme';
import {
  clampWaveformPosition,
  createWaveformPathData,
  downsampleWaveform,
  getWaveformRenderBarCount,
  waveformPositionFromX,
} from '@/domain/waveform';
import { formatDuration } from '@/utils/time';

const WAVEFORM_HEIGHT = 112;
const WAVEFORM_VERTICAL_PADDING = 12;
const PLAYHEAD_WIDTH = 2;
const ACCESSIBILITY_SEEK_STEP_MS = 1_000;
export const WAVEFORM_DRAG_SEEK_THROTTLE_MS = 80;

const ACCESSIBILITY_ACTIONS = [
  { name: 'decrement' as const, label: '-1 second' },
  { name: 'increment' as const, label: '+1 second' },
];

export interface WaveformScrubberProps {
  readonly amplitudes: readonly number[];
  readonly durationMs: number;
  readonly currentTimeMs: number;
  readonly disabled?: boolean;
  readonly mirrored?: boolean;
  readonly onScrubCancel?: () => void;
  readonly onScrubStart?: () => void;
  readonly onSeekPreview?: (positionMs: number) => void;
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

interface ScrubberPanResponderOptions {
  readonly disabled: boolean;
  readonly positionForEvent: (event: GestureResponderEvent) => number | null;
  readonly setPreviewPosition: (positionMs: number | null) => void;
  readonly onScrubCancel?: () => void;
  readonly onScrubStart?: () => void;
  readonly onSeekPreview?: (positionMs: number) => void;
  readonly onSeekRequested: (positionMs: number) => void;
}

function createScrubberPanResponder({
  disabled,
  positionForEvent,
  setPreviewPosition,
  onScrubCancel,
  onScrubStart,
  onSeekPreview,
  onSeekRequested,
}: ScrubberPanResponderOptions) {
  let lastPreviewSeekAt: number | null = null;

  const updatePreview = (event: GestureResponderEvent, requestNativeSeek: boolean): void => {
    const nextPositionMs = positionForEvent(event);
    if (nextPositionMs === null) {
      return;
    }

    setPreviewPosition(nextPositionMs);
    if (!requestNativeSeek || onSeekPreview === undefined) {
      return;
    }

    const now = Date.now();
    if (lastPreviewSeekAt === null || now - lastPreviewSeekAt >= WAVEFORM_DRAG_SEEK_THROTTLE_MS) {
      lastPreviewSeekAt = now;
      onSeekPreview(nextPositionMs);
    }
  };

  return PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => {
      lastPreviewSeekAt = null;
      onScrubStart?.();
      updatePreview(event, false);
    },
    onPanResponderMove: (event) => updatePreview(event, true),
    onPanResponderRelease: (event) => {
      const requestedPositionMs = positionForEvent(event);
      lastPreviewSeekAt = null;
      setPreviewPosition(null);
      if (requestedPositionMs !== null) {
        onSeekRequested(requestedPositionMs);
      }
    },
    onPanResponderTerminate: () => {
      lastPreviewSeekAt = null;
      setPreviewPosition(null);
      onScrubCancel?.();
    },
    onPanResponderTerminationRequest: () => true,
  });
}

export function WaveformScrubber({
  amplitudes,
  durationMs,
  currentTimeMs,
  disabled = false,
  mirrored = true,
  onScrubCancel,
  onScrubStart,
  onSeekPreview,
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

  const paths = useMemo(() => {
    if (renderAmplitudes.length === 0 || measuredWidth <= 0) {
      return { upper: '', lower: mirrored ? '' : null };
    }

    try {
      return createWaveformPathData(
        renderAmplitudes,
        measuredWidth,
        WAVEFORM_HEIGHT,
        WAVEFORM_VERTICAL_PADDING,
        mirrored,
      );
    } catch {
      return { upper: '', lower: mirrored ? '' : null };
    }
  }, [measuredWidth, mirrored, renderAmplitudes]);

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

  const panResponder = useMemo(
    () =>
      createScrubberPanResponder({
        disabled: interactionDisabled,
        positionForEvent,
        setPreviewPosition: setPreviewPositionMs,
        onScrubCancel,
        onScrubStart,
        onSeekPreview,
        onSeekRequested,
      }),
    [
      interactionDisabled,
      onScrubCancel,
      onScrubStart,
      onSeekPreview,
      onSeekRequested,
      positionForEvent,
    ],
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
      onScrubStart?.();
      onSeekRequested(
        clampWaveformPosition(
          normalizedCurrentTimeMs + direction * ACCESSIBILITY_SEEK_STEP_MS,
          normalizedDurationMs,
        ),
      );
    },
    [
      interactionDisabled,
      normalizedCurrentTimeMs,
      normalizedDurationMs,
      onScrubStart,
      onSeekRequested,
    ],
  );

  const playheadX =
    normalizedDurationMs === 0 ? 0 : (displayedPositionMs / normalizedDurationMs) * measuredWidth;
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
        {paths.upper.length > 0 ? (
          <Path d={paths.upper} fill={colors.textMuted} testID="waveform-upper-path" />
        ) : null}
        {paths.lower !== null && paths.lower.length > 0 ? (
          <Path d={paths.lower} fill={colors.textMuted} testID="waveform-lower-path" />
        ) : null}
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
