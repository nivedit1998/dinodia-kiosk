// src/screens/ForgotPasswordScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { requestPasswordReset } from '../api/auth';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { maxContentWidth, palette, radii, shadows, spacing, typography } from '../ui/theme';

export function ForgotPasswordScreen() {
  const navigation = useNavigation<any>();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const friendlyError = (err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    if (raw.toLowerCase().includes('too many')) {
      return 'Too many requests. Please wait and try again.';
    }
    if (!raw || raw.toLowerCase().includes('http')) {
      return 'We could not send a reset link right now. Please try again.';
    }
    return raw;
  };

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setInfo(null);
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError('Enter your username or email to continue.');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(trimmed);
      setInfo('If an account exists for that username or email, we sent a reset link.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <View style={styles.pill}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>Kiosk ready</Text>
            </View>
            <Text style={styles.brand}>Dinodia</Text>
            <Text style={styles.subtitle}>Smart Living. Quietly confident.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Reset password</Text>
              <Text style={styles.cardHint}>
                Enter your username or email. If we find a match, we&apos;ll email a reset link.
              </Text>
            </View>

            <TextField
              label="Username or email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={identifier}
              onChangeText={setIdentifier}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {info ? <Text style={styles.infoText}>{info}</Text> : null}

            <PrimaryButton
              title={loading ? 'Sending…' : 'Send reset link'}
              onPress={() => {
                void handleSubmit();
              }}
              disabled={loading}
              style={{ marginTop: spacing.md }}
            />

            {loading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.statusText}>Sending request…</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.backLink}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
              disabled={loading}
            >
              <Text style={styles.backText}>Back to login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  hero: { alignItems: 'center', marginBottom: spacing.lg, gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: palette.success,
    marginRight: spacing.xs,
  },
  pillText: { color: palette.textMuted, fontWeight: '700' },
  brand: { fontSize: 34, fontWeight: '800', letterSpacing: 0.3, color: palette.text },
  subtitle: { color: palette.textMuted, fontSize: 15 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: maxContentWidth,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
  },
  cardHeader: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.heading },
  cardHint: { color: palette.textMuted },
  errorText: { color: palette.danger, marginTop: spacing.sm },
  infoText: { color: palette.success, marginTop: spacing.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusText: { color: palette.textMuted },
  backLink: { marginTop: spacing.md, alignSelf: 'center' },
  backText: { color: palette.primary, fontWeight: '700' },
});
