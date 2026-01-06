import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../../ui/theme';

type Props = {
  visible: boolean;
  label?: string;
  blocking?: boolean;
};

export function LoadingOverlay({ visible, label, blocking = true }: Props) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop} pointerEvents={blocking ? 'auto' : 'none'}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={palette.primary} />
          {label ? <Text style={styles.label}>{label}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    color: palette.textMuted,
  },
});
