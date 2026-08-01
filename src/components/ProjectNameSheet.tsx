import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';
import { ProjectNameSchema } from '@/domain/validation';

export interface ProjectNameSheetProps {
  visible: boolean;
  initialName: string;
  title: string;
  message: string;
  inputLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  validationMessage?: string | null;
  isBusy?: boolean;
  onCancel(): void;
  onConfirm(name: string): void;
}

export function ProjectNameSheet({
  visible,
  initialName,
  title,
  message,
  inputLabel,
  cancelLabel,
  confirmLabel,
  validationMessage,
  isBusy = false,
  onCancel,
  onConfirm,
}: ProjectNameSheetProps) {
  const [name, setName] = useState(initialName);
  const isNameValid = useMemo(() => ProjectNameSchema.safeParse(name).success, [name]);

  const submit = () => {
    if (!isBusy && isNameValid) {
      onConfirm(name);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={isBusy ? undefined : onCancel}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          style={styles.keyboardView}
        >
          <View style={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.message}>{message}</Text>

            <Text style={styles.inputLabel}>{inputLabel}</Text>
            <TextInput
              accessibilityLabel={inputLabel}
              autoCapitalize="sentences"
              autoCorrect={false}
              editable={!isBusy}
              onChangeText={setName}
              onSubmitEditing={submit}
              returnKeyType="done"
              selectTextOnFocus
              style={[styles.input, validationMessage ? styles.inputInvalid : null]}
              value={name}
            />
            {validationMessage ? (
              <Text accessibilityRole="alert" style={styles.validation}>
                {validationMessage}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <AppButton
                disabled={isBusy}
                label={cancelLabel}
                onPress={onCancel}
                variant="secondary"
              />
              <AppButton
                disabled={!isNameValid}
                label={confirmLabel}
                loading={isBusy}
                onPress={submit}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
  },
  message: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    lineHeight: 23,
    marginTop: spacing.sm,
  },
  inputLabel: {
    color: colors.text,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
    marginBottom: spacing.xs,
    marginTop: spacing.xl,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSizes.body,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  validation: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
});
