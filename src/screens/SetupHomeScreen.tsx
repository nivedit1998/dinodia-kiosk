import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchKioskContext } from '../api/dinodia';
import { useSession } from '../store/sessionStore';
import { clearAllDeviceCacheForUser } from '../store/deviceStore';
import { getDeviceIdentity } from '../utils/deviceIdentity';
import { maxContentWidth, palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

type HubDetails = {
  dinodiaSerial?: string;
  bootstrapSecret?: string;
};

function parseHubQrPayload(raw: string): HubDetails | null {
  const text = (raw || '').trim();
  if (!text) return null;

  if (/^dinodia:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      const version = parsed.searchParams.get('v') || parsed.searchParams.get('version');
      if (version && version !== '3') return null;
      return {
        dinodiaSerial: parsed.searchParams.get('s') || parsed.searchParams.get('serial') || undefined,
        bootstrapSecret:
          parsed.searchParams.get('bs') || parsed.searchParams.get('bootstrapSecret') || undefined,
      };
    } catch {
      // fall through
    }
  }

  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') {
      return {
        dinodiaSerial: data.serial || data.s || undefined,
        bootstrapSecret: data.bootstrapSecret || data.bs || undefined,
      };
    }
  } catch {
    // not JSON
  }

  return null;
}

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
  const { setSession, clearSession } = useSession();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    confirmEmail: '',
    dinodiaSerial: '',
    bootstrapSecret: '',
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
  const hasHub = useMemo(
    () => form.dinodiaSerial.trim().length > 0 && form.bootstrapSecret.trim().length > 0,
    [form.bootstrapSecret, form.dinodiaSerial]
  );

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
          await completeChallenge(challengeId, identity.deviceId, identity.deviceLabel);
          await clearSession(); // ensure any temp token is cleared
          if (cancelled) return;
          resetVerification();
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
          setInfo('Home Created Successfully — please login again.');
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
    if (!hasHub) {
      setError('Scan the Dinodia Hub QR code to fill in the hub details.');
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
          deviceId: identity.deviceId,
          deviceLabel: identity.deviceLabel,
          dinodiaSerial: form.dinodiaSerial.trim(),
          bootstrapSecret: form.bootstrapSecret.trim(),
        }),
      });

      if (!data || !data.challengeId) {
        throw new Error(data?.error || 'We could not start email verification.');
      }
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish setup.');
      setForm((prev) => ({
        ...prev,
        dinodiaSerial: '',
        bootstrapSecret: '',
      }));
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
        const parsed = parseHubQrPayload(result);
        if (!parsed || !parsed.dinodiaSerial || !parsed.bootstrapSecret) {
          setScanError('QR code is missing hub details. Please scan the Dinodia Hub QR.');
        } else {
          setForm((prev) => ({
            ...prev,
            dinodiaSerial: parsed.dinodiaSerial?.trim() ?? prev.dinodiaSerial,
            bootstrapSecret: parsed.bootstrapSecret?.trim() ?? prev.bootstrapSecret,
          }));
          setInfo('QR scanned. Ready to create the homeowner account.');
        }
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
      <View style={styles.backdrop} pointerEvents="none">
        <View style={[styles.glow, styles.glowTop]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <View style={styles.pill}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>New home setup</Text>
            </View>
            <Text style={styles.brand}>Dinodia</Text>
            <Text style={styles.subtitle}>Set up this home</Text>
          </View>

          <View style={styles.card}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {info ? <Text style={styles.infoText}>{info}</Text> : null}

            {!awaitingVerification ? (
              <View style={styles.form}>
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

                <View style={styles.hubSection}>
                  <Text style={styles.sectionLabel}>Dinodia Hub connection</Text>
                  <Text style={styles.hubStatusText}>
                    Scan the Dinodia Hub QR to fill the Serial and Bootstrap Secret.
                  </Text>

                  <PrimaryButton
                    title={scanning ? 'Scanning…' : 'Scan Dinodia Hub QR code'}
                    onPress={handleScanQr}
                    style={styles.scanButton}
                    disabled={scanning}
                  />
                  {scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}

                  {hasHub ? (
                    <Text style={styles.infoTextSmall}>Hub details captured.</Text>
                  ) : (
                    <Text style={styles.hubStatusText}>No hub details captured yet.</Text>
                  )}
                </View>

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
              </View>
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  glow: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 200,
    backgroundColor: '#c7ddff',
    opacity: 0.35,
  },
  glowTop: { top: -80, left: -40 },
  glowBottom: { bottom: -50, right: -60, backgroundColor: '#c8fff4' },
  pageContent: {
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
    backgroundColor: palette.primary,
    marginRight: spacing.xs,
  },
  pillText: { color: palette.textMuted, fontWeight: '700' },
  brand: { fontSize: 32, fontWeight: '800', letterSpacing: 0.3, color: palette.text },
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
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  fieldWrap: { flex: 1 },
  sectionLabel: { color: palette.textMuted, fontSize: 12 },
  hubSection: { gap: spacing.sm },
  hubStatusText: { color: palette.textMuted, flex: 1 },
  footer: { alignItems: 'center', marginTop: spacing.lg },
  footerText: { color: palette.textMuted, fontSize: 12 },
  errorText: { color: palette.danger, marginBottom: spacing.sm },
  infoText: { color: palette.primary, marginBottom: spacing.sm },
  infoTextSmall: { color: palette.primary, fontSize: 12 },
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
