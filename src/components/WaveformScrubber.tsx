import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { COPY } from '@/constants/copy';
import { colors, radii, spacing } from '@/constants/theme';
import {
  clampWaveformPosition,
  createWaveformPathData,
  createWaveformViewport,
  downsampleWaveform,
  followWaveformPlayhead,
  getWaveformRenderBarCount,
  panWaveformViewportFromOverview,
  sliceWaveformForViewport,
  waveformPositionFromViewportX,
  zoomWaveformViewport,
  type WaveformViewport,
} from '@/domain/waveform';
import { formatDuration } from '@/utils/time';

export const WAVEFORM_HEIGHT = 72;
export const WAVEFORM_OVERVIEW_HEIGHT = 22;
const WAVEFORM_VERTICAL_PADDING = 8;
const OVERVIEW_VERTICAL_PADDING = 3;
const PLAYHEAD_WIDTH = 2;
const ACCESSIBILITY_SEEK_STEP_MS = 1_000;
const OVERVIEW_PAN_PAGE_RATIO = 0.8;
export const WAVEFORM_DRAG_SEEK_THROTTLE_MS = 80;

const ACCESSIBILITY_ACTIONS = [
  { name: 'decrement' as const, label: '-1 second' },
  { name: 'increment' as const, label: '+1 second' },
];

const OVERVIEW_ACCESSIBILITY_ACTIONS = [
  { name: 'decrement' as const, label: 'Show earlier audio' },
  { name: 'increment' as const, label: 'Show later audio' },
];

export interface WaveformScrubberProps {
  readonly amplitudes: readonly number[];
  readonly durationMs: number;
  readonly currentTimeMs: number;
  readonly disabled?: boolean;
  readonly isPlaying?: boolean;
  readonly mirrored?: boolean;
  readonly onScrubCancel?: () => void;
  readonly onScrubStart?: () => void;
  readonly onSeekPreview?: (positionMs: number) => void;
  readonly onSeekRequested: (positionMs: number) => void;
}

type GestureMode = 'idle' | 'pinch' | 'scrub';

interface PinchState {
  readonly distance: number;
  readonly focalRatio: number;
  readonly viewport: WaveformViewport;
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

function eventLocationX(event: GestureResponderEvent): number | null {
  const locationX = event.nativeEvent.locationX;
  return Number.isFinite(locationX) ? locationX : null;
}

function touchPoints(event: GestureResponderEvent) {
  return Array.from(event.nativeEvent.touches ?? []);
}

function pinchGeometry(
  event: GestureResponderEvent,
  measuredWidth: number,
): { distance: number; focalRatio: number } | null {
  const touches = touchPoints(event);
  const first = touches[0];
  const second = touches[1];
  if (first === undefined || second === undefined || measuredWidth <= 0) {
    return null;
  }

  const deltaX = second.pageX - first.pageX;
  const deltaY = second.pageY - first.pageY;
  const distance = Math.hypot(deltaX, deltaY);
  const focalX = (first.locationX + second.locationX) / 2;
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(focalX)) {
    return null;
  }

  return {
    distance,
    focalRatio: Math.min(1, Math.max(0, focalX / measuredWidth)),
  };
}

function viewportsEqual(left: WaveformViewport, right: WaveformViewport): boolean {
  return left.startMs === right.startMs && left.durationMs === right.durationMs;
}

interface WaveformPanResponderOptions {
  readonly commitViewport: (viewport: WaveformViewport) => void;
  readonly disabled: boolean;
  readonly finishSeek: (positionMs: number) => void;
  readonly measuredWidth: number;
  readonly normalizedDurationMs: number;
  readonly onManualNavigation: () => void;
  readonly onScrubCancel?: () => void;
  readonly onScrubStart?: () => void;
  readonly onSeekPreview?: (positionMs: number) => void;
  readonly positionForEvent: (event: GestureResponderEvent) => number | null;
  readonly setPreviewPosition: (positionMs: number | null) => void;
  readonly viewport: WaveformViewport;
}

