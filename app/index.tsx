import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { ImportProgressSheet } from '@/components/ImportProgressSheet';
import { ProjectActionsSheet } from '@/components/ProjectActionsSheet';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectNameSheet } from '@/components/ProjectNameSheet';
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from '@/constants/app';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, spacing } from '@/constants/theme';
import type { DanceProject } from '@/domain/project';
import { ProjectNameSchema } from '@/domain/validation';
import { clearProjectPlaybackSource } from '@/playback/PlaybackSourceLifecycle';
import {
  ImportCoordinatorError,
  type SelectedMedia,
  importCoordinator,
} from '@/services/ImportCoordinator';
import { TempoLoopMediaServiceError } from '@/services/TempoLoopMediaService';
import { useImportStore } from '@/stores/useImportStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { formatBinaryMegabytes } from '@/utils/file';
import type { ImportStage } from '../modules/tempoloop-media';

function isCancellation(error: unknown): boolean {
  return (
    (error instanceof TempoLoopMediaServiceError && error.isCancellation) ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_IMPORT_CANCELLED')
  );
}

function importErrorMessage(error: unknown): string {
  if (error instanceof TempoLoopMediaServiceError) {
    return error.userMessage ?? COPY.import.failureMessage;
  }

  if (error instanceof ImportCoordinatorError) {
    switch (error.code) {
      case 'E_AUDIO_TOO_LARGE':
        return COPY.import.audioTooLargeMessage(
          formatBinaryMegabytes(error.details.sizeBytes ?? 0),
          formatBinaryMegabytes(error.details.maxSizeBytes ?? MAX_AUDIO_BYTES),
        );
      case 'E_VIDEO_TOO_LARGE':
        return COPY.import.videoTooLargeMessage(
          formatBinaryMegabytes(error.details.sizeBytes ?? 0),
          formatBinaryMegabytes(error.details.maxSizeBytes ?? MAX_VIDEO_BYTES),
        );
      default:
        return COPY.import.pickerErrorMessage;
    }
  }

  return COPY.import.failureMessage;
}

function progressPhaseLabel(stage: ImportStage | null): string {
  if (stage === null) {
    return COPY.import.preparing;
  }

  switch (stage) {
    case 'inspecting':
      return COPY.import.inspecting;
    case 'exporting':
      return COPY.import.exporting;
    case 'waveform':
      return COPY.import.waveform;
    case 'finalizing':
      return COPY.import.finalizing;
  }
}

