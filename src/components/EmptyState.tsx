import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, fontSizes, fontWeights, spacing } from '@/constants/theme';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  const showAction = actionLabel !== undefined && onAction !== undefined;

  return (
    <View accessibilityRole="summary" style={styles.container}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.iconRing}>
          <View style={styles.noteStem} />
          <View style={styles.noteHead} />
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {showAction ? (
        <AppButton
          accessibilityLabel={actionLabel}
          label={actionLabel}
          onPress={onAction}
          size="large"
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 360,
    paddingHorizontal: spacing.lg,
  },
  iconRing: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 42,
    borderWidth: StyleSheet.hairlineWidth,
    height: 84,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 84,
  },
  noteStem: {
    backgroundColor: colors.accent,
    borderRadius: 2,
    height: 30,
    left: 8,
    position: 'relative',
    top: -2,
    width: 4,
  },
  noteHead: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    height: 18,
    left: 1,
    position: 'relative',
    top: -8,
    transform: [{ rotate: '-18deg' }],
    width: 22,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  message: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    lineHeight: 23,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.lg,
    minWidth: 180,
  },
});