function createWaveformPanResponder({
  commitViewport,
  disabled,
  finishSeek,
  measuredWidth,
  normalizedDurationMs,
  onManualNavigation,
  onScrubCancel,
  onScrubStart,
  onSeekPreview,
  positionForEvent,
  setPreviewPosition,
  viewport,
}: WaveformPanResponderOptions) {
  let gestureMode: GestureMode = 'idle';
  let lastPreviewSeekAt: number | null = null;
  let pinchState: PinchState | null = null;

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

  const beginPinch = (event: GestureResponderEvent): boolean => {
    const geometry = pinchGeometry(event, measuredWidth);
    if (geometry === null) {
      return false;
    }
    gestureMode = 'pinch';
    pinchState = {
      distance: geometry.distance,
      focalRatio: geometry.focalRatio,
      viewport,
    };
    onManualNavigation();
    setPreviewPosition(null);
    return true;
  };

  return PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => {
      lastPreviewSeekAt = null;
      if (touchPoints(event).length >= 2 && beginPinch(event)) {
        return;
      }
      gestureMode = 'scrub';
      onScrubStart?.();
      updatePreview(event, false);
    },
    onPanResponderMove: (event) => {
      if (touchPoints(event).length >= 2) {
        if (gestureMode !== 'pinch') {
          if (gestureMode === 'scrub') {
            onScrubCancel?.();
          }
          beginPinch(event);
          return;
        }

        const geometry = pinchGeometry(event, measuredWidth);
        if (geometry !== null && pinchState !== null) {
          commitViewport(
            zoomWaveformViewport(
              pinchState.viewport,
              geometry.distance / pinchState.distance,
              pinchState.focalRatio,
              normalizedDurationMs,
            ),
          );
        }
        return;
      }

      if (gestureMode === 'scrub') {
        updatePreview(event, true);
      }
    },
    onPanResponderRelease: (event) => {
      if (gestureMode === 'scrub') {
        const requestedPositionMs = positionForEvent(event);
        setPreviewPosition(null);
        if (requestedPositionMs !== null) {
          finishSeek(requestedPositionMs);
        }
      }
      gestureMode = 'idle';
      pinchState = null;
      lastPreviewSeekAt = null;
    },
    onPanResponderTerminate: () => {
      if (gestureMode === 'scrub') {
        onScrubCancel?.();
      }
      gestureMode = 'idle';
      pinchState = null;
      lastPreviewSeekAt = null;
      setPreviewPosition(null);
    },
    onPanResponderTerminationRequest: () => true,
  });
}

interface OverviewPanResponderOptions {
  readonly disabled: boolean;
  readonly normalizedDurationMs: number;
  readonly onPan: (locationX: number, dragOffsetRatio: number) => void;
  readonly overviewWidth: number;
  readonly viewport: WaveformViewport;
}

function createOverviewPanResponder({
  disabled,
  normalizedDurationMs,
  onPan,
  overviewWidth,
  viewport,
}: OverviewPanResponderOptions) {
  let dragOffsetRatio = 0.5;

  const pan = (event: GestureResponderEvent): void => {
    const locationX = eventLocationX(event);
    if (!disabled && locationX !== null) {
      onPan(locationX, dragOffsetRatio);
    }
  };

  return PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => {
      const locationX = eventLocationX(event);
      if (locationX === null || normalizedDurationMs === 0) {
        return;
      }
      const windowStartX = (viewport.startMs / normalizedDurationMs) * overviewWidth;
      const windowWidth = (viewport.durationMs / normalizedDurationMs) * overviewWidth;
      dragOffsetRatio =
        locationX >= windowStartX && locationX <= windowStartX + windowWidth
          ? (locationX - windowStartX) / windowWidth
          : 0.5;
      pan(event);
    },
    onPanResponderMove: pan,
    onPanResponderRelease: pan,
    onPanResponderTerminationRequest: () => true,
  });
}

