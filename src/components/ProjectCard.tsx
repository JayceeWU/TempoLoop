import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, shadows, spacing } from '@/constants/theme';
import type { DanceProject } from '@/domain/project';
import { derivePracticeRanges, isPracticeRangeConfigured } from '@/domain/segment';
import type { ProjectMediaStatus, ProjectRepairIssue } from '@/services/RecoveryService';
import { formatDuration } from '@/utils/time';

const CARD_ACTION_SIZE = 48;

function availablePracticeRangeCount(project: DanceProject): number {
  return derivePracticeRanges(project.practiceMarkers, project.durationMs).filter(
    isPracticeRangeConfigured,
  ).length;
}

function repairIssueMessage(issue: ProjectRepairIssue): string {
  switch (issue) {
    case 'AUDIO_MISSING_OR_EMPTY':
      return COPY.projectList.repairAudioMissing;
    case 'WAVEFORM_MISSING':
      return COPY.projectList.repairWaveformMissing;
    case 'WAVEFORM_INVALID':
      return COPY.projectList.repairWaveformInvalid;
    case 'WAVEFORM_DURATION_MISMATCH':
      return COPY.projectList.repairWaveformDurationMismatch;
  }
}

function repairReason(status: ProjectMediaStatus): string {
  const reason = status.issues.map(repairIssueMessage).join(' ');
  return reason || COPY.projectList.repairUnknownReason;
}

export interface ProjectCardProps {
  project: DanceProject;
  mediaStatus: ProjectMediaStatus | null;
  isPending: boolean;
  onDelete(project: DanceProject): void;
  onOpen(projectId: string): void;
  onShowActions(project: DanceProject): void;
}

function ProjectCardComponent({
  project,
  mediaStatus,
  isPending,
  onDelete,
  onOpen,
  onShowActions,
}: ProjectCardProps) {
  const duration = formatDuration(project.durationMs);
  const configuredCount = availablePracticeRangeCount(project);

  if (mediaStatus?.state === 'needs-repair') {
    return (
      <View
        accessibilityLabel={`${project.name}. ${COPY.projectList.repairStatus}. ${repairReason(
          mediaStatus,
        )}`}
        accessibilityState={{ busy: isPending }}
        style={[styles.card, styles.repairCard]}
      >
        <View style={styles.projectText}>
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
          <Text style={styles.repairStatus}>{COPY.projectList.repairStatus}</Text>
          <Text style={styles.repairReason}>{repairReason(mediaStatus)}</Text>
        </View>
        <Pressable
          accessibilityHint={COPY.projectList.repairDeleteAccessibilityHint}
          accessibilityLabel={COPY.projectList.repairDeleteAccessibilityLabel(project.name)}
          accessibilityRole="button"
          accessibilityState={{ busy: isPending, disabled: isPending }}
          disabled={isPending}
          hitSlop={4}
          onPress={() => onDelete(project)}
          style={({ pressed }) => [
            styles.repairDeleteButton,
            pressed && styles.repairDeleteButtonPressed,
            isPending && styles.disabledButton,
          ]}
        >
          <Text style={styles.repairDeleteLabel}>{COPY.common.delete}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityHint={COPY.projectList.projectOpenAccessibilityHint}
        accessibilityLabel={`${project.name}. ${COPY.projectList.projectAccessibilitySummary(
          duration,
          configuredCount,
        )}`}
        accessibilityRole="button"
        accessibilityState={{ busy: isPending, disabled: isPending }}
        disabled={isPending}
        onPress={() => onOpen(project.id)}
        style={({ pressed }) => [styles.openArea, pressed && styles.cardPressed]}
      >
        <View style={styles.projectText}>
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
          <Text numberOfLines={1} style={styles.projectSummary}>
            {COPY.projectList.projectSummary(duration, configuredCount)}
          </Text>
          {project.waveformStatus !== 'ready' ? (
            <Text numberOfLines={1} style={styles.waveformStatus}>
              {COPY.projectList.waveformStatus[project.waveformStatus]}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={COPY.projectList.projectMenuAccessibilityLabel(project.name)}
        accessibilityRole="button"
        accessibilityState={{ busy: isPending, disabled: isPending }}
        disabled={isPending}
        hitSlop={4}
        onPress={() => onShowActions(project)}
        style={({ pressed }) => [
          styles.menuButton,
          pressed && styles.menuButtonPressed,
          isPending && styles.disabledButton,
        ]}
      >
        <Text accessibilityElementsHidden style={styles.menuLabel}>
          {'\u22ee'}
        </Text>
      </Pressable>
    </View>
  );
}

export const ProjectCard = memo(ProjectCardComponent);

const styles = StyleSheet.create({
  card: {
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 96,
    overflow: 'hidden',
    ...shadows.card,
  },
  openArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.surfacePressed,
  },
  repairCard: {
    alignItems: 'center',
    borderColor: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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
  waveformStatus: {
    color: colors.accent,
    fontSize: fontSizes.caption,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  menuButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CARD_ACTION_SIZE,
    minWidth: CARD_ACTION_SIZE,
  },
  menuButtonPressed: {
    backgroundColor: colors.surfacePressed,
  },
  menuLabel: {
    color: colors.textMuted,
    fontSize: 28,
    lineHeight: 32,
  },
  repairStatus: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  repairReason: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  repairDeleteButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    marginLeft: spacing.md,
    minHeight: CARD_ACTION_SIZE,
    paddingHorizontal: spacing.sm,
  },
  repairDeleteButtonPressed: {
    backgroundColor: colors.surfacePressed,
  },
  repairDeleteLabel: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
