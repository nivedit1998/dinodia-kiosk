// src/screens/SplashScreen.tsx
import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Image } from 'react-native';
import { palette, spacing, typography } from '../ui/theme';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/branding/splash.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color={palette.primary} style={{ marginTop: spacing.md }} />
      <Text style={styles.text}>Preparing your Dinodia Hub</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.background, gap: spacing.sm },
  logo: { width: 220, height: 72 },
  text: { marginTop: spacing.xs, ...typography.heading, color: palette.textMuted },
});
