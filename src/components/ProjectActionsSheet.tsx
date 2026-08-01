import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';

export interface ProjectActionsSheetProps {
  visible: boolean;
  projectName: string;
  title: string;
  renameLabel: string;
  deleteLabel: string;
  cancelLabel: string;
  onRename(): void;
  onDelete(): void;
  onCancel(): void;
}

export function ProjectActionsSheet({
  visible,
  projectName,
  title,
  renameLabel,
  deleteLabel,
  cancelLabel,
  onRename,
  onDelete,
  onCancel,
}: ProjectActionsSheetProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable accessible={false} onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View
          accessibilityLabel={`${title}. ${projectName}`}
          accessibilityViewIsModal
          style={styles.sheet}
        >
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          <Text numberOfLines={2} style={styles.projectName}>
            {projectName}
          </Text>
          <View style={styles.actions}>
            <AppButton fullWidth label={renameLabel} onPress={onRename} variant="secondary" />
            <AppButton fullWidth label={deleteLabel} onPress={onDelete} variant="danger" />
            <AppButton fullWidth label={cancelLabel} onPress={onCancel} variant="ghost" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
  },
  projectName: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    marginTop: spacing.xxs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
