import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { palette, radii, shadows, spacing } from '../../ui/theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  style?: ViewStyle;
};

export function PrimaryButton({ title, onPress, disabled, variant = 'primary', style }: Props) {
  const background =
    variant === 'primary'
      ? palette.primary
      : variant === 'danger'
      ? palette.danger
      : 'transparent';
  const borderColor = variant === 'ghost' ? palette.outline : 'transparent';
  const textColor = variant === 'ghost' ? palette.text : '#fff';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: disabled ? '#cbd5e1' : background,
          borderColor,
          opacity: disabled ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.title, { color: disabled ? '#e2e8f0' : textColor }]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
});
