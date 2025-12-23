// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, NativeModules, SafeAreaView, TouchableOpacity } from 'react-native';
import { loginWithCredentials } from '../api/auth';
import { getUserWithHaConnection } from '../api/dinodia';
import { useSession } from '../store/sessionStore';
import { clearAllDeviceCacheForUser } from '../store/deviceStore';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

const { InlineWifiSetupLauncher } = NativeModules;

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setSession } = useSession();

  const handleOpenWifiSetup = () => {
    if (InlineWifiSetupLauncher && typeof InlineWifiSetupLauncher.open === 'function') {
      InlineWifiSetupLauncher.open();
    } else {
      Alert.alert('Wi-Fi', 'Wi-Fi setup is not available on this device.');
    }
  };

  const friendlyLoginError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    const lowered = raw.toLowerCase();
    if (lowered.includes('invalid credentials') || lowered.includes('could not find that username')) {
      return 'We could not log you in. Check your username and password and try again.';
    }
    if (lowered.includes('username and password are required')) {
      return 'Enter both username and password to sign in.';
    }
    if (lowered.includes('endpoint is not configured') || lowered.includes('login is not available')) {
      return 'Login is not available right now. Please try again in a moment.';
    }
    return 'We could not log you in right now. Please try again.';
  };

  async function handleLogin() {
    if (loading) return;
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      Alert.alert('Login', 'Enter both username and password to sign in.');
      return;
    }
    setLoading(true);
    try {
      const user = await loginWithCredentials(trimmedUsername, password);
      await clearAllDeviceCacheForUser(user.id);
      const { haConnection } = await getUserWithHaConnection(user.id);
      await setSession({ user, haConnection });
      // Navigation container will switch from Auth to App automatically
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('login error in screen', err);
      }
      Alert.alert("Let's try that again", friendlyLoginError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Dinodia</Text>
        <Text style={styles.subtitle}>Smart Living • Beautifully simple</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Welcome back</Text>
        <Text style={styles.cardSub}>Control your home in one glance.</Text>

        <TextField
          label="Username"
          placeholder="you@example.com"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
          keyboardType="email-address"
        />

        <TextField
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          secureToggle
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
        />

        <PrimaryButton
          title={loading ? 'Logging in…' : 'Login'}
          onPress={() => {
            void handleLogin();
          }}
          disabled={loading}
          style={{ marginTop: spacing.md }}
        />

        <TouchableOpacity style={styles.wifiButton} onPress={handleOpenWifiSetup} activeOpacity={0.85}>
          <Text style={styles.wifiText}>Set up Wi‑Fi</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Optimized for 8” landscape tablets • 16:10</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  brand: { fontSize: 32, fontWeight: '800', letterSpacing: 0.3, color: palette.text },
  subtitle: { color: palette.textMuted, marginTop: 4, fontSize: 15 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    ...shadows.medium,
  },
  cardTitle: { ...typography.heading, marginBottom: 4 },
  cardSub: { color: palette.textMuted, marginBottom: spacing.lg },
  wifiButton: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  wifiText: { color: palette.primary, fontWeight: '700' },
  footer: { alignItems: 'center', marginTop: spacing.lg },
  footerText: { color: palette.textMuted, fontSize: 12 },
});
