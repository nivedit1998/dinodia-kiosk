import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { fetchChallengeStatus, completeChallenge, resendChallenge } from '../api/auth';
import { platformFetch } from '../api/platformFetch';
import { fetchUserByUsername, getUserWithHaConnection } from '../api/dinodia';
import { useSession } from '../store/sessionStore';
import { clearAllDeviceCacheForUser } from '../store/deviceStore';
import { getDeviceIdentity } from '../utils/deviceIdentity';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

const DEFAULT_HA_BASE_URL = 'http://192.168.0.29:8123';
const DEFAULT_HA_USERNAME = 'dinodiasmarthub_admin';
const DEFAULT_HA_PASSWORD = 'DinodiaSmartHub123';

type RegisterAdminResponse = {
  ok?: boolean;
  requiresEmailVerification?: boolean;
  challengeId?: string;
  error?: string;
};

const { QrScanner } = NativeModules as {
  QrScanner?: { open?: () => Promise<string> };
};

export function SetupHomeScreen() {
  const navigation = useNavigation<any>();
  const { setSession } = useSession();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    confirmEmail: '',
    haBaseUrl: DEFAULT_HA_BASE_URL,
    haLongLivedToken: '',
  });
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
  >('PENDING');
  const [verifying, setVerifying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const awaitingVerification = Boolean(challengeId);

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetVerification = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setChallengeId(null);
    setChallengeStatus('PENDING');
    setVerifying(false);
    setInfo(null);
  };

  const finalizeLogin = async (username: string) => {
    const userRecord = await fetchUserByUsername(username);
    if (!userRecord) {
      throw new Error('We could not find your account. Please try again.');
    }
    await clearAllDeviceCacheForUser(userRecord.id);
    const { haConnection } = await getUserWithHaConnection(userRecord.id);
    await setSession({
      user: { id: userRecord.id, username: userRecord.username, role: userRecord.role },
      haConnection,
    });
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
          await completeChallenge(challengeId, identity.deviceId, identity.deviceLabel);
          await finalizeLogin(form.username.trim());
          if (cancelled) return;
          resetVerification();
          return;
        }

        if (status === 'EXPIRED' || status === 'NOT_FOUND') {
          setError('Verification expired. Please start again.');
          return;
        }

        if (status === 'CONSUMED') {
          setError('Verification already used. Please start again.');
          return;
        }
      } catch {
        if (!cancelled) {
          setError('We could not check verification status. Please try again.');
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
  }, [challengeId, form.username]);

  const handleSubmit = async () => {
    if (loading || verifying) return;
    setError(null);
    setInfo(null);

    if (!form.username.trim() || !form.password.trim()) {
      setError('Enter a username and password to continue.');
      return;
    }
    if (!form.email.trim()) {
      setError('Please enter an admin email.');
      return;
    }
    if (form.email.trim() !== form.confirmEmail.trim()) {
      setError('Email addresses must match.');
      return;
    }
    if (!form.haBaseUrl.trim() || !form.haLongLivedToken.trim()) {
      setError('Enter the Dinodia Hub address and token.');
      return;
    }

    setLoading(true);
    try {
      const identity = await getDeviceIdentity();
      const { data } = await platformFetch<RegisterAdminResponse>('/api/auth/register-admin', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          email: form.email.trim(),
          haBaseUrl: form.haBaseUrl.trim(),
          haUsername: DEFAULT_HA_USERNAME,
          haPassword: DEFAULT_HA_PASSWORD,
          haLongLivedToken: form.haLongLivedToken.trim(),
          deviceId: identity.deviceId,
          deviceLabel: identity.deviceLabel,
        }),
      });

      if (!data || !data.challengeId) {
        throw new Error(data?.error || 'We could not start email verification.');
      }
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish setup.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not finish setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!challengeId) return;
    try {
      await resendChallenge(challengeId);
      setInfo('We sent a fresh verification email.');
    } catch {
      setError('We could not resend that email. Please try again.');
    }
  };

  const handleScanQr = async () => {
    setScanError(null);
    if (!QrScanner || typeof QrScanner.open !== 'function') {
      setScanError('QR scanning is not available on this device.');
      return;
    }
    if (scanning) return;
    setScanning(true);
    try {
      const result = await QrScanner.open();
      if (typeof result === 'string' && result.trim().length > 0) {
        updateField('haLongLivedToken', result.trim());
      } else {
        setScanError('No QR code was detected.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to scan QR code.';
      if (!message.toLowerCase().includes('cancel')) {
        setScanError(message);
      }
    } finally {
      setScanning(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Dinodia</Text>
        <Text style={styles.subtitle}>Set up this home</Text>
      </View>

      <View style={styles.card}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {info ? <Text style={styles.infoText}>{info}</Text> : null}

        {!awaitingVerification ? (
          <ScrollView contentContainerStyle={styles.form}>
            <View style={styles.row}>
              <View style={styles.fieldWrap}>
                <TextField
                  label="Set Username"
                  placeholder="Your username"
                  autoCapitalize="none"
                  value={form.username}
                  onChangeText={(v) => updateField('username', v)}
                />
              </View>
              <View style={styles.fieldWrap}>
                <TextField
                  label="Set Password"
                  placeholder="••••••••"
                  secureTextEntry
                  secureToggle
                  autoCapitalize="none"
                  value={form.password}
                  onChangeText={(v) => updateField('password', v)}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.fieldWrap}>
                <TextField
                  label="Admin email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={form.email}
                  onChangeText={(v) => updateField('email', v)}
                />
              </View>
              <View style={styles.fieldWrap}>
                <TextField
                  label="Confirm email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={form.confirmEmail}
                  onChangeText={(v) => updateField('confirmEmail', v)}
                />
              </View>
            </View>

            <Text style={styles.sectionLabel}>
              Dinodia Hub connection (Home Assistant local URL).
            </Text>
            <TextField
              label="Dinodia Hub local address"
              placeholder={DEFAULT_HA_BASE_URL}
              autoCapitalize="none"
              value={form.haBaseUrl}
              onChangeText={(v) => updateField('haBaseUrl', v)}
            />
            <TextField
              label="Dinodia Hub long-lived access token"
              placeholder="Paste token"
              secureTextEntry
              secureToggle
              autoCapitalize="none"
              value={form.haLongLivedToken}
              onChangeText={(v) => updateField('haLongLivedToken', v)}
            />
            <PrimaryButton
              title={scanning ? 'Scanning…' : 'Scan QR code'}
              onPress={handleScanQr}
              variant="ghost"
              style={styles.scanButton}
              disabled={scanning}
            />
            {scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}

            <PrimaryButton
              title={loading ? 'Connecting Dinodia Hub…' : 'Connect your Dinodia Hub'}
              onPress={handleSubmit}
              disabled={loading}
              style={{ marginTop: spacing.md }}
            />
            <PrimaryButton
              title="Back to Login"
              onPress={() => navigation.goBack()}
              variant="ghost"
              style={{ marginTop: spacing.xs }}
              disabled={loading}
            />
          </ScrollView>
        ) : (
          <>
            <Text style={styles.cardTitle}>Verify this device</Text>
            <Text style={styles.cardSub}>
              Check your email and tap the verification link to finish setup.
            </Text>
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.statusText}>
                {verifying ? 'Finishing setup…' : `Status: ${challengeStatus}`}
              </Text>
            </View>
            <PrimaryButton
              title="Resend email"
              onPress={() => void handleResend()}
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              disabled={verifying}
            />
            <PrimaryButton
              title="Start over"
              onPress={resetVerification}
              variant="ghost"
              style={{ marginTop: spacing.xs }}
              disabled={verifying}
            />
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>First-time setup for a new home</Text>
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
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  brand: { fontSize: 30, fontWeight: '800', letterSpacing: 0.3, color: palette.text },
  subtitle: { color: palette.textMuted, marginTop: 4, fontSize: 15 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    ...shadows.medium,
  },
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  fieldWrap: { flex: 1 },
  sectionLabel: { color: palette.textMuted, fontSize: 12 },
  footer: { alignItems: 'center', marginTop: spacing.lg },
  footerText: { color: palette.textMuted, fontSize: 12 },
  errorText: { color: palette.danger, marginBottom: spacing.sm },
  infoText: { color: palette.primary, marginBottom: spacing.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusText: { color: palette.textMuted },
  cardTitle: { ...typography.heading, marginBottom: 4 },
  cardSub: { color: palette.textMuted, marginBottom: spacing.sm },
  scanButton: { alignSelf: 'flex-start' },
  scanError: { color: palette.danger, fontSize: 12 },
});
