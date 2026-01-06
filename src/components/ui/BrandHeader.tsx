import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../../ui/theme';
import { BRAND_NAME } from '../../ui/terms';

type Props = {
  subtitle?: string;
};

export function BrandHeader({ subtitle }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../../assets/branding/wordmark.png')}
        style={styles.logo}
        resizeMode="contain"
        accessible
        accessibilityLabel={BRAND_NAME}
      />
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  logo: { width: 200, height: 48 },
  subtitle: {
    ...typography.small,
    color: palette.textMuted,
    textAlign: 'center',
  },
});
