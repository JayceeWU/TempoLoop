import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ImportProgressSheet } from '@/components/ImportProgressSheet';
import { ProjectNameSheet } from '@/components/ProjectNameSheet';
import { MAX_VIDEO_BYTES } from '@/constants/app';
import { COPY } from '@/constants/copy';
import {
  colors,
  fontSizes,
  fontWeights,
  minimumTapSize,
  radii,
  shadows,
  spacing,
} from '@/constants/theme';
import type { DanceProject } from '@/domain/project';
import { isSegmentConfigured } from '@/domain/segment';
import { ProjectNameSchema } from '@/domain/validation';
import {
  ImportCoordinatorError,
  type ImportProgressSnapshot,
  type SelectedVideo,
  importCoordinator,
} from '@/services/ImportCoordinator';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppError } from '@/utils/errors';
import { formatBinaryMegabytes } from '@/utils/file';
import { formatDuration } from '@/utils/time';

function configuredSegmentCount(project: DanceProject): number {
  return project.segments.filter(isSegmentConfigured).length;
}

interface ProjectRowProps {
  project: DanceProject;
  isPending: boolean;
  onDelete: (project: DanceProject) => void;
  onPress: (projectId: string) => void;
  onRename: (project: DanceProject) => void;
  onShowActions: (project: DanceProject) => void;
}

function ProjectRow({
  project,
  isPending,
  onDelete,
  onPress,
  onRename,
  onShowActions,
}: ProjectRowProps) {
  const duration = formatDuration(project.durationMs);
  const configuredCount = configuredSegmentCount(project);
  const summary = COPY.projectList.projectSummary(duration, configuredCount);

  return (
    <Pressable
      accessibilityHint={COPY.projectList.projectActionsAccessibilityHint}
      accessibilityLabel={`${project.name}. ${COPY.projectList.projectAccessibilitySummary(
        duration,
        configuredCount,
      )}`}
      accessibilityRole="button"
      accessibilityActions={[
        { name: 'rename', label: COPY.common.rename },
        { name: 'delete', label: COPY.common.delete },
      ]}
      accessibilityState={{ busy: isPending, disabled: isPending }}
      disabled={isPending}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'rename') {
          onRename(project);
        } else if (nativeEvent.actionName === 'delete') {
          onDelete(project);
        }
      }}
      onLongPress={() => onShowActions(project)}
      onPress={() => onPress(project.id)}
      style={({ pressed }) => [styles.projectRow, pressed && styles.projectRowPressed]}
    >
      <View style={styles.projectText}>
        <Text numberOfLines={1} style={styles.projectName}>
          {project.name}
        </Text>
        <Text numberOfLines={1} style={styles.projectSummary}>
          {summary}
        </Text>
      </View>
      <Text accessibilityElementsHidden style={styles.disclosure}>
        {'\u203a'}
      </Text>
    </Pressable>
  );
}

