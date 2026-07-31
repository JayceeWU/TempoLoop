import { Stack, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { SegmentTimeRow } from '@/components/SegmentTimeRow';
import { WaveformScrubber } from '@/components/WaveformScrubber';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, spacing } from '@/constants/theme';
import type { DanceProject, WaveformFile } from '@/domain/project';
import type { DanceSegments, SegmentNumber } from '@/domain/segment';
import {
  clearDraftSegment,
  createSegmentDraft,
  isSegmentDraftSavable,
  segmentDraftsEqual,
  setDraftEndpoint,
  type SegmentEndpoint,
} from '@/domain/segmentDraft';
import { projectRepository } from '@/repositories/ProjectRepository';
import { waveformLoader } from '@/services/WaveformLoader';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppError } from '@/utils/errors';
import { canAcceptPlaybackToggle } from '@/utils/interaction';
import { clampTimeMs, formatEditorTime } from '@/utils/time';

type EditorConfirmation = {
  readonly segmentNumber: SegmentNumber;
  readonly endpoint: SegmentEndpoint;
};

type WaveformLoadState =
  | { readonly status: 'loading'; readonly waveform: null }
  | { readonly status: 'ready'; readonly waveform: WaveformFile }
  | { readonly status: 'failed'; readonly waveform: null };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }

  const first = value?.[0];
  return first !== undefined && first.length > 0 ? first : null;
}

function isLoadedPlaybackState(
  state: ReturnType<typeof usePlaybackStore.getState>['snapshot']['state'],
): boolean {
  return (
    state === 'ready' ||
    state === 'playing' ||
    state === 'paused' ||
    state === 'seeking' ||
    state === 'completed'
  );
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof AppError && error.userMessage !== null
    ? error.userMessage
    : COPY.segmentEditor.playbackErrorMessage;
}

interface SegmentEditorContentProps {
  readonly project: DanceProject;
  readonly audioUri: string;
  readonly cameFromPractice: boolean;
}

