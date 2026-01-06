import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../../ui/theme';

type NoticeType = 'info' | 'success' | 'warning' | 'error';

type Props = {
  message: string | null | undefined;
  type?: NoticeType;
  dense?: boolean;
};

export function InlineNotice({ message, type = 'info', dense }: Props) {
  if (!message) return null;
  const tone = tones[type] || tones.info;
  return (
    <View style={[styles.container, tone.container, dense && styles.dense]}>
      <Text style={[styles.text, tone.text]}>{message}</Text>
    </View>
  );
}

const tones: Record<NoticeType, { container: object; text: object }> = {
  info: {
    container: { backgroundColor: 'rgba(10,132,255,0.08)', borderColor: palette.primary },
    text: { color: palette.text },
  },
  success: {
    container: { backgroundColor: 'rgba(52,199,89,0.1)', borderColor: palette.success },
    text: { color: palette.text },
  },
  warning: {
    container: { backgroundColor: 'rgba(234,179,8,0.1)', borderColor: '#eab308' },
    text: { color: palette.text },
  },
  error: {
    container: { backgroundColor: 'rgba(255,59,48,0.08)', borderColor: palette.danger },
    text: { color: palette.text },
  },
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    alignSelf: 'stretch',
  },
  dense: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
