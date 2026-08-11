import { Stack, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { SegmentTimeRow } from '@/components/SegmentTimeRow';
import { WaveformScrubber } from '@/components/WaveformScrubber';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, spacing } from '@/constants/theme';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import {
  PRACTICE_MARKER_IDS,
  type PracticeMarkerId,
  type PracticeMarkers,
  type PracticeMarkersValidationIssue,
} from '@/domain/segment';
import {
  clearDraftMarker,
  createPracticeMarkerDraft,
  getDraftMarkerValue,
  getPracticeMarkerDraftIssue,
  isPracticeMarkerDraftSavable,
  practiceMarkerDraftsEqual,
  setDraftMarker,
} from '@/domain/segmentDraft';
import { useTempoLoopPlayer } from '@/playback/useTempoLoopPlayer';
import { projectRepository } from '@/repositories/ProjectRepository';
import { waveformLoader } from '@/services/WaveformLoader';
import { waveformGenerationCoordinator } from '@/services/WaveformGenerationCoordinator';
import { useProjectStore } from '@/stores/useProjectStore';
import { useWaveformStore } from '@/stores/useWaveformStore';
import { navigateBackOrHome } from '@/utils/navigation';
import { formatEditorTime } from '@/utils/time';

type EditorConfirmation = {
  readonly markerId: PracticeMarkerId;
};

type WaveformLoadState =
  | { readonly status: 'loading'; readonly waveform: null }
  | { readonly status: 'ready'; readonly waveform: StoredWaveform; readonly version: string }
  | { readonly status: 'failed'; readonly waveform: null; readonly version: string };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }

  const first = value?.[0];
  return first !== undefined && first.length > 0 ? first : null;
}

function markerRowIndex(markerId: PracticeMarkerId): number {
  return PRACTICE_MARKER_IDS.indexOf(markerId);
}

function markerLabel(markerId: PracticeMarkerId): string {
  if (markerId === 'final-end') {
    return COPY.segmentEditor.finalEndMarkerLabel;
  }

  return COPY.segmentEditor.startMarkerLabel(markerRowIndex(markerId) + 1);
}

function markerValidationMessage(issue: PracticeMarkersValidationIssue): string {
  switch (issue.code) {
    case 'START_1_REQUIRED':
      return COPY.segmentEditor.startOneRequiredError;
    case 'START_GAP':
      return COPY.segmentEditor.startGapError;
    case 'FINAL_END_REQUIRED':
      return COPY.segmentEditor.finalEndRequiredError;
    case 'NON_INTEGER':
      return COPY.segmentEditor.nonIntegerError;
    case 'OUT_OF_BOUNDS':
      return COPY.segmentEditor.outOfBoundsError;
    case 'NOT_STRICTLY_INCREASING':
      return COPY.segmentEditor.orderError;
  }
}

function isEditorAudioReady(
  projectId: string,
  mode: string,
  status: string,
  loadedProjectId: string | null,
): boolean {
  return (
    mode === 'editor' &&
    loadedProjectId === projectId &&
    (status === 'ready' || status === 'playing' || status === 'paused' || status === 'ended')
  );
}

interface SegmentEditorContentProps {
  readonly project: DanceProject;
  readonly audioUri: string;
  readonly cameFromPractice: boolean;
}

