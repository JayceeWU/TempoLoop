import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, minimumTapSize, spacing } from '@/constants/theme';
import { calculatePlaybackRange, type PlaybackRate, type PlaybackRange } from '@/domain/playback';
import {
  canTogglePracticePlayback,
  getConfiguredPracticeSegment,
  getPracticePlaybackIntent,
  isPracticeAudioReady,
  selectInitialPracticeSegment,
} from '@/domain/practice';
import type { SegmentNumber } from '@/domain/segment';
import { projectRepository } from '@/repositories/ProjectRepository';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppError } from '@/utils/errors';
import { canAcceptPlaybackToggle } from '@/utils/interaction';
import { formatSegmentTime } from '@/utils/time';

function projectIdFromParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  const first = value?.[0];
  return first !== undefined && first.length > 0 ? first : null;
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof AppError && error.userMessage !== null
    ? error.userMessage
    : COPY.practice.playbackErrorMessage;
}

export default function PracticeProjectScreen() {
  const params = useLocalSearchParams<{
    projectId?: string | string[];
  }>();
  const projectId = projectIdFromParam(params.projectId);
  const projects = useProjectStore((state) => state.projects);
  const isInitialized = useProjectStore((state) => state.isInitialized);
  const isLoadingProjects = useProjectStore((state) => state.isLoading);
  const initializeProjects = useProjectStore((state) => state.initialize);
  const updatePreferences = useProjectStore((state) => state.updatePreferences);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);
  const projectStoreError = useProjectStore((state) => state.error);
  const snapshot = usePlaybackStore((state) => state.snapshot);
  const selectedProjectId = usePlaybackStore((state) => state.selectedProjectId);
  const selectedSegment = usePlaybackStore((state) => state.selectedSegment);
  const selectedRate = usePlaybackStore((state) => state.selectedRate);
  const command = usePlaybackStore((state) => state.command);
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);

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
  const focusLoadKey =
    project !== null && audioUri !== null ? `${project.id}\u0000${audioUri}` : null;

  const projectRef = useRef(project);
  const audioUriRef = useRef(audioUri);
  const initializationRequestedRef = useRef(false);
  const focusTokenRef = useRef(0);
  const isFocusedRef = useRef(false);
  const isUnmountingRef = useRef(false);
  const isOpeningEditorRef = useRef(false);
  const lastPlaybackToggleAtRef = useRef<number | null>(null);

  useEffect(() => {
    projectRef.current = project;
    audioUriRef.current = audioUri;
  }, [audioUri, project]);

  const requestProjectInitialization = useCallback(() => {
    if (initializationRequestedRef.current) {
      return;
    }

    initializationRequestedRef.current = true;
    void initializeProjects().catch(() => {
      // The store exposes the failure and the screen offers an explicit retry.
    });
  }, [initializeProjects]);

  useEffect(() => {
    if (!isInitialized && !isLoadingProjects && projectStoreError === null) {
      requestProjectInitialization();
    }
  }, [isInitialized, isLoadingProjects, projectStoreError, requestProjectInitialization]);

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
        Alert.alert(COPY.practice.playbackErrorTitle, playbackErrorMessage(error));
      }
    },
    [tokenIsCurrent],
  );

  const prepareFocusedProject = useCallback(
    async (token: number): Promise<void> => {
      const currentProject = projectRef.current;
      const currentAudioUri = audioUriRef.current;
      if (currentProject === null || currentAudioUri === null || !tokenIsCurrent(token)) {
        return;
      }

      const initialSegment = selectInitialPracticeSegment(currentProject);
      let playback = usePlaybackStore.getState();
      const canReuseLoadedAudio =
        playback.selectedProjectId === currentProject.id &&
        isPracticeAudioReady(playback.snapshot.state) &&
        playback.snapshot.durationMs === currentProject.durationMs;

      playback.setSelection({
        projectId: currentProject.id,
        segmentNumber: initialSegment,
        rate: currentProject.preferredRate,
      });

      if (!canReuseLoadedAudio) {
        await usePlaybackStore.getState().loadAudio(currentAudioUri);
        if (!tokenIsCurrent(token)) {
          return;
        }
      }

      playback = usePlaybackStore.getState();
      if (playback.snapshot.rate !== currentProject.preferredRate) {
        await playback.setRate(currentProject.preferredRate);
        if (!tokenIsCurrent(token)) {
          return;
        }
      }

      const configuredSegment = getConfiguredPracticeSegment(currentProject, initialSegment);
      if (configuredSegment !== null) {
        const range = calculatePlaybackRange(configuredSegment);
        await usePlaybackStore.getState().stopAndSeek(range.playFromMs);
      }
    },
    [tokenIsCurrent],
  );

  useEffect(() => {
    isUnmountingRef.current = false;

    return () => {
      isUnmountingRef.current = true;
      focusTokenRef.current += 1;
      isFocusedRef.current = false;

      const playback = usePlaybackStore.getState();
      if (projectId !== null && playback.selectedProjectId === projectId) {
        void playback.unload().catch(() => {
          // The route is already gone; a later load replaces native state.
        });
      }
    };
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      const token = focusTokenRef.current + 1;
      focusTokenRef.current = token;
      isFocusedRef.current = true;
      isOpeningEditorRef.current = false;
      setIsOpeningEditor(false);

      if (focusLoadKey !== null && projectRef.current !== null) {
        void prepareFocusedProject(token).catch((error: unknown) => {
          showPlaybackError(error, token);
        });
      }

      return () => {
        isFocusedRef.current = false;
        focusTokenRef.current += 1;

        if (isUnmountingRef.current || isOpeningEditorRef.current) {
          return;
        }

        const playback = usePlaybackStore.getState();
        if (
          projectId !== null &&
          playback.selectedProjectId === projectId &&
          playback.snapshot.state !== 'idle' &&
          playback.snapshot.state !== 'failed'
        ) {
          void playback.pause().catch(() => {
            // Blur cleanup is best effort and never auto-resumes.
          });
        }
      };
    }, [focusLoadKey, prepareFocusedProject, projectId, showPlaybackError]),
  );

  const handleRetryProjectLoad = useCallback(() => {
    initializationRequestedRef.current = false;
    requestProjectInitialization();
  }, [requestProjectInitialization]);

  const handleRetryAudio = useCallback(() => {
    if (command.status === 'pending') {
      return;
    }

    const token = focusTokenRef.current;
    void prepareFocusedProject(token).catch((error: unknown) => {
      showPlaybackError(error, token);
    });
  }, [command.status, prepareFocusedProject, showPlaybackError]);

  const persistPreferencePair = useCallback(
    async (
      rate: PlaybackRate,
      segmentNumber: SegmentNumber | null,
      token: number,
    ): Promise<void> => {
      const currentProject = projectRef.current;
      if (currentProject === null) {
        return;
      }

      try {
        await updatePreferences(currentProject.id, rate, segmentNumber);
      } catch {
        if (tokenIsCurrent(token)) {
          Alert.alert(COPY.practice.preferenceErrorTitle, COPY.practice.preferenceErrorMessage);
        }
      }
    },
    [tokenIsCurrent, updatePreferences],
  );

  const handleSelectSegment = useCallback(
    (segmentNumber: SegmentNumber) => {
      const currentProject = projectRef.current;
      const playback = usePlaybackStore.getState();
      if (
        currentProject === null ||
        playback.command.status === 'pending' ||
        pendingProjectId === currentProject.id ||
        playback.selectedProjectId !== currentProject.id
      ) {
        return;
      }

      const segment = getConfiguredPracticeSegment(currentProject, segmentNumber);
      if (segment === null || playback.selectedSegment === segmentNumber) {
        return;
      }

      const token = focusTokenRef.current;
      const range = calculatePlaybackRange(segment);
      void playback
        .stopAndSeek(range.playFromMs)
        .then(() => {
          if (!tokenIsCurrent(token)) {
            return;
          }

          const latest = usePlaybackStore.getState();
          latest.setSelectedSegment(segmentNumber);
          return persistPreferencePair(latest.selectedRate, segmentNumber, token);
        })
        .catch((error: unknown) => {
          showPlaybackError(error, token);
        });
    },
    [pendingProjectId, persistPreferencePair, showPlaybackError, tokenIsCurrent],
  );

  const handleSelectRate = useCallback(
    (rate: PlaybackRate) => {
      const currentProject = projectRef.current;
      const playback = usePlaybackStore.getState();
      if (
        currentProject === null ||
        rate === playback.selectedRate ||
        playback.command.status === 'pending' ||
        pendingProjectId === currentProject.id ||
        playback.selectedProjectId !== currentProject.id ||
        !isPracticeAudioReady(playback.snapshot.state)
      ) {
        return;
      }

      const token = focusTokenRef.current;
      const latestSegment = playback.selectedSegment;
      void playback
        .setRate(rate)
        .then(() => {
          if (!tokenIsCurrent(token)) {
            return;
          }

          return persistPreferencePair(rate, latestSegment, token);
        })
        .catch((error: unknown) => {
          showPlaybackError(error, token);
        });
    },
    [pendingProjectId, persistPreferencePair, showPlaybackError, tokenIsCurrent],
  );

  const configuredSelection =
    project === null || selectedProjectId !== project.id
      ? null
      : getConfiguredPracticeSegment(project, selectedSegment);
  const selectedRange: PlaybackRange | null =
    configuredSelection === null ? null : calculatePlaybackRange(configuredSelection);
  const commandPending = command.status === 'pending';
  const preferencePending = project !== null && pendingProjectId === project.id;
  const interactionDisabled =
    commandPending ||
    preferencePending ||
    isOpeningEditor ||
    project === null ||
    selectedProjectId !== project.id ||
    !isPracticeAudioReady(snapshot.state);
  const playbackEnabled =
    project !== null &&
    selectedProjectId === project.id &&
    canTogglePracticePlayback(
      snapshot,
      selectedRange,
      commandPending || preferencePending || isOpeningEditor,
    );

  const handleTogglePlayback = useCallback(() => {
    const currentProject = projectRef.current;
    const playback = usePlaybackStore.getState();
    if (
      currentProject === null ||
      playback.command.status === 'pending' ||
      pendingProjectId === currentProject.id ||
      playback.selectedProjectId !== currentProject.id
    ) {
      return;
    }

    const segment = getConfiguredPracticeSegment(currentProject, playback.selectedSegment);
    if (segment === null) {
      return;
    }

    const range = calculatePlaybackRange(segment);
    const intent = getPracticePlaybackIntent(playback.snapshot, range);
    const token = focusTokenRef.current;
    const acceptedAtMs = Date.now();
    if (!canAcceptPlaybackToggle(lastPlaybackToggleAtRef.current, acceptedAtMs)) {
      return;
    }

    let operation: Promise<unknown> | null = null;

    if (intent === 'pause') {
      operation = playback.pause();
    } else if (intent === 'resume') {
      operation = playback.resume();
    } else if (intent === 'play-range') {
      operation = playback.playRange(range.playFromMs, range.stopAtMs, playback.selectedRate);
    }

    if (operation !== null) {
      lastPlaybackToggleAtRef.current = acceptedAtMs;
    }

    void operation?.catch((error: unknown) => {
      showPlaybackError(error, token);
    });
  }, [pendingProjectId, showPlaybackError]);

  const handleOpenEditor = useCallback(() => {
    const currentProject = projectRef.current;
    const playback = usePlaybackStore.getState();
    if (
      currentProject === null ||
      playback.command.status === 'pending' ||
      pendingProjectId === currentProject.id ||
      isOpeningEditorRef.current
    ) {
      return;
    }

    const token = focusTokenRef.current;
    isOpeningEditorRef.current = true;
    setIsOpeningEditor(true);
    const pausePromise = playback.pause();
    const pauseCommandId = usePlaybackStore.getState().command.latestId;
    void pausePromise
      .then(() => {
        const latest = usePlaybackStore.getState();
        if (
          isUnmountingRef.current ||
          !isOpeningEditorRef.current ||
          latest.selectedProjectId !== currentProject.id ||
          latest.command.latestId !== pauseCommandId
        ) {
          return;
        }

        router.push({
          pathname: '/project/[projectId]/segments',
          params: {
            projectId: currentProject.id,
            origin: 'practice',
          },
        });
      })
      .catch((error: unknown) => {
        isOpeningEditorRef.current = false;
        if (tokenIsCurrent(token)) {
          setIsOpeningEditor(false);
        }
        showPlaybackError(error, token);
      });
  }, [pendingProjectId, showPlaybackError, tokenIsCurrent]);

  if (!isInitialized && projectStoreError !== null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <EmptyState
            actionLabel={COPY.common.retry}
            message={COPY.projectList.loadErrorMessage}
            onAction={handleRetryProjectLoad}
            title={COPY.projectList.loadErrorTitle}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!isInitialized || isLoadingProjects) {
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
            message={COPY.practice.projectNotFoundMessage}
            onAction={() => router.back()}
            title={COPY.practice.projectNotFoundTitle}
          />
        </View>
      </SafeAreaView>
    );
  }

  const displayRate = selectedProjectId === project.id ? selectedRate : project.preferredRate;
  const showRetry =
    selectedProjectId === project.id &&
    !commandPending &&
    (snapshot.state === 'idle' || snapshot.state === 'failed');

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={COPY.practice.backAccessibilityLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonLabel}>{'\u2039'}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {project.name}
        </Text>
        <Pressable
          accessibilityLabel={COPY.practice.settingsAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{
            busy: isOpeningEditor,
            disabled: commandPending || preferencePending,
          }}
          disabled={commandPending || preferencePending || isOpeningEditor}
          hitSlop={8}
          onPress={handleOpenEditor}
          style={styles.headerButton}
        >
          <Text style={styles.settingsLabel}>{'\u2699'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeading}>{COPY.practice.speedHeading}</Text>
        <SpeedSelector
          disabled={interactionDisabled}
          onSelectRate={handleSelectRate}
          selectedRate={displayRate}
        />

        <Text style={styles.sectionHeading}>{COPY.practice.segmentsHeading}</Text>
        <SegmentGrid
          durationMs={project.durationMs}
          interactionDisabled={interactionDisabled}
          onSelectSegment={handleSelectSegment}
          segments={project.segments}
          selectedSegment={selectedProjectId === project.id ? selectedSegment : null}
        />

        <View style={styles.statusArea}>
          {selectedRange !== null ? (
            <Text style={styles.statusText}>
              {COPY.practice.rangeSummary(
                formatSegmentTime(selectedRange.playFromMs),
                formatSegmentTime(selectedRange.stopAtMs),
                formatSegmentTime(snapshot.currentTimeMs),
              )}
            </Text>
          ) : (
            <Text style={styles.statusText}>{COPY.practice.noConfiguredSegments}</Text>
          )}

          {commandPending && (command.kind === 'load-audio' || command.kind === 'stop-and-seek') ? (
            <Text style={styles.statusText}>{COPY.practice.loadingAudio}</Text>
          ) : null}

          {showRetry ? (
            <View style={styles.retryArea}>
              <Text style={styles.statusText}>{COPY.practice.audioUnavailable}</Text>
              <AppButton
                label={COPY.practice.retryAudio}
                onPress={handleRetryAudio}
                variant="secondary"
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.playbackArea}>
        <PlaybackButton
          disabled={!playbackEnabled}
          onPress={handleTogglePlayback}
          pending={commandPending && command.kind !== 'set-rate' && command.kind !== 'load-audio'}
          playing={selectedProjectId === project.id && snapshot.state === 'playing'}
        />
      </View>
    </SafeAreaView>
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
    paddingHorizontal: spacing.md,
  },
  headerButton: {
    alignItems: 'center',
    height: minimumTapSize,
    justifyContent: 'center',
    width: minimumTapSize,
  },
  headerButtonLabel: {
    color: colors.accent,
    fontSize: 36,
    lineHeight: 38,
  },
  settingsLabel: {
    color: colors.accent,
    fontSize: 24,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionHeading: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  statusArea: {
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 80,
    paddingTop: spacing.lg,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    textAlign: 'center',
  },
  retryArea: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  playbackArea: {
    alignItems: 'center',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