export default function ProjectListScreen() {
  const [selection, setSelection] = useState<SelectedVideo | null>(null);
  const [nameValidationMessage, setNameValidationMessage] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressSnapshot | null>(null);
  const [isSelectingVideo, setIsSelectingVideo] = useState(false);
  const [isCancellingImport, setIsCancellingImport] = useState(false);
  const selectionRequestInFlightRef = useRef(false);
  const importRequestInFlightRef = useRef(false);
  const cancellationRequestInFlightRef = useRef(false);
  const projects = useProjectStore((state) => state.projects);
  const isLoading = useProjectStore((state) => state.isLoading);
  const error = useProjectStore((state) => state.error);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);
  const initialize = useProjectStore((state) => state.initialize);
  const refresh = useProjectStore((state) => state.refresh);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);

  const handleOpenDiagnostics = useCallback(() => {
    if (__DEV__) {
      router.push('/diagnostics');
    }
  }, []);

  const loadProjects = useCallback(() => {
    void initialize().catch(() => {
      // The store exposes the failure through `error`; the screen renders it.
    });
  }, [initialize]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const showImportError = useCallback((error: unknown) => {
    if (error instanceof AppError && error.isCancellation) {
      return;
    }

    if (error instanceof ImportCoordinatorError && error.code === 'E_PHOTO_PERMISSION_DENIED') {
      Alert.alert(COPY.import.permissionTitle, COPY.import.permissionMessage, [
        { style: 'cancel', text: COPY.common.cancel },
        {
          text: COPY.common.settings,
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ]);
      return;
    }

    let message: string = COPY.import.failureMessage;
    if (error instanceof AppError) {
      message = error.userMessage ?? COPY.import.failureMessage;
    } else if (error instanceof ImportCoordinatorError) {
      switch (error.code) {
        case 'E_NOT_A_VIDEO':
          message = COPY.import.notVideoMessage;
          break;
        case 'E_FILE_SIZE_UNAVAILABLE':
          message = COPY.import.sizeUnavailableMessage;
          break;
        case 'E_VIDEO_TOO_LARGE':
          message = COPY.import.videoTooLargeMessage(
            formatBinaryMegabytes(error.details.sizeBytes ?? 0),
            formatBinaryMegabytes(error.details.maxSizeBytes ?? MAX_VIDEO_BYTES),
          );
          break;
        case 'E_INSUFFICIENT_STORAGE':
          message = COPY.import.insufficientStorageMessage;
          break;
        default:
          message = COPY.import.pickerErrorMessage;
      }
    }

    Alert.alert(COPY.import.failureTitle, message);
  }, []);

  const handleImport = useCallback(() => {
    if (
      selectionRequestInFlightRef.current ||
      isSelectingVideo ||
      selection !== null ||
      importProgress !== null ||
      importCoordinator.isImportActive()
    ) {
      return;
    }

    selectionRequestInFlightRef.current = true;
    setIsSelectingVideo(true);
    void importCoordinator
      .selectVideo()
      .then((selectedVideo) => {
        if (selectedVideo !== null) {
          setNameValidationMessage(null);
          setSelection(selectedVideo);
        }
      })
      .catch(showImportError)
      .finally(() => {
        selectionRequestInFlightRef.current = false;
        setIsSelectingVideo(false);
      });
  }, [importProgress, isSelectingVideo, selection, showImportError]);

  const handleCancelNaming = useCallback(() => {
    if (selection !== null) {
      importCoordinator.discardSelection(selection);
    }
    setSelection(null);
    setNameValidationMessage(null);
  }, [selection]);

  const handleConfirmImport = useCallback(
    (name: string) => {
      if (
        selection === null ||
        importRequestInFlightRef.current ||
        importCoordinator.isImportActive()
      ) {
        return;
      }

      const parsedName = ProjectNameSchema.safeParse(name);
      if (!parsedName.success) {
        setNameValidationMessage(COPY.import.invalidName);
        return;
      }

      importRequestInFlightRef.current = true;
      setNameValidationMessage(null);
      setImportProgress({
        taskId: 'preparing',
        phase: 'preparing',
        progress: 0,
      });

      void (async () => {
        let project: DanceProject;
        try {
          project = await importCoordinator.importProject({
            selection,
            name: parsedName.data,
            onProgress: setImportProgress,
          });
        } catch (error) {
          showImportError(error);
          return;
        }

        try {
          await refresh();
          router.replace({
            pathname: '/project/[projectId]',
            params: { projectId: project.id },
          });
        } catch {
          Alert.alert(COPY.import.postCommitTitle, COPY.import.postCommitMessage);
        }
      })().finally(() => {
        importRequestInFlightRef.current = false;
        setSelection(null);
        setImportProgress(null);
        setIsCancellingImport(false);
      });
    },
    [refresh, selection, showImportError],
  );

  const handleCancelImport = useCallback(() => {
    if (cancellationRequestInFlightRef.current || isCancellingImport) {
      return;
    }

    cancellationRequestInFlightRef.current = true;
    setIsCancellingImport(true);
    void importCoordinator
      .cancelActiveImport()
      .catch(showImportError)
      .finally(() => {
        cancellationRequestInFlightRef.current = false;
        setIsCancellingImport(false);
      });
  }, [isCancellingImport, showImportError]);

  const handleOpenProject = useCallback((projectId: string) => {
    router.push({
      pathname: '/project/[projectId]',
      params: { projectId },
    });
  }, []);

  const showActionError = useCallback(() => {
    Alert.alert(COPY.projectList.actionErrorTitle, COPY.projectList.actionErrorMessage);
  }, []);

  const handleRename = useCallback(
    (project: DanceProject) => {
      Alert.prompt(
        COPY.projectList.renameTitle,
        COPY.projectList.renameMessage,
        [
          { style: 'cancel', text: COPY.common.cancel },
          {
            text: COPY.common.rename,
            onPress: (name?: string) => {
              if (name === undefined) {
                return;
              }

              void renameProject(project.id, name).catch(showActionError);
            },
          },
        ],
        'plain-text',
        project.name,
      );
    },
    [renameProject, showActionError],
  );

  const handleDelete = useCallback(
    (project: DanceProject) => {
      Alert.alert(COPY.projectList.deleteTitle(project.name), COPY.projectList.deleteMessage, [
        { style: 'cancel', text: COPY.common.cancel },
        {
          style: 'destructive',
          text: COPY.common.delete,
          onPress: () => {
            void (async () => {
              const playback = usePlaybackStore.getState();
              if (playback.selectedProjectId === project.id) {
                await playback.unload();
              }
              await deleteProject(project.id);
            })().catch(showActionError);
          },
        },
      ]);
    },
    [deleteProject, showActionError],
  );

  const handleShowActions = useCallback(
    (project: DanceProject) => {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: 0,
          destructiveButtonIndex: 2,
          options: [COPY.common.cancel, COPY.common.rename, COPY.common.delete],
          title: COPY.projectList.projectActionsTitle(project.name),
        },
        (selectedIndex) => {
          if (selectedIndex === 1) {
            handleRename(project);
          } else if (selectedIndex === 2) {
            handleDelete(project);
          }
        },
      );
    },
    [handleDelete, handleRename],
  );

  const renderProject = useCallback(
    ({ item }: { item: DanceProject }) => (
      <ProjectRow
        isPending={pendingProjectId === item.id}
        onDelete={handleDelete}
        onPress={handleOpenProject}
        onRename={handleRename}
        onShowActions={handleShowActions}
        project={item}
      />
    ),
    [handleDelete, handleOpenProject, handleRename, handleShowActions, pendingProjectId],
  );

  const emptyContent = isLoading ? (
    <View
      accessibilityLabel={COPY.projectList.loading}
      accessibilityRole="progressbar"
      style={styles.centeredState}
    >
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.loadingText}>{COPY.projectList.loading}</Text>
    </View>
  ) : error ? (
    <View style={styles.centeredState}>
      <EmptyState
        actionLabel={COPY.common.retry}
        message={COPY.projectList.loadErrorMessage}
        onAction={loadProjects}
        title={COPY.projectList.loadErrorTitle}
      />
    </View>
  ) : (
    <View style={styles.centeredState}>
      <EmptyState
        actionLabel={COPY.projectList.emptyAction}
        message={COPY.projectList.emptyMessage}
        onAction={handleImport}
        title={COPY.projectList.emptyTitle}
      />
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text
          accessibilityHint={__DEV__ ? COPY.diagnostics.entryAccessibilityHint : undefined}
          accessibilityLabel={COPY.projectList.headingAccessibilityLabel}
          accessibilityRole="header"
          onLongPress={__DEV__ ? handleOpenDiagnostics : undefined}
          style={styles.heading}
        >
          {COPY.appName}
        </Text>
        <Pressable
          accessibilityLabel={COPY.projectList.addProjectAccessibilityLabel}
          accessibilityRole="button"
          disabled={isLoading || isSelectingVideo || importProgress !== null}
          hitSlop={4}
          onPress={handleImport}
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.addButtonPressed,
            (isLoading || isSelectingVideo || importProgress !== null) && styles.addButtonDisabled,
          ]}
        >
          <Text accessibilityElementsHidden style={styles.addButtonLabel}>
            +
          </Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          projects.length === 0 && styles.emptyListContent,
        ]}
        data={projects}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(project) => project.id}
        ListEmptyComponent={emptyContent}
        renderItem={renderProject}
        showsVerticalScrollIndicator={false}
      />

      {selection !== null ? (
        <ProjectNameSheet
          key={selection.uri}
          cancelLabel={COPY.common.cancel}
          confirmLabel={COPY.import.confirmLabel}
          initialName={selection.suggestedName}
          inputLabel={COPY.import.nameInputLabel}
          message={COPY.import.namingMessage}
          onCancel={handleCancelNaming}
          onConfirm={handleConfirmImport}
          title={COPY.import.namingTitle}
          validationMessage={nameValidationMessage}
          visible={importProgress === null}
        />
      ) : null}

      <ImportProgressSheet
        cancelLabel={isCancellingImport ? COPY.import.cancelling : COPY.import.cancelLabel}
        isCancelling={isCancellingImport}
        keepOpenMessage={COPY.import.keepOpen}
        onCancel={handleCancelImport}
        phaseLabel={
          importProgress === null ? COPY.import.preparing : COPY.import[importProgress.phase]
        }
        progress={importProgress?.progress ?? null}
        title={COPY.import.title}
        visible={importProgress !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    letterSpacing: -0.8,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: 52,
    justifyContent: 'center',
    minHeight: minimumTapSize,
    minWidth: minimumTapSize,
    width: 52,
  },
  addButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  addButtonDisabled: {
    backgroundColor: colors.disabledBackground,
  },
  addButtonLabel: {
    color: colors.textOnAccent,
    fontSize: 34,
    fontWeight: fontWeights.medium,
    lineHeight: 36,
    marginTop: -2,
  },
  listContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  centeredState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 80,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    marginTop: spacing.sm,
  },
  projectRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  projectRowPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: 0.995 }],
  },
  projectText: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: fontWeights.semibold,
    lineHeight: 24,
  },
  projectSummary: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  disclosure: {
    color: colors.textMuted,
    fontSize: 28,
    marginLeft: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
});
