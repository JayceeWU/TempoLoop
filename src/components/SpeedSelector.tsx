import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';
import { PLAYBACK_RATES, type PlaybackRate } from '@/domain/playback';

export interface SpeedSelectorProps {
  readonly selectedRate: PlaybackRate;
  readonly disabled?: boolean;
  readonly onSelectRate: (rate: PlaybackRate) => void;
}

export function playbackRateLabel(rate: PlaybackRate): string {
  return `${rate.toFixed(1)}x`;
}

export function SpeedSelector({
  selectedRate,
  disabled = false,
  onSelectRate,
}: SpeedSelectorProps) {
  return (
    <View accessibilityRole="radiogroup" style={styles.row}>
      {PLAYBACK_RATES.map((rate) => {
        const isSelected = rate === selectedRate;
        const label = playbackRateLabel(rate);

        return (
          <Pressable
            accessibilityLabel={COPY.practice.speedAccessibilityLabel(label)}
            accessibilityRole="radio"
            accessibilityState={{
              checked: isSelected,
              disabled,
            }}
            disabled={disabled}
            key={rate}
            onPress={() => onSelectRate(rate)}
            style={({ pressed }) => [
              styles.button,
              isSelected && styles.selectedButton,
              pressed && !disabled && styles.pressedButton,
              disabled && styles.disabledButton,
            ]}
          >
            <Text
              style={[
                styles.label,
                isSelected && styles.selectedLabel,
                disabled && styles.disabledLabel,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minHeight: 60,
    minWidth: 0,
    paddingHorizontal: spacing.xxs,
  },
  selectedButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pressedButton: {
    backgroundColor: colors.surfacePressed,
  },
  disabledButton: {
    opacity: 0.65,
  },
  label: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
  },
  selectedLabel: {
    color: colors.textOnAccent,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
});
