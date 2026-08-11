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
import { LeadInSelector } from '@/components/LeadInSelector';
import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { COPY } from '@/constants/copy';
import { DEFAULT_LEAD_IN_MS } from '@/constants/app';
import { colors, fontSizes, fontWeights, minimumTapSize, spacing } from '@/constants/theme';
import {
  calculatePlaybackRange,
  type LeadInMs,
  type PlaybackRate,
  type PlaybackRange,
} from '@/domain/playback';
import {
  canTogglePracticePlayback,
  getConfiguredPracticeSegment,
  selectInitialPracticeSegment,
} from '@/domain/practice';
import type { DanceProject } from '@/domain/project';
import type { SegmentIndex } from '@/domain/segment';
import { type TempoLoopPlayerController, useTempoLoopPlayer } from '@/playback/useTempoLoopPlayer';
import { projectRepository } from '@/repositories/ProjectRepository';
import { useProjectStore } from '@/stores/useProjectStore';
import { canAcceptPlaybackToggle } from '@/utils/interaction';
import { navigateBackOrHome } from '@/utils/navigation';

function projectIdFromParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  const first = value?.[0];
  return first !== undefined && first.length > 0 ? first : null;
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === 'E_AUDIO_NOT_FOUND'
    ? COPY.mediaErrors.E_AUDIO_NOT_FOUND
    : COPY.practice.playbackErrorMessage;
}

function deactivateBestEffort(player: TempoLoopPlayerController): void {
  try {
    player.deactivate();
  } catch {
    // The app-level provider may already be disposing during route teardown.
  }
}