export function WaveformScrubber(props: WaveformScrubberProps) {
  return <WaveformScrubberContent key={usableDuration(props.durationMs)} {...props} />;
}

function WaveformScrubberContent({
  amplitudes,
  durationMs,
  currentTimeMs,
  disabled = false,
  isPlaying = false,
  mirrored = true,
  onScrubCancel,
  onScrubStart,
  onSeekPreview,
  onSeekRequested,
}: WaveformScrubberProps) {
  const normalizedDurationMs = usableDuration(durationMs);
  const normalizedCurrentTimeMs = safeCurrentTime(currentTimeMs, normalizedDurationMs);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [overviewWidth, setOverviewWidth] = useState(0);
  const [previewPositionMs, setPreviewPositionMs] = useState<number | null>(null);
  const [viewport, setViewport] = useState<WaveformViewport>(() =>
    createWaveformViewport(normalizedDurationMs),
  );
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const wasPlayingRef = useRef(isPlaying);

  const commitViewport = useCallback(
    (next: WaveformViewport | ((current: WaveformViewport) => WaveformViewport)) => {
      setViewport((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        return viewportsEqual(current, resolved) ? current : resolved;
      });
    },
    [],
  );

  const enablePlayheadFollow = useCallback(() => {
    setFollowPlayhead(true);
  }, []);

  const disablePlayheadFollow = useCallback(() => {
    setFollowPlayhead(false);
  }, []);

  useEffect(() => {
    const playbackJustStarted = isPlaying && !wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    if (playbackJustStarted) {
      enablePlayheadFollow();
    }

    if (isPlaying && (followPlayhead || playbackJustStarted)) {
      commitViewport((current) =>
        followWaveformPlayhead(current, normalizedCurrentTimeMs, normalizedDurationMs),
      );
    }
  }, [
    commitViewport,
    enablePlayheadFollow,
    followPlayhead,
    isPlaying,
    normalizedCurrentTimeMs,
    normalizedDurationMs,
  ]);

  const interactionDisabled = disabled || normalizedDurationMs === 0 || measuredWidth === 0;
  const overviewDisabled =
    disabled ||
    normalizedDurationMs === 0 ||
    overviewWidth === 0 ||
    viewport.durationMs >= normalizedDurationMs;

  const visibleAmplitudes = useMemo(() => {
    try {
      return sliceWaveformForViewport(amplitudes, viewport, normalizedDurationMs);
    } catch {
      return [];
    }
  }, [amplitudes, normalizedDurationMs, viewport]);

  const renderAmplitudes = useMemo(() => {
    const renderBarCount = getWaveformRenderBarCount(measuredWidth, visibleAmplitudes.length);
    try {
      return downsampleWaveform(visibleAmplitudes, renderBarCount, 'maximum');
    } catch {
      return [];
    }
  }, [measuredWidth, visibleAmplitudes]);

  const overviewAmplitudes = useMemo(() => {
    const renderBarCount = getWaveformRenderBarCount(overviewWidth, amplitudes.length);
    try {
      return downsampleWaveform(amplitudes, renderBarCount, 'maximum');
    } catch {
      return [];
    }
  }, [amplitudes, overviewWidth]);

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

  const overviewPaths = useMemo(() => {
    if (overviewAmplitudes.length === 0 || overviewWidth <= 0) {
      return { upper: '', lower: '' };
    }
    try {
      return createWaveformPathData(
        overviewAmplitudes,
        overviewWidth,
        WAVEFORM_OVERVIEW_HEIGHT,
        OVERVIEW_VERTICAL_PADDING,
        true,
      );
    } catch {
      return { upper: '', lower: '' };
    }
  }, [overviewAmplitudes, overviewWidth]);

  const displayedPositionMs =
    previewPositionMs === null ? normalizedCurrentTimeMs : previewPositionMs;

  const positionForEvent = useCallback(
    (event: GestureResponderEvent): number | null => {
      if (interactionDisabled) {
        return null;
      }
      const locationX = eventLocationX(event);
      if (locationX === null) {
        return null;
      }
      return waveformPositionFromViewportX(
        locationX,
        measuredWidth,
        viewport,
        normalizedDurationMs,
      );
    },
    [interactionDisabled, measuredWidth, normalizedDurationMs, viewport],
  );

  const finishSeek = useCallback(
    (positionMs: number) => {
      enablePlayheadFollow();
      commitViewport((current) =>
        followWaveformPlayhead(current, positionMs, normalizedDurationMs),
      );
      onSeekRequested(positionMs);
    },
    [commitViewport, enablePlayheadFollow, normalizedDurationMs, onSeekRequested],
  );

  const waveformPanResponder = useMemo(
    () =>
      createWaveformPanResponder({
        commitViewport,
        disabled: interactionDisabled,
        finishSeek,
        measuredWidth,
        normalizedDurationMs,
        onManualNavigation: disablePlayheadFollow,
        onScrubCancel,
        onScrubStart,
        onSeekPreview,
        positionForEvent,
        setPreviewPosition: setPreviewPositionMs,
        viewport,
      }),
    [
      commitViewport,
      finishSeek,
      disablePlayheadFollow,
      interactionDisabled,
      measuredWidth,
      normalizedDurationMs,
      onScrubCancel,
      onScrubStart,
      onSeekPreview,
      positionForEvent,
      viewport,
    ],
  );

  const panOverview = useCallback(
    (locationX: number, dragOffsetRatio: number) => {
      disablePlayheadFollow();
      commitViewport(
        panWaveformViewportFromOverview(
          locationX,
          overviewWidth,
          dragOffsetRatio,
          viewport.durationMs,
          normalizedDurationMs,
        ),
      );
    },
    [
      commitViewport,
      disablePlayheadFollow,
      normalizedDurationMs,
      overviewWidth,
      viewport.durationMs,
    ],
  );

  const overviewPanResponder = useMemo(
    () =>
      createOverviewPanResponder({
        disabled: overviewDisabled,
        normalizedDurationMs,
        onPan: panOverview,
        overviewWidth,
        viewport,
      }),
    [normalizedDurationMs, overviewDisabled, overviewWidth, panOverview, viewport],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setMeasuredWidth(Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 0);
  }, []);

  const handleOverviewLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setOverviewWidth(Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 0);
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
      finishSeek(
        clampWaveformPosition(
          normalizedCurrentTimeMs + direction * ACCESSIBILITY_SEEK_STEP_MS,
          normalizedDurationMs,
        ),
      );
    },
    [finishSeek, interactionDisabled, normalizedCurrentTimeMs, normalizedDurationMs, onScrubStart],
  );

  const handleOverviewAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (overviewDisabled) {
        return;
      }
      if (
        event.nativeEvent.actionName !== 'increment' &&
        event.nativeEvent.actionName !== 'decrement'
      ) {
        return;
      }
      const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
      disablePlayheadFollow();
      commitViewport((current) =>
        panWaveformViewportFromOverview(
          ((current.startMs + current.durationMs * (0.5 + direction * OVERVIEW_PAN_PAGE_RATIO)) /
            normalizedDurationMs) *
            overviewWidth,
          overviewWidth,
          0.5,
          current.durationMs,
          normalizedDurationMs,
        ),
      );
    },
    [commitViewport, disablePlayheadFollow, normalizedDurationMs, overviewDisabled, overviewWidth],
  );

  const viewportEndMs = viewport.startMs + viewport.durationMs;
  const playheadIsVisible =
    displayedPositionMs >= viewport.startMs && displayedPositionMs <= viewportEndMs;
  const playheadX =
    viewport.durationMs === 0
      ? 0
      : ((displayedPositionMs - viewport.startMs) / viewport.durationMs) * measuredWidth;
  const overviewPlayheadX =
    normalizedDurationMs === 0
      ? 0
      : (normalizedCurrentTimeMs / normalizedDurationMs) * overviewWidth;
  const overviewWindowX =
    normalizedDurationMs === 0 ? 0 : (viewport.startMs / normalizedDurationMs) * overviewWidth;
  const overviewWindowWidth =
    normalizedDurationMs === 0 ? 0 : (viewport.durationMs / normalizedDurationMs) * overviewWidth;

  return (
    <View style={styles.wrapper}>
      <View
        accessible
        accessibilityActions={ACCESSIBILITY_ACTIONS}
        accessibilityLabel={COPY.segmentEditor.waveformAccessibilityLabel(
          formatDuration(displayedPositionMs),
          formatDuration(normalizedDurationMs),
          formatDuration(viewport.startMs),
          formatDuration(viewportEndMs),
        )}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: interactionDisabled }}
        accessibilityValue={{ min: 0, max: normalizedDurationMs, now: displayedPositionMs }}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleLayout}
        style={[styles.waveform, interactionDisabled && styles.disabledContainer]}
        testID="waveform-scrubber"
        {...waveformPanResponder.panHandlers}
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
            <Path d={paths.upper} fill={colors.waveform} testID="waveform-upper-path" />
          ) : null}
          {paths.lower !== null && paths.lower.length > 0 ? (
            <Path d={paths.lower} fill={colors.waveform} testID="waveform-lower-path" />
          ) : null}
          {playheadIsVisible ? (
            <Line
              stroke={colors.accent}
              strokeWidth={PLAYHEAD_WIDTH}
              testID="waveform-playhead"
              x1={playheadX}
              x2={playheadX}
              y1={0}
              y2={WAVEFORM_HEIGHT}
            />
          ) : null}
        </Svg>
      </View>

      <View
        accessible
        accessibilityActions={OVERVIEW_ACCESSIBILITY_ACTIONS}
        accessibilityLabel={COPY.segmentEditor.waveformOverviewAccessibilityLabel(
          formatDuration(viewport.startMs),
          formatDuration(viewportEndMs),
        )}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: overviewDisabled }}
        accessibilityValue={{ min: 0, max: normalizedDurationMs, now: viewport.startMs }}
        onAccessibilityAction={handleOverviewAccessibilityAction}
        onLayout={handleOverviewLayout}
        style={[styles.overview, overviewDisabled && styles.disabledOverview]}
        testID="waveform-overview"
        {...overviewPanResponder.panHandlers}
      >
        <Svg
          accessibilityElementsHidden
          height={WAVEFORM_OVERVIEW_HEIGHT}
          importantForAccessibility="no-hide-descendants"
          width={overviewWidth}
        >
          {overviewPaths.upper.length > 0 ? (
            <Path d={overviewPaths.upper} fill={colors.waveformOverview} />
          ) : null}
          {overviewPaths.lower !== null && overviewPaths.lower.length > 0 ? (
            <Path d={overviewPaths.lower} fill={colors.waveformOverview} />
          ) : null}
          <Rect
            fill={colors.accentTranslucent}
            height={WAVEFORM_OVERVIEW_HEIGHT}
            stroke={colors.accent}
            strokeWidth={1}
            testID="waveform-overview-window"
            width={overviewWindowWidth}
            x={overviewWindowX}
            y={0}
          />
          <Line
            stroke={colors.focus}
            strokeWidth={1}
            testID="waveform-overview-playhead"
            x1={overviewPlayheadX}
            x2={overviewPlayheadX}
            y1={0}
            y2={WAVEFORM_OVERVIEW_HEIGHT}
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
    width: '100%',
  },
  waveform: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: WAVEFORM_HEIGHT,
    overflow: 'hidden',
    width: '100%',
  },
  overview: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    height: WAVEFORM_OVERVIEW_HEIGHT,
    overflow: 'hidden',
    width: '100%',
  },
  disabledContainer: {
    backgroundColor: colors.disabledBackground,
  },
  disabledOverview: {
    opacity: 0.72,
  },
});
