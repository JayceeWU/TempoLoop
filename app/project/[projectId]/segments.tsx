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
  SEGMENT_INDEXES,
  getSegmentValidationIssue,
  type DanceSegments,
  type SegmentIndex,
} from '@/domain/segment';
import {
  clearDraftSegment,
  createSegmentDraft,
  isSegmentDraftSavable,
  segmentDraftsEqual,
  setDraftEndpoint,
  type SegmentEndpoint,
} from '@/domain/segmentDraft';
import { useTempoLoopPlayer } from '@/playback/useTempoLoopPlayer';
import { projectRepository } from '@/repositories/ProjectRepository';
import { waveformLoader } from '@/services/WaveformLoader';
import { useProjectStore } from '@/stores/useProjectStore';
import { formatEditorTime } from '@/utils/time';

type EditorConfirmation = {
  readonly segmentIndex: SegmentIndex;
  readonly endpoint: SegmentEndpoint;
};

type WaveformLoadState =
  | { readonly status: 'loading'; readonly waveform: null }
  | { readonly status: 'ready'; readonly waveform: StoredWaveform }
  | { readonly status: 'failed'; readonly waveform: null };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }

  const first = value?.[0];
  return first !== undefined && first.length > 0 ? first : null;
}

function firstInvalidSegmentIndex(draft: DanceSegments, durationMs: number): SegmentIndex | null {
  return (
    SEGMENT_INDEXES.find((index) => getSegmentValidationIssue(draft[index], durationMs) !== null) ??
    null
  );
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

  const updateSegments = useProjectStore((state) => state.updateSegments);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);

  const [baseline] = useState<DanceSegments>(() => createSegmentDraft(project.segments));
  const [draft, setDraft] = useState<DanceSegments>(() => createSegmentDraft(project.segments));
  const [confirmation, setConfirmation] = useState<EditorConfirmation | null>(null);
  const [highlightedInvalidIndex, setHighlightedInvalidIndex] = useState<SegmentIndex | null>(null);
  const [waveformRetry, setWaveformRetry] = useState(0);
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

  const isDirty = !segmentDraftsEqual(draft, baseline);
  const draftIsSavable = isSegmentDraftSavable(draft, project.durationMs);
  const projectPending = pendingProjectId === project.id;
  const audioIsReady = isEditorAudioReady(
    project.id,
    player.snapshot.mode,
    player.snapshot.status,
    player.snapshot.projectId,
  );
  const interactionDisabled = isSaving || isExiting || projectPending || !audioIsReady;

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

    void waveformLoader
      .load(project)
      .then((waveform) => {
        if (isCurrent) {
          setWaveformState({ status: 'ready', waveform });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setWaveformState({ status: 'failed', waveform: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [project, waveformRetry]);

  const focusInvalidSegment = useCallback((index: SegmentIndex) => {
    setHighlightedInvalidIndex(index);
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
    const invalidDraft = !isSegmentDraftSavable(draft, project.durationMs);
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

  const handleSetEndpoint = useCallback(
    (segmentIndex: SegmentIndex, endpoint: SegmentEndpoint) => {
      if (interactionDisabled) {
        return;
      }

      const currentTimeMs = playerRef.current.getCurrentPositionMs();
      setDraft((current) => {
        const next = setDraftEndpoint(
          current,
          segmentIndex,
          endpoint,
          currentTimeMs,
          project.durationMs,
        );
        setHighlightedInvalidIndex(firstInvalidSegmentIndex(next, project.durationMs));
        return next;
      });
      setConfirmation({ segmentIndex, endpoint });
    },
    [interactionDisabled, project.durationMs],
  );

  const handleClearSegment = useCallback(
    (segmentIndex: SegmentIndex) => {
      if (isSaving || isExiting || projectPending) {
        return;
      }

      setDraft((current) => {
        const next = clearDraftSegment(current, segmentIndex);
        setHighlightedInvalidIndex(firstInvalidSegmentIndex(next, project.durationMs));
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

    const frozenDraft = createSegmentDraft(draft);
    const invalidIndex = firstInvalidSegmentIndex(frozenDraft, project.durationMs);
    if (invalidIndex !== null || !isSegmentDraftSavable(frozenDraft, project.durationMs)) {
      focusInvalidSegment(invalidIndex ?? 0);
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setConfirmation(null);
    playerRef.current.pause();

    void updateSegments(project.id, frozenDraft)
      .then(() => {
        playerRef.current.deactivate();
        allowRemovalRef.current = true;
        if (cameFromPractice) {
          router.back();
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
    focusInvalidSegment,
    project.durationMs,
    project.id,
    projectPending,
    updateSegments,
  ]);

  const handleRetryAudio = useCallback(() => {
    void enterEditor().catch(showPlaybackError);
  }, [enterEditor, showPlaybackError]);

  const handleRetryWaveform = useCallback(() => {
    setWaveformState({ status: 'loading', waveform: null });
    setWaveformRetry((current) => current + 1);
  }, []);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <AppButton
          disabled={isExiting}
          label={COPY.common.cancel}
          onPress={() => router.back()}
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

      <ScrollView
        contentContainerStyle={styles.content}
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.waveformSection}>
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.timeDisplay}>
            {COPY.segmentEditor.currentAndTotal(
              formatEditorTime(audioIsReady ? player.snapshot.sourcePositionMs : 0),
              formatEditorTime(project.durationMs),
            )}
          </Text>
          <Text style={styles.rateLabel}>{COPY.segmentEditor.editorRate}</Text>

          {waveformState.status === 'loading' ? (
            <View style={styles.waveformStatus}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>{COPY.segmentEditor.waveformLoading}</Text>
            </View>
          ) : null}

          {waveformState.status === 'failed' ? (
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

          {waveformState.status === 'ready' ? (
            <WaveformScrubber
              amplitudes={waveformState.waveform.samples}
              currentTimeMs={audioIsReady ? player.snapshot.sourcePositionMs : 0}
              disabled={interactionDisabled}
              durationMs={project.durationMs}
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
            size="large"
          />
        </View>

        <View style={styles.segmentList}>
          {draft.map((segment) => (
            <View
              key={segment.id}
              onLayout={(event) => {
                rowOffsets.current[segment.index] = event.nativeEvent.layout.y;
              }}
            >
              <SegmentTimeRow
                confirmedEndpoint={
                  confirmation?.segmentIndex === segment.index ? confirmation.endpoint : null
                }
                disabled={isSaving || isExiting || projectPending}
                durationMs={project.durationMs}
                highlighted={highlightedInvalidIndex === segment.index}
                onClear={() => handleClearSegment(segment.index)}
                onSet={(endpoint) => handleSetEndpoint(segment.index, endpoint)}
                ref={(node) => {
                  rowRefs.current[segment.index] = node;
                }}
                segment={segment}
                setDisabled={!audioIsReady}
              />
            </View>
          ))}
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
            onAction={() => router.back()}
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
  content: {
    gap: spacing.lg,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  waveformSection: {
    gap: spacing.sm,
  },
  projectName: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  timeDisplay: {
    color: colors.text,
    fontSize: fontSizes.title,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  rateLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    textAlign: 'center',
  },
  waveformStatus: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 112,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    textAlign: 'center',
  },
  segmentList: {
    gap: spacing.md,
  },
});