export default function PracticeProjectScreen() {
  const params = useLocalSearchParams<{ projectId?: string | string[] }>();
  const projectId = projectIdFromParam(params.projectId);
  const projects = useProjectStore((state) => state.projects);
  const isInitialized = useProjectStore((state) => state.isInitialized);
  const isLoadingProjects = useProjectStore((state) => state.isLoading);
  const initializeProjects = useProjectStore((state) => state.initialize);
  const updateSelectedRate = useProjectStore((state) => state.updateSelectedRate);
  const updateLeadInMs = useProjectStore((state) => state.updateLeadInMs);
  const projectStoreError = useProjectStore((state) => state.error);
  const player = useTempoLoopPlayer();
  const playerRef = useRef(player);
  const projectRef = useRef<DanceProject | null>(null);
  const focusTokenRef = useRef(0);
  const prepareCommandRef = useRef(0);
  const isPreparingSegmentRef = useRef(false);
  const lastPlaybackToggleAtRef = useRef<number | null>(null);
  const initializationRequestedRef = useRef(false);
  const leadInProjectIdRef = useRef<string | null>(null);
  const leadInMsRef = useRef<LeadInMs>(DEFAULT_LEAD_IN_MS);
  const pendingLeadInPreferenceRef = useRef<{
    projectId: string;
    leadInMs: LeadInMs;
  } | null>(null);
  const leadInPersistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SegmentIndex | null>(null);
  const [selectedLeadInMs, setSelectedLeadInMs] = useState<LeadInMs>(DEFAULT_LEAD_IN_MS);
  const [isEntering, setIsEntering] = useState(false);
  const [isPreparingSegment, setIsPreparingSegment] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);

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
    project === null || audioUri === null ? null : `${project.id}\u0000${audioUri}`;

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    projectRef.current = project;
    if (project !== null && leadInProjectIdRef.current !== project.id) {
      leadInProjectIdRef.current = project.id;
      leadInMsRef.current = project.leadInMs;
      setSelectedLeadInMs(project.leadInMs);
    }
  }, [project]);

  useEffect(() => {
    return () => {
      if (leadInPersistenceTimerRef.current !== null) {
        clearTimeout(leadInPersistenceTimerRef.current);
      }
      const pending = pendingLeadInPreferenceRef.current;
      if (pending !== null) {
        void updateLeadInMs(pending.projectId, pending.leadInMs).catch(() => undefined);
      }
    };
  }, [updateLeadInMs]);

  const requestProjectInitialization = useCallback(() => {
    if (initializationRequestedRef.current) {
      return;
    }
    initializationRequestedRef.current = true;
    void initializeProjects().catch(() => {
      // The store exposes this failure and the screen renders an explicit retry.
    });
  }, [initializeProjects]);

  useEffect(() => {
    if (!isInitialized && !isLoadingProjects && projectStoreError === null) {
      requestProjectInitialization();
    }
  }, [isInitialized, isLoadingProjects, projectStoreError, requestProjectInitialization]);

  const tokenIsCurrent = useCallback((token: number) => focusTokenRef.current === token, []);

  const showPlaybackError = useCallback(
    (error: unknown, token: number) => {
      if (tokenIsCurrent(token)) {
        Alert.alert(COPY.practice.playbackErrorTitle, playbackErrorMessage(error));
      }
    },
    [tokenIsCurrent],
  );

  const enterFocusedProject = useCallback(
    async (token: number): Promise<void> => {
      const currentProject = projectRef.current;
      if (currentProject === null) {
        return;
      }

      const currentAudioUri = projectRepository.resolveAudioUri(currentProject);
      const initialSegment = selectInitialPracticeSegment(currentProject);
      setSelectedSegment(initialSegment);
      setAudioLoadFailed(false);
      setIsEntering(true);

      const entered = await playerRef.current.enterPractice(
        {
          projectId: currentProject.id,
          audioUri: currentAudioUri,
          durationMs: currentProject.durationMs,
        },
        currentProject.selectedRate,
      );
      if (!entered || !tokenIsCurrent(token)) {
        if (tokenIsCurrent(token)) {
          setAudioLoadFailed(true);
        }
        return;
      }

      const segment = getConfiguredPracticeSegment(currentProject, initialSegment);
      if (segment === null) {
        return;
      }
      const range = calculatePlaybackRange(segment, leadInMsRef.current);
      const prepared = await playerRef.current.preparePracticeSegment({
        segmentIndex: segment.index,
        clipStartMs: range.playFromMs,
        clipEndMs: range.stopAtMs,
        countdownMs: range.countdownMs,
        rate: currentProject.selectedRate,
      });
      if (!prepared && tokenIsCurrent(token)) {
        setAudioLoadFailed(true);
      }
    },
    [tokenIsCurrent],
  );

  useFocusEffect(
    useCallback(() => {
      const token = focusTokenRef.current + 1;
      focusTokenRef.current = token;
      prepareCommandRef.current += 1;
      isPreparingSegmentRef.current = false;
      setIsOpeningEditor(false);
      setIsPreparingSegment(false);
      setIsToggling(false);

      if (focusLoadKey !== null) {
        void enterFocusedProject(token)
          .catch((error: unknown) => {
            setAudioLoadFailed(true);
            showPlaybackError(error, token);
          })
          .finally(() => {
            if (tokenIsCurrent(token)) {
              setIsEntering(false);
            }
          });
      }

      return () => {
        focusTokenRef.current += 1;
        prepareCommandRef.current += 1;
        deactivateBestEffort(playerRef.current);
      };
    }, [enterFocusedProject, focusLoadKey, showPlaybackError, tokenIsCurrent]),
  );

  const handleRetryProjectLoad = useCallback(() => {
    initializationRequestedRef.current = false;
    requestProjectInitialization();
  }, [requestProjectInitialization]);

  const handleRetryAudio = useCallback(() => {
    if (isEntering) {
      return;
    }
    const token = focusTokenRef.current + 1;
    focusTokenRef.current = token;
    void enterFocusedProject(token)
      .catch((error: unknown) => {
        setAudioLoadFailed(true);
        showPlaybackError(error, token);
      })
      .finally(() => {
        if (tokenIsCurrent(token)) {
          setIsEntering(false);
        }
      });
  }, [enterFocusedProject, isEntering, showPlaybackError, tokenIsCurrent]);

  const handleSelectSegment = useCallback(
    (segmentIndex: SegmentIndex) => {
      const currentProject = projectRef.current;
      if (currentProject === null || isEntering || isOpeningEditor) {
        return;
      }
      const segment = getConfiguredPracticeSegment(currentProject, segmentIndex);
      if (segment === null) {
        return;
      }

      const command = prepareCommandRef.current + 1;
      prepareCommandRef.current = command;
      const token = focusTokenRef.current;
      const range = calculatePlaybackRange(segment, leadInMsRef.current);
      setSelectedSegment(segmentIndex);
      isPreparingSegmentRef.current = true;
      setIsPreparingSegment(true);
      setAudioLoadFailed(false);
      void playerRef.current
        .preparePracticeSegment({
          segmentIndex,
          clipStartMs: range.playFromMs,
          clipEndMs: range.stopAtMs,
          countdownMs: range.countdownMs,
          rate: playerRef.current.snapshot.rate,
        })
        .catch((error: unknown) => {
          showPlaybackError(error, token);
        })
        .finally(() => {
          if (tokenIsCurrent(token) && prepareCommandRef.current === command) {
            isPreparingSegmentRef.current = false;
            setIsPreparingSegment(false);
          }
        });
    },
    [isEntering, isOpeningEditor, showPlaybackError, tokenIsCurrent],
  );

  const handleSelectRate = useCallback(
    (rate: PlaybackRate) => {
      const currentProject = projectRef.current;
      if (
        currentProject === null ||
        isEntering ||
        isPreparingSegmentRef.current ||
        isOpeningEditor ||
        rate === playerRef.current.snapshot.rate ||
        !playerRef.current.setRate(rate)
      ) {
        return;
      }

      const token = focusTokenRef.current;
      void updateSelectedRate(currentProject.id, rate).catch(() => {
        if (tokenIsCurrent(token)) {
          Alert.alert(COPY.practice.preferenceErrorTitle, COPY.practice.preferenceErrorMessage);
        }
      });
    },
    [isEntering, isOpeningEditor, tokenIsCurrent, updateSelectedRate],
  );

  const handleSelectLeadIn = useCallback(
    (leadInMs: LeadInMs) => {
      const currentProject = projectRef.current;
      if (currentProject === null || isEntering || isOpeningEditor) {
        return;
      }

      if (
        playerRef.current.snapshot.status === 'playing' ||
        playerRef.current.snapshot.status === 'countdown'
      ) {
        playerRef.current.pause();
      }

      leadInMsRef.current = leadInMs;
      setSelectedLeadInMs(leadInMs);
      pendingLeadInPreferenceRef.current = { projectId: currentProject.id, leadInMs };
      const token = focusTokenRef.current;
      if (leadInPersistenceTimerRef.current !== null) {
        clearTimeout(leadInPersistenceTimerRef.current);
      }
      leadInPersistenceTimerRef.current = setTimeout(() => {
        leadInPersistenceTimerRef.current = null;
        const pending = pendingLeadInPreferenceRef.current;
        pendingLeadInPreferenceRef.current = null;
        if (pending === null) {
          return;
        }
        void updateLeadInMs(pending.projectId, pending.leadInMs).catch(() => {
          if (tokenIsCurrent(token)) {
            Alert.alert(COPY.practice.preferenceErrorTitle, COPY.practice.preferenceErrorMessage);
          }
        });
      }, 200);
    },
    [isEntering, isOpeningEditor, tokenIsCurrent, updateLeadInMs],
  );

  const configuredSelection =
    project === null ? null : getConfiguredPracticeSegment(project, selectedSegment);
  const selectedRange: PlaybackRange | null =
    configuredSelection === null
      ? null
      : calculatePlaybackRange(configuredSelection, selectedLeadInMs);
  const playerOwnsProject =
    project !== null &&
    player.snapshot.mode === 'practice' &&
    player.snapshot.projectId === project.id;
  const playbackBusy = isEntering || isPreparingSegment || isOpeningEditor || isToggling;
  const playbackEnabled =
    playerOwnsProject &&
    player.snapshot.segmentIndex === selectedSegment &&
    canTogglePracticePlayback(player.snapshot, selectedRange, playbackBusy);

  const handleTogglePlayback = () => {
    if (!playbackEnabled) {
      return;
    }
    const acceptedAtMs = Date.now();
    if (!canAcceptPlaybackToggle(lastPlaybackToggleAtRef.current, acceptedAtMs)) {
      return;
    }
    lastPlaybackToggleAtRef.current = acceptedAtMs;
    const currentProject = projectRef.current;
    const segment =
      currentProject === null
        ? null
        : getConfiguredPracticeSegment(currentProject, selectedSegment);
    if (segment === null) {
      return;
    }
    const wasActive =
      playerRef.current.snapshot.status === 'playing' ||
      playerRef.current.snapshot.status === 'countdown';
    const range = calculatePlaybackRange(segment, leadInMsRef.current);
    const token = focusTokenRef.current;
    const command = prepareCommandRef.current + 1;
    prepareCommandRef.current = command;
    setIsToggling(true);
    void (async () => {
      const prepared = await playerRef.current.preparePracticeSegment({
        segmentIndex: segment.index,
        clipStartMs: range.playFromMs,
        clipEndMs: range.stopAtMs,
        countdownMs: range.countdownMs,
        rate: playerRef.current.snapshot.rate,
      });
      if (
        wasActive ||
        !prepared ||
        !tokenIsCurrent(token) ||
        prepareCommandRef.current !== command
      ) {
        return;
      }
      await playerRef.current.togglePractice();
    })()
      .catch((error: unknown) => {
        showPlaybackError(error, token);
      })
      .finally(() => {
        if (tokenIsCurrent(token) && prepareCommandRef.current === command) {
          setIsToggling(false);
        }
      });
  };

  const handleBack = useCallback(() => {
    playerRef.current.pause();
    navigateBackOrHome();
  }, []);

  const handleOpenEditor = useCallback(() => {
    const currentProject = projectRef.current;
    if (currentProject === null || isOpeningEditor) {
      return;
    }
    playerRef.current.pause();
    setIsOpeningEditor(true);
    router.push({
      pathname: '/project/[projectId]/segments',
      params: { projectId: currentProject.id, origin: 'practice' },
    });
  }, [isOpeningEditor]);

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
            onAction={handleBack}
            title={COPY.practice.projectNotFoundTitle}
          />
        </View>
      </SafeAreaView>
    );
  }

  const displayRate = playerOwnsProject ? player.snapshot.rate : project.selectedRate;
  const showRetry = audioLoadFailed || (playerOwnsProject && player.snapshot.status === 'error');
  const controlsDisabled = !playerOwnsProject || isEntering || isOpeningEditor;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={COPY.practice.backAccessibilityLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleBack}
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
          accessibilityState={{ busy: isOpeningEditor, disabled: isOpeningEditor }}
          disabled={isOpeningEditor}
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
          disabled={controlsDisabled}
          onSelectRate={handleSelectRate}
          selectedRate={displayRate}
        />

        <Text style={[styles.sectionHeading, styles.sectionHeadingSpaced]}>
          {COPY.practice.leadInHeading}
        </Text>
        <LeadInSelector
          disabled={controlsDisabled}
          onSelectLeadIn={handleSelectLeadIn}
          selectedLeadInMs={selectedLeadInMs}
        />

        <Text style={[styles.sectionHeading, styles.sectionHeadingSpaced]}>
          {COPY.practice.segmentsHeading}
        </Text>
        <SegmentGrid
          durationMs={project.durationMs}
          interactionDisabled={controlsDisabled}
          onSelectSegment={handleSelectSegment}
          segments={project.segments}
          selectedSegment={selectedSegment}
        />

        {isEntering || isPreparingSegment || player.snapshot.status === 'loading' || showRetry ? (
          <View style={styles.statusArea}>
            {isEntering || isPreparingSegment || player.snapshot.status === 'loading' ? (
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
        ) : null}
      </ScrollView>

      <View style={styles.playbackArea}>
        <PlaybackButton
          countdownRemainingSeconds={
            playerOwnsProject ? player.snapshot.countdownRemainingSeconds : null
          }
          disabled={!playbackEnabled}
          onPress={handleTogglePlayback}
          pending={isEntering || isPreparingSegment || isToggling}
          playing={playerOwnsProject && player.snapshot.status === 'playing'}
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
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  sectionHeading: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  sectionHeadingSpaced: {
    marginTop: spacing.lg,
  },
  statusArea: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
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
