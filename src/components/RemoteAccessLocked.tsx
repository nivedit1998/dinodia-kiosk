// src/components/RemoteAccessLocked.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { PrimaryButton } from './ui/PrimaryButton';

type Props = {
  title?: string;
  message: string;
  onBackHome?: () => void;
};

export function RemoteAccessLocked({ title, message, onBackHome }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>{title || 'Remote access locked'}</Text>
        <Text style={styles.message}>{message}</Text>
        {onBackHome ? (
          <PrimaryButton title="Back to Home Mode" onPress={onBackHome} style={styles.button} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    gap: spacing.sm,
    maxWidth: 520,
  },
  title: { ...typography.heading, textAlign: 'center' },
  message: { color: palette.textMuted, textAlign: 'center' },
  button: { marginTop: spacing.sm },
});