export default function ProjectListScreen() {
  const [nameValidationMessage, setNameValidationMessage] = useState<string | null>(null);
  const [actionProject, setActionProject] = useState<DanceProject | null>(null);
  const [renameProjectTarget, setRenameProjectTarget] = useState<DanceProject | null>(null);
  const [renameValidationMessage, setRenameValidationMessage] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const selectionRequestInFlightRef = useRef(false);
  const importRequestInFlightRef = useRef(false);
  const cancellationRequestInFlightRef = useRef(false);
  const renameRequestInFlightRef = useRef(false);
  const deleteConfirmationProjectIdRef = useRef<string | null>(null);

  const importStatus = useImportStore((state) => state.status);
  const importSelectionId = useImportStore((state) => state.selectionId);
  const importSourceUri = useImportStore((state) => state.sourceUri);
  const importSourceMetadata = useImportStore((state) => state.sourceMetadata);
  const importSuggestedName = useImportStore((state) => state.suggestedName);
  const importStage = useImportStore((state) => state.stage);
  const importStageProgress = useImportStore((state) => state.stageProgress);
  const importOverallProgress = useImportStore((state) => state.overallProgress);
  const importCancelRequested = useImportStore((state) => state.cancelRequested);

  const selection = useMemo<SelectedMedia | null>(() => {
    if (
      importStatus !== 'selected' ||
      importSelectionId === null ||
      importSourceUri === null ||
      importSourceMetadata === null ||
      importSuggestedName === null
    ) {
      return null;
    }

    return {
      selectionId: importSelectionId,
      sourceKindHint: importSourceMetadata.sourceKindHint,
      uri: importSourceUri,
      sizeBytes: importSourceMetadata.sizeBytes,
      mimeType: importSourceMetadata.mimeType,
      fileName: importSourceMetadata.displayName,
      suggestedName: importSuggestedName,
    };
  }, [importSelectionId, importSourceMetadata, importSourceUri, importStatus, importSuggestedName]);

  const projects = useProjectStore((state) => state.projects);
  const isLoading = useProjectStore((state) => state.isLoading);
  const error = useProjectStore((state) => state.error);
  const pendingProjectId = useProjectStore((state) => state.pendingProjectId);
  const mediaStatusByProjectId = useProjectStore((state) => state.mediaStatusByProjectId);
  const initialize = useProjectStore((state) => state.initialize);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);

  const handleOpenDiagnostics = useCallback(() => {
    if (__DEV__) {
      router.push('/diagnostics');
    }
  }, []);

  const loadProjects = useCallback(() => {
    void initialize().catch(() => {
      // The store exposes a centralized, non-sensitive error state.
    });
  }, [initialize]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const showImportError = useCallback((caught: unknown) => {
    if (isCancellation(caught)) {
      return;
    }

    Alert.alert(COPY.import.failureTitle, importErrorMessage(caught));
  }, []);

  const importUiActive =
    importStatus === 'selecting' ||
    importStatus === 'selected' ||
    importStatus === 'importing' ||
    importStatus === 'cancelling';
  const importProgressVisible = importStatus === 'importing' || importStatus === 'cancelling';
  const displayedProgress = importOverallProgress ?? importStageProgress;

  const beginSelection = useCallback(
    (select: () => Promise<SelectedMedia | null>) => {
      if (
        selectionRequestInFlightRef.current ||
        selection !== null ||
        importUiActive ||
        importCoordinator.isImportActive()
      ) {
        return;
      }

      selectionRequestInFlightRef.current = true;
      void select()
        .then((selectedMedia) => {
          if (selectedMedia !== null) {
            setNameValidationMessage(null);
          }
        })
        .catch(showImportError)
        .finally(() => {
          selectionRequestInFlightRef.current = false;
        });
    },
    [importUiActive, selection, showImportError],
  );

  const handleExtractFromVideo = useCallback(() => {
    beginSelection(() => importCoordinator.selectVideoFromGallery());
  }, [beginSelection]);

  const handleImportAudio = useCallback(() => {
    beginSelection(() => importCoordinator.selectAudio());
  }, [beginSelection]);

  const handleCancelNaming = useCallback(() => {
    if (selection !== null) {
      importCoordinator.discardSelection(selection);
    }
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

      void (async () => {
        let project: DanceProject;
        try {
          project = await importCoordinator.importProject({
            selection,
            name: parsedName.data,
          });
        } catch (caught) {
          if (
            caught instanceof ImportCoordinatorError &&
            caught.code === 'E_POST_COMMIT_REFRESH_FAILED'
          ) {
            Alert.alert(COPY.import.postCommitTitle, COPY.import.postCommitMessage);
            return;
          }
          showImportError(caught);
          return;
        }

        try {
          router.replace({
            pathname: '/project/[projectId]',
            params: { projectId: project.id },
          });
        } catch {
          Alert.alert(COPY.import.postCommitTitle, COPY.import.postCommitMessage);
        }
      })().finally(() => {
        importRequestInFlightRef.current = false;
      });
    },
    [selection, showImportError],
  );

  const handleCancelImport = useCallback(() => {
    if (cancellationRequestInFlightRef.current || importCancelRequested) {
      return;
    }

    cancellationRequestInFlightRef.current = true;
    void importCoordinator
      .cancelActiveImport()
      .catch(showImportError)
      .finally(() => {
        cancellationRequestInFlightRef.current = false;
      });
  }, [importCancelRequested, showImportError]);

  const handleOpenProject = useCallback((projectId: string) => {
    router.push({
      pathname: '/project/[projectId]',
      params: { projectId },
    });
  }, []);

  const showActionError = useCallback(() => {
    Alert.alert(COPY.projectList.actionErrorTitle, COPY.projectList.actionErrorMessage);
  }, []);

  const handleShowActions = useCallback((project: DanceProject) => {
    setActionProject((current) => current ?? project);
  }, []);

  const handleDismissActions = useCallback(() => {
    setActionProject(null);
  }, []);

  const handleStartRename = useCallback((project: DanceProject) => {
    setActionProject(null);
    setRenameValidationMessage(null);
    setRenameProjectTarget(project);
  }, []);

  const handleCancelRename = useCallback(() => {
    if (!renameRequestInFlightRef.current) {
      setRenameProjectTarget(null);
      setRenameValidationMessage(null);
    }
  }, []);

  const handleConfirmRename = useCallback(
    (name: string) => {
      if (renameProjectTarget === null || renameRequestInFlightRef.current) {
        return;
      }

      const parsedName = ProjectNameSchema.safeParse(name);
      if (!parsedName.success) {
        setRenameValidationMessage(COPY.import.invalidName);
        return;
      }

      renameRequestInFlightRef.current = true;
      setIsRenaming(true);
      setRenameValidationMessage(null);
      void renameProject(renameProjectTarget.id, parsedName.data)
        .then(() => {
          setRenameProjectTarget(null);
        })
        .catch(showActionError)
        .finally(() => {
          renameRequestInFlightRef.current = false;
          setIsRenaming(false);
        });
    },
    [renameProject, renameProjectTarget, showActionError],
  );

  const handleDelete = useCallback(
    (project: DanceProject) => {
      if (deleteConfirmationProjectIdRef.current !== null || pendingProjectId === project.id) {
        return;
      }

      setActionProject(null);
      deleteConfirmationProjectIdRef.current = project.id;
      const clearConfirmationGuard = () => {
        if (deleteConfirmationProjectIdRef.current === project.id) {
          deleteConfirmationProjectIdRef.current = null;
        }
      };

      Alert.alert(
        COPY.projectList.deleteTitle(project.name),
        COPY.projectList.deleteMessage,
        [
          {
            onPress: clearConfirmationGuard,
            style: 'cancel',
            text: COPY.common.cancel,
          },
          {
            onPress: () => {
              clearConfirmationGuard();
              void (async () => {
                await clearProjectPlaybackSource(project.id);
                await deleteProject(project.id);
              })().catch(showActionError);
            },
            style: 'destructive',
            text: COPY.common.delete,
          },
        ],
        {
          cancelable: true,
          onDismiss: clearConfirmationGuard,
        },
      );
    },
    [deleteProject, pendingProjectId, showActionError],
  );

  const renderProject = useCallback(
    ({ item }: { item: DanceProject }) => (
      <ProjectCard
        isPending={pendingProjectId === item.id}
        mediaStatus={mediaStatusByProjectId[item.id] ?? null}
        onDelete={handleDelete}
        onOpen={handleOpenProject}
        onShowActions={handleShowActions}
        project={item}
      />
    ),
    [handleDelete, handleOpenProject, handleShowActions, mediaStatusByProjectId, pendingProjectId],
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
      <EmptyState message={COPY.projectList.emptyMessage} title={COPY.projectList.emptyTitle} />
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
      </View>

      <View style={styles.importActions}>
        <AppButton
          accessibilityHint={COPY.projectList.extractVideoAccessibilityHint}
          disabled={isLoading || importUiActive}
          fullWidth
          label={COPY.projectList.extractVideo}
          onPress={handleExtractFromVideo}
          size="large"
        />
        <AppButton
          accessibilityHint={COPY.projectList.importAudioAccessibilityHint}
          disabled={isLoading || importUiActive}
          fullWidth
          label={COPY.projectList.importAudio}
          onPress={handleImportAudio}
          size="large"
          variant="secondary"
        />
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
          key={selection.selectionId}
          cancelLabel={COPY.common.cancel}
          confirmLabel={COPY.import.confirmLabel}
          initialName={selection.suggestedName}
          inputLabel={COPY.import.nameInputLabel}
          message={COPY.import.namingMessage}
          onCancel={handleCancelNaming}
          onConfirm={handleConfirmImport}
          title={COPY.import.namingTitle}
          validationMessage={nameValidationMessage}
          visible={importStatus === 'selected'}
        />
      ) : null}

      <ImportProgressSheet
        cancelLabel={importCancelRequested ? COPY.import.cancelling : COPY.import.cancelLabel}
        isCancelling={importCancelRequested}
        keepOpenMessage={COPY.import.keepOpen}
        onCancel={handleCancelImport}
        phaseLabel={progressPhaseLabel(importStage)}
        progress={displayedProgress}
        title={COPY.import.title}
        visible={importProgressVisible}
      />

      <ProjectActionsSheet
        cancelLabel={COPY.common.cancel}
        deleteLabel={COPY.common.delete}
        onCancel={handleDismissActions}
        onDelete={() => {
          if (actionProject !== null) {
            handleDelete(actionProject);
          }
        }}
        onRename={() => {
          if (actionProject !== null) {
            handleStartRename(actionProject);
          }
        }}
        projectName={actionProject?.name ?? ''}
        renameLabel={COPY.common.rename}
        title={
          actionProject === null
            ? COPY.projectList.projectActionsTitle('')
            : COPY.projectList.projectActionsTitle(actionProject.name)
        }
        visible={actionProject !== null}
      />

      {renameProjectTarget !== null ? (
        <ProjectNameSheet
          key={`rename-${renameProjectTarget.id}`}
          cancelLabel={COPY.common.cancel}
          confirmLabel={COPY.common.rename}
          initialName={renameProjectTarget.name}
          inputLabel={COPY.import.nameInputLabel}
          isBusy={isRenaming}
          message={COPY.projectList.renameMessage}
          onCancel={handleCancelRename}
          onConfirm={handleConfirmRename}
          title={COPY.projectList.renameTitle}
          validationMessage={renameValidationMessage}
          visible
        />
      ) : null}
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
  importActions: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
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
  separator: {
    height: spacing.sm,
  },
});
