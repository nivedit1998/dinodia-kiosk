import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../ui/theme';
import { PrimaryButton } from './ui/PrimaryButton';

type Props = {
  visible: boolean;
  checking: boolean;
  result: 'idle' | 'checking' | 'success' | 'error';
  onCancel: () => void;
  onConfirm: () => void;
};

export function CloudModePrompt({ visible, checking, result, onCancel, onConfirm }: Props) {
  const showChecking = result === 'checking';
  const showSuccess = result === 'success';
  const showError = result === 'error';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={checking ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={checking ? undefined : onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>Move to Cloud mode?</Text>
          <Text style={styles.subtitle}>
            Control your devices from anywhere in the world.
          </Text>
          {showChecking ? (
            <View style={styles.checkRow}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.checkText}>
                checking if remote access is enabled for this home
              </Text>
            </View>
          ) : null}
          {showSuccess ? (
            <View style={styles.checkRow}>
              <View style={[styles.resultDot, styles.resultDotSuccess]}>
                <Text style={styles.resultDotText}>✓</Text>
              </View>
              <Text style={styles.checkText}>Cloud access confirmed</Text>
            </View>
          ) : null}
          {showError ? (
            <View style={styles.checkRow}>
              <View style={[styles.resultDot, styles.resultDotError]}>
                <Text style={styles.resultDotText}>✕</Text>
              </View>
              <Text style={styles.checkText}>Cloud access is not enabled yet</Text>
            </View>
          ) : null}
          {!showChecking && !showSuccess && !showError ? (
            <View style={styles.actions}>
              <PrimaryButton
                title="Continue"
                onPress={onConfirm}
                style={styles.compactButton}
              />
              <PrimaryButton
                title="Cancel"
                onPress={onCancel}
                variant="ghost"
                style={[styles.compactButton, styles.cancelButton]}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: spacing.sm,
  },
  title: { ...typography.title, textAlign: 'center' },
  subtitle: {
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  checkText: { color: palette.textMuted, textAlign: 'center' },
  resultDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultDotSuccess: { backgroundColor: palette.success },
  resultDotError: { backgroundColor: palette.danger },
  resultDotText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  compactButton: {
    paddingVertical: spacing.sm,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  cancelButton: {
    borderColor: palette.outline,
  },
});
