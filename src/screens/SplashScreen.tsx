// src/screens/SplashScreen.tsx
import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>Dinodia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { marginTop: 16, fontSize: 18 },
});