function SegmentEditorContent({ project, audioUri, cameFromPractice }: SegmentEditorContentProps) {
  const navigation = useNavigation();
  const player = useTempoLoopPlayer();
  const playerRef = useRef(player);

  const updatePracticeMarkers = useProjectStore((state) => state.updatePracticeMarkers);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);

  const [baseline] = useState<PracticeMarkers>(() =>
    createPracticeMarkerDraft(project.practiceMarkers),
  );
  const [draft, setDraft] = useState<PracticeMarkers>(() =>
    createPracticeMarkerDraft(project.practiceMarkers),
  );
  const [confirmation, setConfirmation] = useState<EditorConfirmation | null>(null);
  const [highlightedInvalidMarkerId, setHighlightedInvalidMarkerId] =
    useState<PracticeMarkerId | null>(null);
  const [waveformState, setWaveformState] = useState<WaveformLoadState>({
    status: 'loading',
    waveform: null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const scrollViewRef = useRef<ScrollView | null>(null);
  const rowRefs = useRef<(Text | null)[]>([]);
  const rowOffsets = useRef<number[]>([]);
  const allowRemovalRef = useRef(false);
  const discardAlertOpenRef = useRef(false);
  const exitInFlightRef = useRef(false);
  const savingRef = useRef(false);
  const routeFocusedRef = useRef(false);
  const scrubWasPlayingRef = useRef(false);

  const validationIssue = getPracticeMarkerDraftIssue(draft, project.durationMs);
  const isDirty = !practiceMarkerDraftsEqual(draft, baseline);
  const draftIsSavable = isPracticeMarkerDraftSavable(draft, project.durationMs);
  const projectPending = pendingProjectId === project.id;
  const audioIsReady = isEditorAudioReady(
    project.id,
    player.snapshot.mode,
    player.snapshot.status,
    player.snapshot.projectId,
  );
  const interactionDisabled = isSaving || isExiting || projectPending || !audioIsReady;
  const waveformProgress = useWaveformStore((state) => state.progressByProjectId[project.id] ?? 0);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const enterEditor = useCallback(() => {
    return playerRef.current.enterEditor({
      projectId: project.id,
      audioUri,
      durationMs: project.durationMs,
    });
  }, [audioUri, project.durationMs, project.id]);

  const showPlaybackError = useCallback(() => {
    if (routeFocusedRef.current) {
      Alert.alert(COPY.segmentEditor.playbackErrorTitle, COPY.segmentEditor.playbackErrorMessage);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      routeFocusedRef.current = true;
      void enterEditor().catch(showPlaybackError);

      return () => {
        routeFocusedRef.current = false;
        scrubWasPlayingRef.current = false;
        playerRef.current.pause();
      };
    }, [enterEditor, showPlaybackError]),
  );

  useEffect(() => {
    let isCurrent = true;

    if (project.waveformStatus !== 'ready') {
      return () => {
        isCurrent = false;
      };
    }

    void waveformLoader
      .load(project)
      .then((waveform) => {
        if (isCurrent) {
          setWaveformState({ status: 'ready', waveform, version: project.updatedAtIso });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setWaveformState({
            status: 'failed',
            waveform: null,
            version: project.updatedAtIso,
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [project]);

  const focusInvalidMarker = useCallback((markerId: PracticeMarkerId) => {
    const index = markerRowIndex(markerId);
    setHighlightedInvalidMarkerId(markerId);
    const offset = rowOffsets.current[index];
    if (offset !== undefined) {
      scrollViewRef.current?.scrollTo({ y: Math.max(0, offset - spacing.md), animated: true });
    }

    const node = findNodeHandle(rowRefs.current[index]);
    if (node !== null) {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, []);

  const finishRemoval = useCallback(
    (continueNavigation: () => void, invalidatePreparedPlayback: boolean) => {
      if (exitInFlightRef.current) {
        return;
      }

      exitInFlightRef.current = true;
      setIsExiting(true);
      scrubWasPlayingRef.current = false;
      playerRef.current.pause();
      if (invalidatePreparedPlayback) {
        playerRef.current.deactivate();
      }
      allowRemovalRef.current = true;
      continueNavigation();
    },
    [],
  );

  usePreventRemove(true, ({ data }) => {
    if (allowRemovalRef.current) {
      navigation.dispatch(data.action);
      return;
    }

    if (savingRef.current || exitInFlightRef.current) {
      return;
    }

    if (!isDirty) {
      finishRemoval(() => navigation.dispatch(data.action), false);
      return;
    }

    if (discardAlertOpenRef.current) {
      return;
    }

    discardAlertOpenRef.current = true;
    const invalidDraft = !isPracticeMarkerDraftSavable(draft, project.durationMs);
    Alert.alert(
      invalidDraft ? COPY.segmentEditor.invalidDiscardTitle : COPY.segmentEditor.discardTitle,
      invalidDraft ? COPY.segmentEditor.invalidDiscardMessage : COPY.segmentEditor.discardMessage,
      [
        {
          text: COPY.segmentEditor.continueEditing,
          style: 'cancel',
          onPress: () => {
            discardAlertOpenRef.current = false;
          },
        },
        {
          text: invalidDraft ? COPY.segmentEditor.discardAndExit : COPY.segmentEditor.discardAction,
          style: 'destructive',
          onPress: () => {
            discardAlertOpenRef.current = false;
            finishRemoval(() => navigation.dispatch(data.action), true);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          discardAlertOpenRef.current = false;
        },
      },
    );
  });

  const handleSetMarker = useCallback(
    (markerId: PracticeMarkerId) => {
      if (interactionDisabled) {
        return;
      }

      const currentTimeMs = playerRef.current.getCurrentPositionMs();
      setDraft((current) => {
        const next = setDraftMarker(current, markerId, currentTimeMs, project.durationMs);
        setHighlightedInvalidMarkerId(
          getPracticeMarkerDraftIssue(next, project.durationMs)?.markerId ?? null,
        );
        return next;
      });
      setConfirmation({ markerId });
    },
    [interactionDisabled, project.durationMs],
  );

  const handleClearMarker = useCallback(
    (markerId: PracticeMarkerId) => {
      if (isSaving || isExiting || projectPending) {
        return;
      }

      setDraft((current) => {
        const next = clearDraftMarker(current, markerId);
        setHighlightedInvalidMarkerId(
          getPracticeMarkerDraftIssue(next, project.durationMs)?.markerId ?? null,
        );
        return next;
      });
      setConfirmation(null);
    },
    [isExiting, isSaving, project.durationMs, projectPending],
  );

  const handleScrubStart = useCallback(() => {
    const wasPlaying = playerRef.current.snapshot.status === 'playing';
    scrubWasPlayingRef.current = wasPlaying;
    setConfirmation(null);
    if (wasPlaying) {
      playerRef.current.pause();
    }
  }, []);

  const handleSeekPreview = useCallback(
    (positionMs: number) => {
      void playerRef.current.seekEditor(positionMs, false).catch(showPlaybackError);
    },
    [showPlaybackError],
  );

  const handleSeekRequested = useCallback(
    (positionMs: number) => {
      const resumeAfterSeek = scrubWasPlayingRef.current;
      scrubWasPlayingRef.current = false;
      void playerRef.current.seekEditor(positionMs, resumeAfterSeek).catch(showPlaybackError);
    },
    [showPlaybackError],
  );

  const handleScrubCancel = useCallback(() => {
    const shouldResume = scrubWasPlayingRef.current;
    scrubWasPlayingRef.current = false;
    if (shouldResume) {
      void playerRef.current.playEditor().catch(showPlaybackError);
    }
  }, [showPlaybackError]);

  const handleTogglePlayback = useCallback(() => {
    setConfirmation(null);
    if (playerRef.current.snapshot.status === 'playing') {
      playerRef.current.pause();
      return;
    }

    void playerRef.current.playEditor().catch(showPlaybackError);
  }, [showPlaybackError]);

  const handleSave = useCallback(() => {
    if (savingRef.current || exitInFlightRef.current || projectPending) {
      return;
    }

    const frozenDraft = createPracticeMarkerDraft(draft);
    const invalidIssue = getPracticeMarkerDraftIssue(frozenDraft, project.durationMs);
    if (invalidIssue !== null || !isPracticeMarkerDraftSavable(frozenDraft, project.durationMs)) {
      focusInvalidMarker(invalidIssue?.markerId ?? 'start-1');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setConfirmation(null);
    playerRef.current.pause();

    void updatePracticeMarkers(project.id, frozenDraft)
      .then(() => {
        playerRef.current.deactivate();
        allowRemovalRef.current = true;
        if (cameFromPractice) {
          navigateBackOrHome();
        } else {
          router.replace({
            pathname: '/project/[projectId]',
            params: { projectId: project.id },
          });
        }
      })
      .catch(() => {
        if (routeFocusedRef.current) {
          Alert.alert(COPY.segmentEditor.saveErrorTitle, COPY.segmentEditor.saveErrorMessage);
        }
      })
      .finally(() => {
        savingRef.current = false;
        if (routeFocusedRef.current) {
          setIsSaving(false);
        }
      });
  }, [
    cameFromPractice,
    draft,
    focusInvalidMarker,
    project.durationMs,
    project.id,
    projectPending,
    updatePracticeMarkers,
  ]);

  const handleRetryAudio = useCallback(() => {
    void enterEditor().catch(showPlaybackError);
  }, [enterEditor, showPlaybackError]);

  const handleRetryWaveform = useCallback(() => {
    void waveformGenerationCoordinator.retry(project.id);
  }, [project.id]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <AppButton
          disabled={isExiting}
          label={COPY.common.cancel}
          onPress={navigateBackOrHome}
          style={styles.headerAction}
          variant="ghost"
        />
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {COPY.segmentEditor.title}
        </Text>
        <AppButton
          disabled={!draftIsSavable || projectPending || isExiting}
          label={COPY.common.save}
          loading={isSaving}
          onPress={handleSave}
          style={styles.headerAction}
          variant="ghost"
        />
      </View>

      <View style={styles.waveformSection} testID="segment-editor-audio-panel">
        <View style={styles.audioMeta}>
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.timeDisplay}>
            {COPY.segmentEditor.currentAndTotal(
              formatEditorTime(audioIsReady ? player.snapshot.sourcePositionMs : 0),
              formatEditorTime(project.durationMs),
            )}
          </Text>
        </View>

        {project.waveformStatus === 'pending' ? (
          <View style={styles.waveformStatus}>
            <ActivityIndicator color={colors.accent} />
            <Text accessibilityLiveRegion="polite" style={styles.statusText}>
              {COPY.segmentEditor.waveformProgress(Math.round(waveformProgress * 100))}
            </Text>
          </View>
        ) : null}

        {project.waveformStatus === 'ready' &&
        !(waveformState.status !== 'loading' && waveformState.version === project.updatedAtIso) ? (
          <View style={styles.waveformStatus}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.statusText}>{COPY.segmentEditor.waveformLoading}</Text>
          </View>
        ) : null}

        {project.waveformStatus === 'failed' ||
        (project.waveformStatus === 'ready' &&
          waveformState.status === 'failed' &&
          waveformState.version === project.updatedAtIso) ? (
          <View style={styles.waveformStatus}>
            <Text accessibilityRole="alert" style={styles.statusText}>
              {COPY.segmentEditor.waveformError}
            </Text>
            <AppButton
              label={COPY.common.retry}
              onPress={handleRetryWaveform}
              variant="secondary"
            />
          </View>
        ) : null}

        {project.waveformStatus === 'ready' &&
        waveformState.status === 'ready' &&
        waveformState.version === project.updatedAtIso ? (
          <WaveformScrubber
            amplitudes={waveformState.waveform.samples}
            currentTimeMs={audioIsReady ? player.snapshot.sourcePositionMs : 0}
            disabled={interactionDisabled}
            durationMs={project.durationMs}
            isPlaying={player.snapshot.status === 'playing'}
            onScrubCancel={handleScrubCancel}
            onScrubStart={handleScrubStart}
            onSeekPreview={handleSeekPreview}
            onSeekRequested={handleSeekRequested}
          />
        ) : null}

        {player.snapshot.status === 'error' ? (
          <View style={styles.waveformStatus}>
            <Text accessibilityRole="alert" style={styles.statusText}>
              {COPY.segmentEditor.audioUnavailable}
            </Text>
            <AppButton label={COPY.common.retry} onPress={handleRetryAudio} variant="secondary" />
          </View>
        ) : null}

        <AppButton
          disabled={interactionDisabled}
          fullWidth
          label={
            player.snapshot.status === 'playing'
              ? COPY.segmentEditor.pause
              : COPY.segmentEditor.play
          }
          loading={player.snapshot.status === 'loading'}
          onPress={handleTogglePlayback}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.segmentContent}
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        testID="segment-editor-segment-scroll"
      >
        <View style={styles.segmentList}>
          {PRACTICE_MARKER_IDS.map((markerId) => {
            const rowIndex = markerRowIndex(markerId);
            const label = markerLabel(markerId);
            const timeMs = getDraftMarkerValue(draft, markerId);

            return (
              <View
                key={markerId}
                onLayout={(event) => {
                  rowOffsets.current[rowIndex] = event.nativeEvent.layout.y;
                }}
              >
                <SegmentTimeRow
                  confirmation={
                    confirmation?.markerId === markerId
                      ? COPY.segmentEditor.markerConfirmation(label, formatEditorTime(timeMs))
                      : null
                  }
                  disabled={isSaving || isExiting || projectPending}
                  highlighted={highlightedInvalidMarkerId === markerId}
                  label={label}
                  markerId={markerId}
                  onClear={() => handleClearMarker(markerId)}
                  onSet={() => handleSetMarker(markerId)}
                  ref={(node) => {
                    rowRefs.current[rowIndex] = node;
                  }}
                  setDisabled={!audioIsReady}
                  timeMs={timeMs}
                  validationMessage={
                    validationIssue?.markerId === markerId
                      ? markerValidationMessage(validationIssue)
                      : null
                  }
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function SegmentEditorScreen() {
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    origin?: string | string[];
  }>();
  const projectId = firstParam(params.projectId);
  const cameFromPractice = firstParam(params.origin) === 'practice';
  const projects = useProjectStore((state) => state.projects);
  const isInitialized = useProjectStore((state) => state.isInitialized);
  const isLoading = useProjectStore((state) => state.isLoading);
  const projectStoreError = useProjectStore((state) => state.error);
  const initialize = useProjectStore((state) => state.initialize);
  const initializationRequestedRef = useRef(false);
  const project = useMemo(
    () =>
      projectId === null
        ? null
        : (projects.find((candidate) => candidate.id === projectId) ?? null),
    [projectId, projects],
  );
  const audioUri = useMemo(() => {
    if (project === null) {
      return null;
    }

    try {
      return projectRepository.resolveAudioUri(project);
    } catch {
      return null;
    }
  }, [project]);

  const requestInitialization = useCallback(() => {
    if (initializationRequestedRef.current) {
      return;
    }

    initializationRequestedRef.current = true;
    void initialize().catch(() => {
      // Store state renders the recoverable initialization error.
    });
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized && !isLoading && projectStoreError === null) {
      requestInitialization();
    }
  }, [isInitialized, isLoading, projectStoreError, requestInitialization]);

  if (!isInitialized && projectStoreError !== null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <EmptyState
            actionLabel={COPY.common.retry}
            message={COPY.projectList.loadErrorMessage}
            onAction={() => {
              initializationRequestedRef.current = false;
              requestInitialization();
            }}
            title={COPY.projectList.loadErrorTitle}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!isInitialized || isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (project === null || audioUri === null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <EmptyState
            actionLabel={COPY.practice.backAccessibilityLabel}
            message={COPY.segmentEditor.projectNotFoundMessage}
            onAction={navigateBackOrHome}
            title={COPY.segmentEditor.projectNotFoundTitle}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SegmentEditorContent
      audioUri={audioUri}
      cameFromPractice={cameFromPractice}
      key={project.id}
      project={project}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: spacing.xs,
  },
  headerAction: {
    minWidth: 80,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  segmentContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  waveformSection: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  audioMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  projectName: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
  },
  timeDisplay: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeights.semibold,
  },
  waveformStatus: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 72,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    textAlign: 'center',
  },
  segmentList: {
    gap: spacing.sm,
  },
});
