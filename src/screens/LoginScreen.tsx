// src/screens/LoginScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  NativeModules,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  loginWithCredentials,
  fetchChallengeStatus,
  completeChallenge,
  resendChallenge,
} from '../api/auth';
import { fetchKioskContext } from '../api/dinodia';
import { useSession } from '../store/sessionStore';
import { clearAllDeviceCacheForUser } from '../store/deviceStore';
import { getDeviceIdentity } from '../utils/deviceIdentity';
import { maxContentWidth, palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

const { InlineWifiSetupLauncher } = NativeModules;

export function LoginScreen() {
  const navigation = useNavigation<any>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [needsEmail, setNeedsEmail] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
  >('PENDING');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [pendingUsername, setPendingUsername] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (lowered.includes('device information is required')) {
      return 'This device could not be verified. Please restart the kiosk and try again.';
    }
    if (lowered.includes('valid email')) {
      return 'Please enter a valid email address to continue.';
    }
    if (lowered.includes('endpoint is not configured') || lowered.includes('login is not available')) {
      return 'Login is not available right now. Please try again in a moment.';
    }
    return 'We could not log you in right now. Please try again.';
  };

  const resetVerification = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setChallengeId(null);
    setChallengeStatus('PENDING');
    setVerificationError(null);
    setVerifying(false);
    setNeedsEmail(false);
  };

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

  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const status = await fetchChallengeStatus(challengeId);
        if (cancelled) return;
        setChallengeStatus(status);

        if (status === 'APPROVED') {
          setVerifying(true);
          const identity = await getDeviceIdentity();
          const { token } = await completeChallenge(
            challengeId,
            identity.deviceId,
            identity.deviceLabel
          );
          await finalizeLogin(token);
          if (cancelled) return;
          resetVerification();
          return;
        }

        if (status === 'EXPIRED' || status === 'NOT_FOUND') {
          setVerificationError('Verification expired. Please log in again.');
          return;
        }

        if (status === 'CONSUMED') {
          setVerificationError('Verification already used. Please log in again.');
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setVerificationError('We could not check verification status. Please try again.');
        }
        return;
      } finally {
        if (!cancelled) {
          setVerifying(false);
        }
      }

      pollRef.current = setTimeout(pollStatus, 2000);
    };

    pollStatus();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [challengeId, pendingUsername]);

  async function handleLogin() {
    if (loading || verifying) return;
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      Alert.alert('Login', 'Enter both username and password to sign in.');
      return;
    }
    if (needsEmail && !email.trim()) {
      Alert.alert('Login', 'Enter your email address to continue.');
      return;
    }
    setLoading(true);
    try {
      setVerificationError(null);
      const identity = await getDeviceIdentity();
      const result = await loginWithCredentials({
        username: trimmedUsername,
        password,
        email: needsEmail ? email.trim() : undefined,
        deviceId: identity.deviceId,
        deviceLabel: identity.deviceLabel,
      });

      if (result.status === 'OK') {
        await finalizeLogin(result.token);
        return;
      }

      if (result.status === 'NEEDS_EMAIL') {
        navigation.navigate('TenantEmailSetup', {
          username: trimmedUsername,
          password,
          deviceId: identity.deviceId,
          deviceLabel: identity.deviceLabel,
        });
        return;
      }

      if (result.status === 'CHALLENGE') {
        navigation.navigate('TenantEmailSetup', {
          username: trimmedUsername,
          password,
          deviceId: identity.deviceId,
          deviceLabel: identity.deviceLabel,
          challengeId: result.challengeId,
        });
        return;
      }
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

  const verificationStatusLabel = () => {
    if (verifying) return 'Finishing sign-in...';
    if (challengeStatus === 'APPROVED') return 'Approved. Completing sign-in...';
    if (challengeStatus === 'PENDING') return 'Waiting for verification...';
    if (challengeStatus === 'EXPIRED') return 'Verification expired.';
    if (challengeStatus === 'NOT_FOUND') return 'Verification not found.';
    if (challengeStatus === 'CONSUMED') return 'Verification already used.';
    return 'Waiting for verification...';
  };

  const handleResend = async () => {
    if (!challengeId) return;
    try {
      await resendChallenge(challengeId);
      Alert.alert('Sent', 'We sent a fresh verification email.');
    } catch (err) {
      Alert.alert('Try again', 'We could not resend that email. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backdrop} pointerEvents="none">
        <View style={[styles.glow, styles.glowTop]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

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
              <Text style={styles.cardTitle}>
                {challengeId ? 'Verify this device' : 'Welcome back'}
              </Text>
              {!challengeId ? (
                <Text style={styles.cardHint}>Sign in to open the home view.</Text>
              ) : null}
            </View>

            {challengeId ? (
              <>
                <Text style={styles.cardSub}>
                  We sent a verification link to your email. Tap the link to finish signing in.
                </Text>

                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={palette.primary} />
                  <Text style={styles.statusText}>{verificationStatusLabel()}</Text>
                </View>

                {verificationError ? (
                  <Text style={styles.errorText}>{verificationError}</Text>
                ) : null}

                <PrimaryButton
                  title="Resend email"
                  onPress={() => {
                    void handleResend();
                  }}
                  variant="ghost"
                  style={{ marginTop: spacing.sm }}
                  disabled={verifying}
                />

                <PrimaryButton
                  title="Back to login"
                  onPress={resetVerification}
                  variant="ghost"
                  style={{ marginTop: spacing.xs }}
                  disabled={verifying}
                />
              </>
            ) : (
              <>
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

                {needsEmail ? (
                  <TextField
                    label="Email"
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                  />
                ) : null}

                <PrimaryButton
                  title={loading ? 'Logging in…' : 'Login'}
                  onPress={() => {
                    void handleLogin();
                  }}
                  disabled={loading || verifying}
                  style={{ marginTop: spacing.md }}
                />

                <TouchableOpacity
                  style={styles.wifiButton}
                  onPress={handleOpenWifiSetup}
                  activeOpacity={0.85}
                  disabled={loading || verifying}
                >
                  <Text style={styles.wifiText}>Set up Wi-Fi</Text>
                </TouchableOpacity>

                <View style={styles.ctaGroup}>
                  <PrimaryButton
                    title="First time here? Set up this home"
                    onPress={() => navigation.navigate('SetupHome')}
                    variant="ghost"
                    style={styles.ctaButton}
                    disabled={loading || verifying}
                  />
                  <PrimaryButton
                    title="Claim a home (have a code?)"
                    onPress={() => navigation.navigate('ClaimHome')}
                    variant="ghost"
                    style={styles.ctaButton}
                    disabled={loading || verifying}
                  />
                </View>
              </>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Optimized for 8” landscape tablets • 16:10</Text>
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: '#bcd7ff',
    opacity: 0.35,
  },
  glowTop: {
    top: -60,
    left: -40,
    transform: [{ scale: 1.1 }],
  },
  glowBottom: {
    bottom: -40,
    right: -30,
    backgroundColor: '#c4f1ff',
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
  cardSub: { color: palette.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  wifiButton: {
    marginTop: spacing.sm,
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  wifiText: { color: palette.text, fontWeight: '700' },
  ctaGroup: { marginTop: spacing.lg, gap: spacing.sm },
  ctaButton: { paddingVertical: spacing.md },
  footer: { alignItems: 'center', marginTop: spacing.md },
  footerText: { color: palette.textMuted, fontSize: 12 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusText: { color: palette.textMuted },
  errorText: { color: palette.danger, marginTop: spacing.sm },
});
