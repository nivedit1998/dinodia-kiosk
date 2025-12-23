// src/screens/SplashScreen.tsx
import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { palette, spacing, typography } from '../ui/theme';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={styles.text}>Dinodia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.background },
  text: { marginTop: spacing.md, ...typography.heading },
});
