import { StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';

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
          <View style={styles.iconHalo}>
            <Svg height={48} testID="empty-state-music-icon" viewBox="0 0 48 48" width={48}>
              <Path
                d="M17 34V14L38 10V29"
                fill="none"
                stroke={colors.accent}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={4}
              />
              <Ellipse
                cx={12.5}
                cy={36}
                fill={colors.accent}
                rx={7.5}
                ry={5.5}
                transform="rotate(-14 12.5 36)"
              />
              <Ellipse
                cx={33.5}
                cy={31}
                fill={colors.accent}
                rx={7.5}
                ry={5.5}
                transform="rotate(-14 33.5 31)"
              />
            </Svg>
          </View>
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
    borderRadius: 46,
    borderWidth: 1,
    height: 92,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 92,
  },
  iconHalo: {
    alignItems: 'center',
    backgroundColor: colors.accentTranslucent,
    borderRadius: 31,
    height: 62,
    justifyContent: 'center',
    width: 62,
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
