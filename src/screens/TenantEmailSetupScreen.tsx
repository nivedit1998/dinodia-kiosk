// src/screens/TenantEmailSetupScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  loginWithCredentials,
  fetchChallengeStatus,
  completeChallenge,
  resendChallenge,
} from '../api/auth';
import { fetchKioskContext } from '../api/dinodia';
import { useSession } from '../store/sessionStore';
import { clearAllDeviceCacheForUser } from '../store/deviceStore';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { maxContentWidth, palette, radii, shadows, spacing, typography } from '../ui/theme';
import { AuthStackParamList } from '../navigation/AuthNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'TenantEmailSetup'>;

export function TenantEmailSetupScreen({ route, navigation }: Props) {
  const { username, password, deviceId, deviceLabel, challengeId: initialChallengeId } = route.params;
  const { setSession } = useSession();

  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(initialChallengeId ?? null);
  const [challengeStatus, setChallengeStatus] = useState<
    'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
  >('PENDING');
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finalizeLogin = async (platformToken?: string | null) => {
    const { user: userRecord, haConnection } = await fetchKioskContext();
    await clearAllDeviceCacheForUser(userRecord.id);
    await setSession(
      {
        user: { id: userRecord.id, username: userRecord.username, role: userRecord.role },
        haConnection,
      },
      { platformToken }
    );
  };

  const startPolling = (id: string) => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }

    const pollStatus = async () => {
      try {
        const status = await fetchChallengeStatus(id);
        setChallengeStatus(status);

        if (status === 'APPROVED') {
          setVerifying(true);
          const { token } = await completeChallenge(id, deviceId, deviceLabel);
          await finalizeLogin(token);
          navigation.replace('Login'); // Auth navigator will reroute when session updates
          return;
        }

        if (status === 'EXPIRED' || status === 'NOT_FOUND') {
          Alert.alert('Verification expired', 'Please start again.');
          return;
        }

        if (status === 'CONSUMED') {
          Alert.alert('Verification used', 'Please start again.');
          return;
        }
      } catch (err) {
        Alert.alert('Verification', 'Unable to check verification status. Please try again.');
        return;
      } finally {
        setVerifying(false);
      }

      pollRef.current = setTimeout(pollStatus, 2000);
    };

    pollStatus();
  };

  useEffect(() => {
    if (initialChallengeId) {
      startPolling(initialChallengeId);
    }
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [initialChallengeId]);

  const handleStart = async () => {
    if (!email.trim() || !confirmEmail.trim()) {
      Alert.alert('Email', 'Enter and confirm your email to continue.');
      return;
    }
    if (email.trim() !== confirmEmail.trim()) {
      Alert.alert('Email', 'Email addresses must match.');
      return;
    }
    setLoading(true);
    try {
      const result = await loginWithCredentials({
        username,
        password,
        email: email.trim(),
        deviceId,
        deviceLabel,
      });
      if (result.status === 'CHALLENGE') {
        setChallengeId(result.challengeId);
        setChallengeStatus('PENDING');
        startPolling(result.challengeId);
        Alert.alert('Check your email', 'Approve the link to finish sign-in.');
        return;
      }
      if (result.status === 'OK') {
        await finalizeLogin(result.token);
        navigation.replace('Login');
        return;
      }
      Alert.alert('Login', 'We could not start verification. Please try again.');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'We could not start verification. Please try again.';
      Alert.alert('Login', message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!challengeId) return;
    setResending(true);
    try {
      await resendChallenge(challengeId);
      Alert.alert('Sent', 'We sent a fresh verification email.');
    } catch (err) {
      Alert.alert('Try again', 'We could not resend that email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backdrop} pointerEvents="none">
        <View style={[styles.glow, styles.glowTop]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>
            Add your email to secure new devices. We’ll trust this kiosk after you finish.
          </Text>

          {!challengeId ? (
            <>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
              />
              <TextField
                label="Confirm email"
                value={confirmEmail}
                onChangeText={setConfirmEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
              />
              <PrimaryButton
                title={loading ? 'Sending…' : 'Send verification email'}
                onPress={() => void handleStart()}
                disabled={loading}
              />
              <TouchableOpacity onPress={() => navigation.replace('Login')}>
                <Text style={styles.link}>Back to login</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <ActivityIndicator />
                <Text style={styles.statusText}>
                  {verifying
                    ? 'Finishing sign-in...'
                    : challengeStatus === 'APPROVED'
                      ? 'Approved. Completing sign-in...'
                      : challengeStatus === 'EXPIRED'
                        ? 'Verification expired.'
                        : challengeStatus === 'NOT_FOUND'
                          ? 'Verification not found.'
                          : challengeStatus === 'CONSUMED'
                            ? 'Verification already used.'
                            : 'Waiting for verification...'}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, resending && styles.disabledButton]}
                  disabled={resending}
                  onPress={() => void handleResend()}
                >
                  <Text style={styles.secondaryText}>
                    {resending ? 'Resending…' : 'Resend email'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.replace('Login')}>
                  <Text style={styles.link}>Back to login</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: maxContentWidth,
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.md,
    gap: spacing.md,
  },
  title: {
    fontSize: 22,
    fontFamily: typography.semibold,
    color: palette.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: palette.textSecondary,
  },
  link: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: palette.link,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    fontSize: 14,
    color: palette.textSecondary,
  },
  actions: {
    gap: spacing.sm,
  },
  secondaryButton: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 14,
    color: palette.textPrimary,
  },
  disabledButton: {
    opacity: 0.6,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: palette.accentSoft,
    opacity: 0.25,
  },
  glowTop: {
    top: -60,
    left: -40,
  },
  glowBottom: {
    bottom: -80,
    right: -30,
  },
});