function SegmentEditorContent({ project, audioUri, cameFromPractice }: SegmentEditorContentProps) {
  const navigation = useNavigation();
  const updateSegments = useProjectStore((state) => state.updateSegments);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);
  const snapshot = usePlaybackStore((state) => state.snapshot);
  const selectedProjectId = usePlaybackStore((state) => state.selectedProjectId);
  const command = usePlaybackStore((state) => state.command);

  const [baseline] = useState<DanceSegments>(() => createSegmentDraft(project.segments));
  const [draft, setDraft] = useState<DanceSegments>(() => createSegmentDraft(project.segments));
  const [confirmation, setConfirmation] = useState<EditorConfirmation | null>(null);
  const [waveformRetry, setWaveformRetry] = useState(0);
  const [waveformState, setWaveformState] = useState<WaveformLoadState>({
    status: 'loading',
    waveform: null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const focusTokenRef = useRef(0);
  const isFocusedRef = useRef(false);
  const isUnmountingRef = useRef(false);
  const keepLoadedOnExitRef = useRef(cameFromPractice);
  const exitWasPausedRef = useRef(false);
  const exitInFlightRef = useRef(false);
  const allowRemovalRef = useRef(false);
  const discardAlertOpenRef = useRef(false);
  const savingRef = useRef(false);
  const endpointSetInFlightRef = useRef(false);
  const lastPlaybackToggleAtRef = useRef<number | null>(null);

  const isDirty = !segmentDraftsEqual(draft, baseline);
  const draftIsSavable = isSegmentDraftSavable(draft, project.durationMs);
  const commandPending = command.status === 'pending';
  const projectPending = pendingProjectId === project.id;
  const audioIsReady =
    selectedProjectId === project.id &&
    isLoadedPlaybackState(snapshot.state) &&
    snapshot.durationMs === project.durationMs;
  const interactionDisabled =
    commandPending || projectPending || isSaving || isExiting || !audioIsReady;

  useEffect(() => {
    let isCurrent = true;

    void waveformLoader
      .load({
        durationMs: project.durationMs,
        waveformRelativePath: project.waveformRelativePath,
      })
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
  }, [project.durationMs, project.waveformRelativePath, waveformRetry]);

  const tokenIsCurrent = useCallback(
    (token: number) => isFocusedRef.current && focusTokenRef.current === token,
    [],
  );

  const showPlaybackError = useCallback(
    (error: unknown, token: number) => {
      if (error instanceof AppError && error.isCancellation) {
        return;
      }

      if (tokenIsCurrent(token)) {
        Alert.alert(COPY.segmentEditor.playbackErrorTitle, playbackErrorMessage(error));
      }
    },
    [tokenIsCurrent],
  );

  const prepareEditorPlayback = useCallback(
    async (token: number): Promise<void> => {
      let playback = usePlaybackStore.getState();
      const canReuseLoadedAudio =
        playback.selectedProjectId === project.id &&
        isLoadedPlaybackState(playback.snapshot.state) &&
        playback.snapshot.durationMs === project.durationMs;

      if (
        isLoadedPlaybackState(playback.snapshot.state) &&
        (!canReuseLoadedAudio ||
          playback.snapshot.state === 'playing' ||
          playback.snapshot.state === 'seeking')
      ) {
        await playback.pause();
        if (!tokenIsCurrent(token)) {
          return;
        }
      }

      playback = usePlaybackStore.getState();
      playback.setSelection({
        projectId: project.id,
        segmentNumber: canReuseLoadedAudio ? playback.selectedSegment : project.lastSelectedSegment,
        rate: 1,
      });

      if (!canReuseLoadedAudio) {
        await usePlaybackStore.getState().loadAudio(audioUri);
        if (!tokenIsCurrent(token)) {
          return;
        }
      }

      playback = usePlaybackStore.getState();
      if (
        playback.snapshot.activeRangeStartMs !== null ||
        playback.snapshot.activeRangeEndMs !== null
      ) {
        await playback.stopAndSeek(
          clampTimeMs(playback.snapshot.currentTimeMs, project.durationMs),
        );
        if (!tokenIsCurrent(token)) {
          return;
        }
      }

      playback = usePlaybackStore.getState();
      if (playback.snapshot.rate !== 1) {
        await playback.setRate(1);
      }
    },
    [audioUri, project.durationMs, project.id, project.lastSelectedSegment, tokenIsCurrent],
  );

  useEffect(() => {
    isUnmountingRef.current = false;

    return () => {
      isUnmountingRef.current = true;
      isFocusedRef.current = false;
      focusTokenRef.current += 1;

      const playback = usePlaybackStore.getState();
      if (!keepLoadedOnExitRef.current && playback.selectedProjectId === project.id) {
        void playback.unload().catch(() => {
          // A later project load owns recovery from a best-effort route cleanup.
        });
      }
    };
  }, [project.id]);

  useFocusEffect(
    useCallback(() => {
      const token = focusTokenRef.current + 1;
      focusTokenRef.current = token;
      isFocusedRef.current = true;
      exitWasPausedRef.current = false;

      void prepareEditorPlayback(token).catch((error: unknown) => {
        showPlaybackError(error, token);
      });

      return () => {
        isFocusedRef.current = false;
        focusTokenRef.current += 1;

        if (isUnmountingRef.current || exitWasPausedRef.current) {
          return;
        }

        const playback = usePlaybackStore.getState();
        if (
          playback.selectedProjectId === project.id &&
          isLoadedPlaybackState(playback.snapshot.state)
        ) {
          void playback.pause().catch(() => {
            // Blur cleanup is best effort and never auto-resumes.
          });
        }
      };
    }, [prepareEditorPlayback, project.id, showPlaybackError]),
  );

  const finishPlaybackBeforeExit = useCallback(
    (continueNavigation: () => void) => {
      if (exitInFlightRef.current) {
        return;
      }

      exitInFlightRef.current = true;
      setIsExiting(true);
      isFocusedRef.current = false;
      focusTokenRef.current += 1;
      const playback = usePlaybackStore.getState();
      let playbackExitOperation: Promise<unknown> = Promise.resolve();
      if (playback.selectedProjectId === project.id) {
        playbackExitOperation = keepLoadedOnExitRef.current
          ? isLoadedPlaybackState(playback.snapshot.state)
            ? playback.pause()
            : Promise.resolve()
          : playback.unload();
      }

      void playbackExitOperation
        .catch(() => {
          // Leaving must not trap the user if native playback has already failed.
        })
        .then(() => {
          exitWasPausedRef.current = true;
          continueNavigation();
        });
    },
    [project.id],
  );

  usePreventRemove(true, ({ data }) => {
    if (allowRemovalRef.current) {
      navigation.dispatch(data.action);
      return;
    }

    if (savingRef.current) {
      return;
    }

    if (!isDirty) {
      finishPlaybackBeforeExit(() => {
        navigation.dispatch(data.action);
      });
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
            finishPlaybackBeforeExit(() => {
              navigation.dispatch(data.action);
            });
          },
        },
      ],
    );
  });

  const handleSetEndpoint = useCallback(
    (segmentNumber: SegmentNumber, endpoint: SegmentEndpoint) => {
      const playback = usePlaybackStore.getState();
      if (
        exitInFlightRef.current ||
        savingRef.current ||
        endpointSetInFlightRef.current ||
        playback.command.status === 'pending' ||
        playback.selectedProjectId !== project.id ||
        !isLoadedPlaybackState(playback.snapshot.state)
      ) {
        return;
      }

      endpointSetInFlightRef.current = true;
      const token = focusTokenRef.current;

      void playback
        .refreshSnapshot()
        .then((latestSnapshot) => {
          const latestPlayback = usePlaybackStore.getState();
          if (
            !tokenIsCurrent(token) ||
            exitInFlightRef.current ||
            savingRef.current ||
            latestPlayback.selectedProjectId !== project.id ||
            latestSnapshot.durationMs !== project.durationMs ||
            !isLoadedPlaybackState(latestSnapshot.state)
          ) {
            return;
          }

          setDraft((current) =>
            setDraftEndpoint(
              current,
              segmentNumber,
              endpoint,
              latestSnapshot.currentTimeMs,
              project.durationMs,
            ),
          );
          setConfirmation({ segmentNumber, endpoint });
        })
        .catch((error: unknown) => {
          showPlaybackError(error, token);
        })
        .finally(() => {
          endpointSetInFlightRef.current = false;
        });
    },
    [project.durationMs, project.id, showPlaybackError, tokenIsCurrent],
  );

  const handleClearSegment = useCallback((segmentNumber: SegmentNumber) => {
    if (exitInFlightRef.current || savingRef.current) {
      return;
    }

    setDraft((current) => clearDraftSegment(current, segmentNumber));
    setConfirmation(null);
  }, []);

  const handleSeek = useCallback(
    (positionMs: number) => {
      const playback = usePlaybackStore.getState();
      if (
        exitInFlightRef.current ||
        savingRef.current ||
        playback.command.status === 'pending' ||
        playback.selectedProjectId !== project.id ||
        !isLoadedPlaybackState(playback.snapshot.state)
      ) {
        return;
      }

      setConfirmation(null);
      const token = focusTokenRef.current;
      void playback.seek(positionMs).catch((error: unknown) => {
        showPlaybackError(error, token);
      });
    },
    [project.id, showPlaybackError],
  );

  const handleTogglePlayback = useCallback(() => {
    const playback = usePlaybackStore.getState();
    if (
      exitInFlightRef.current ||
      savingRef.current ||
      playback.command.status === 'pending' ||
      playback.selectedProjectId !== project.id ||
      !isLoadedPlaybackState(playback.snapshot.state)
    ) {
      return;
    }

    setConfirmation(null);
    const token = focusTokenRef.current;
    const acceptedAtMs = Date.now();
    if (!canAcceptPlaybackToggle(lastPlaybackToggleAtRef.current, acceptedAtMs)) {
      return;
    }

    const operation =
      playback.snapshot.state === 'playing'
        ? playback.pause()
        : playback.playFrom(
            playback.snapshot.currentTimeMs >= project.durationMs
              ? 0
              : playback.snapshot.currentTimeMs,
            1,
          );
    lastPlaybackToggleAtRef.current = acceptedAtMs;

    void operation.catch((error: unknown) => {
      showPlaybackError(error, token);
    });
  }, [project.durationMs, project.id, showPlaybackError]);

  const handleSave = useCallback(() => {
    if (exitInFlightRef.current || savingRef.current || pendingProjectId === project.id) {
      return;
    }

    const frozenDraft = createSegmentDraft(draft);
    if (!isSegmentDraftSavable(frozenDraft, project.durationMs)) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setConfirmation(null);
    const token = focusTokenRef.current;

    void (async () => {
      const playback = usePlaybackStore.getState();
      if (
        playback.selectedProjectId === project.id &&
        isLoadedPlaybackState(playback.snapshot.state)
      ) {
        await playback.pause();
      }

      if (!tokenIsCurrent(token) || !isSegmentDraftSavable(frozenDraft, project.durationMs)) {
        return;
      }

      await updateSegments(project.id, frozenDraft);
      if (!tokenIsCurrent(token)) {
        return;
      }

      exitWasPausedRef.current = true;
      allowRemovalRef.current = true;
      keepLoadedOnExitRef.current = true;
      if (cameFromPractice) {
        router.back();
      } else {
        router.replace({
          pathname: '/project/[projectId]',
          params: { projectId: project.id },
        });
      }
    })()
      .catch(() => {
        if (tokenIsCurrent(token)) {
          Alert.alert(COPY.segmentEditor.saveErrorTitle, COPY.segmentEditor.saveErrorMessage);
        }
      })
      .finally(() => {
        savingRef.current = false;
        if (tokenIsCurrent(token)) {
          setIsSaving(false);
        }
      });
  }, [
    cameFromPractice,
    draft,
    pendingProjectId,
    project.durationMs,
    project.id,
    tokenIsCurrent,
    updateSegments,
  ]);

  const handleRetryAudio = useCallback(() => {
    if (exitInFlightRef.current || command.status === 'pending') {
      return;
    }

    const token = focusTokenRef.current;
    void prepareEditorPlayback(token).catch((error: unknown) => {
      showPlaybackError(error, token);
    });
  }, [command.status, prepareEditorPlayback, showPlaybackError]);

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
          disabled={!draftIsSavable || commandPending || projectPending || isExiting}
          label={COPY.common.save}
          loading={isSaving}
          onPress={handleSave}
          style={styles.headerAction}
          variant="ghost"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.waveformSection}>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.timeDisplay}>
            {COPY.segmentEditor.currentAndTotal(
              formatEditorTime(audioIsReady ? snapshot.currentTimeMs : 0),
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
              amplitudes={waveformState.waveform.amplitudes}
              currentTimeMs={audioIsReady ? snapshot.currentTimeMs : 0}
              disabled={interactionDisabled}
              durationMs={project.durationMs}
              onSeekRequested={handleSeek}
            />
          ) : null}

          {!audioIsReady && !commandPending ? (
            <View style={styles.waveformStatus}>
              <Text style={styles.statusText}>{COPY.segmentEditor.audioUnavailable}</Text>
              <AppButton label={COPY.common.retry} onPress={handleRetryAudio} variant="secondary" />
            </View>
          ) : null}

          <AppButton
            disabled={interactionDisabled}
            fullWidth
            label={
              snapshot.state === 'playing' ? COPY.segmentEditor.pause : COPY.segmentEditor.play
            }
            loading={commandPending && (command.kind === 'play-from' || command.kind === 'pause')}
            onPress={handleTogglePlayback}
            size="large"
          />
        </View>

        <View style={styles.segmentList}>
          {draft.map((segment) => (
            <SegmentTimeRow
              confirmedEndpoint={
                confirmation?.segmentNumber === segment.number ? confirmation.endpoint : null
              }
              disabled={commandPending || projectPending || isSaving || isExiting}
              durationMs={project.durationMs}
              key={segment.number}
              onClear={() => handleClearSegment(segment.number)}
              onSet={(endpoint) => handleSetEndpoint(segment.number, endpoint)}
              segment={segment}
              setDisabled={!audioIsReady}
            />
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
      // Store state renders the recoverable loading failure.
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
    paddingHorizontal: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: {
    minWidth: 76,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
  },
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  waveformSection: {
    gap: spacing.md,
  },
  projectName: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  timeDisplay: {
    color: colors.text,
    fontSize: fontSizes.display,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeights.bold,
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
    minHeight: 112,
    justifyContent: 'center',
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    textAlign: 'center',
  },
  segmentList: {
    gap: spacing.md,
  },
});
