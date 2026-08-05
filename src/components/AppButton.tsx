import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, fontSizes, fontWeights, minimumTapSize, radii, spacing } from '@/constants/theme';

type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type AppButtonSize = 'compact' | 'regular' | 'large';

export interface AppButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingAccessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  label,
  variant = 'primary',
  size = 'regular',
  loading = false,
  fullWidth = false,
  disabled = false,
  leadingAccessory,
  accessibilityLabel = label,
  style,
  ...pressableProps
}: AppButtonProps) {
  const selectedVariant = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' && styles.compact,
        size === 'large' && styles.large,
        selectedVariant.button,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && selectedVariant.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={selectedVariant.spinner} />
      ) : (
        <>
          {leadingAccessory}
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              size === 'compact' && styles.compactLabel,
              selectedVariant.label,
              isDisabled && styles.disabledLabel,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minimumTapSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  large: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
  },
  compact: {
    borderRadius: radii.sm,
    minHeight: minimumTapSize,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    backgroundColor: colors.accentPressed,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryPressed: {
    backgroundColor: colors.surfacePressed,
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostPressed: {
    backgroundColor: colors.surfacePressed,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  dangerPressed: {
    backgroundColor: colors.dangerPressed,
  },
  disabled: {
    backgroundColor: colors.disabledBackground,
    borderColor: colors.disabledBackground,
    opacity: 1,
  },
  label: {
    fontSize: fontSizes.button,
    fontWeight: fontWeights.semibold,
  },
  compactLabel: {
    fontSize: fontSizes.caption,
  },
  lightLabel: {
    color: colors.textOnAccent,
  },
  darkLabel: {
    color: colors.text,
  },
  accentLabel: {
    color: colors.accent,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
});

const variantStyles = {
  primary: {
    button: styles.primaryButton,
    pressed: styles.primaryPressed,
    label: styles.lightLabel,
    spinner: colors.textOnAccent,
  },
  secondary: {
    button: styles.secondaryButton,
    pressed: styles.secondaryPressed,
    label: styles.darkLabel,
    spinner: colors.accent,
  },
  ghost: {
    button: styles.ghostButton,
    pressed: styles.ghostPressed,
    label: styles.accentLabel,
    spinner: colors.accent,
  },
  danger: {
    button: styles.dangerButton,
    pressed: styles.dangerPressed,
    label: styles.lightLabel,
    spinner: colors.textOnAccent,
  },
} satisfies Record<
  AppButtonVariant,
  {
    button: ViewStyle;
    pressed: ViewStyle;
    label: object;
    spinner: string;
  }
>;
