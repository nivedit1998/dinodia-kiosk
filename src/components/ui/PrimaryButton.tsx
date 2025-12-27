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
  const elevation = variant === 'ghost' ? null : shadows.soft;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: disabled
            ? variant === 'ghost'
              ? palette.surfaceMuted
              : '#cbd5e1'
            : background,
          borderColor,
          opacity: disabled ? 0.9 : 1,
        },
        elevation,
        style,
      ]}
    >
      <Text style={[styles.title, { color: disabled ? '#94a3b8' : textColor }]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    minWidth: 180,
    alignSelf: 'stretch',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
});
