import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';

export interface PlaybackButtonProps {
  readonly playing: boolean;
  readonly disabled: boolean;
  readonly pending?: boolean;
  readonly onPress: () => void;
}

export function PlaybackButton({
  playing,
  disabled,
  pending = false,
  onPress,
}: PlaybackButtonProps) {
  const label = playing ? COPY.practice.pause : COPY.practice.play;
  const accessibilityLabel = playing
    ? COPY.practice.pauseAccessibilityLabel
    : COPY.practice.playAccessibilityLabel;
  const isDisabled = disabled || pending;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !isDisabled && styles.pressedButton,
        isDisabled && styles.disabledButton,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={colors.textOnAccent} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: 88,
    minWidth: 88,
    paddingHorizontal: spacing.lg,
  },
  pressedButton: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  disabledButton: {
    backgroundColor: colors.disabledBackground,
  },
  label: {
    color: colors.textOnAccent,
    fontSize: fontSizes.button,
    fontWeight: fontWeights.bold,
  },
});
