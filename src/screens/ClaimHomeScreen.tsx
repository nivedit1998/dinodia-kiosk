import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  ScrollView,
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
import { BrandHeader } from '../components/ui/BrandHeader';
import { InlineNotice } from '../components/ui/InlineNotice';
import { LoadingOverlay } from '../components/ui/LoadingOverlay';
import { friendlyError } from '../ui/friendlyError';

type ClaimValidateResponse = { ok?: boolean; homeStatus?: string; error?: string };
type ClaimStartResponse = {
  ok?: boolean;
  challengeId?: string;
  requiresEmailVerification?: boolean;
  error?: string;
};

function formatClaimCode(input: string) {
  const raw = input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 15);
  const parts = [raw.slice(0, 3), raw.slice(3, 7), raw.slice(7, 11), raw.slice(11, 15)]
    .filter((p) => p.length > 0);
  return parts.join('-');
}

export function ClaimHomeScreen() {
  const navigation = useNavigation<any>();
  const { setSession } = useSession();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [claimCode, setClaimCode] = useState('');
  const [claimContext, setClaimContext] = useState<{ homeStatus?: string } | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    confirmEmail: '',
  });
  const [checkingCode, setCheckingCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
  >('PENDING');
  const [verifying, setVerifying] = useState(false);

  const awaitingVerification = Boolean(challengeId);

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetFlow = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setChallengeId(null);
    setChallengeStatus('PENDING');
    setVerifying(false);
    setInfo(null);
    setError(null);
    setClaimCode('');
    setForm({
      username: '',
      password: '',
      confirmPassword: '',
      email: '',
      confirmEmail: '',
    });
    setStep(1);
    setClaimContext(null);
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
          resetFlow();
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

  const handleValidate = async () => {
    if (checkingCode) return;
    setError(null);
    setInfo(null);
    if (!claimCode.trim()) {
      setError('Enter the claim code from the previous owner.');
      return;
    }
    setCheckingCode(true);
    try {
      const { data } = await platformFetch<ClaimValidateResponse>('/api/claim', {
        method: 'POST',
        body: JSON.stringify({ claimCode: claimCode.trim(), validateOnly: true }),
      });
      if (!data.ok) {
        throw new Error(data.error || 'We could not validate that claim code.');
      }
      setClaimContext({ homeStatus: data.homeStatus });
      setStep(2);
    } catch (err) {
      setError(friendlyError(err, 'claim'));
    } finally {
      setCheckingCode(false);
    }
  };

  const handleSubmit = async () => {
    if (loading || verifying) return;
    setError(null);
    setInfo(null);

    if (!form.username.trim() || !form.password.trim()) {
      setError('Create a username and password to continue.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords must match.');
      return;
    }
    if (!form.email.trim()) {
      setError('Enter an email address to verify your homeowner account.');
      return;
    }
    if (form.email.trim() !== form.confirmEmail.trim()) {
      setError('Email addresses must match.');
      return;
    }
    if (!claimCode.trim()) {
      setError('Enter the claim code from the previous owner.');
      return;
    }

    setLoading(true);
    try {
      const identity = await getDeviceIdentity();
      const { data } = await platformFetch<ClaimStartResponse>('/api/claim', {
        method: 'POST',
        body: JSON.stringify({
          claimCode: claimCode.trim(),
          username: form.username.trim(),
          password: form.password,
          email: form.email.trim(),
          deviceId: identity.deviceId,
          deviceLabel: identity.deviceLabel,
        }),
      });
      if (!data || !data.challengeId) {
        throw new Error(data?.error || 'We could not start the claim. Please try again.');
      }
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish setup.');
    } catch (err) {
      setError(friendlyError(err, 'claim'));
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backdrop} pointerEvents="none">
        <View style={[styles.glow, styles.glowTop]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.content}>
          <BrandHeader subtitle="Claim this home" />
          <View style={styles.hero}>
            <View style={styles.pill}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>Ownership transfer</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardSub}>
              Use the claim code from the previous homeowner to create your homeowner account.
            </Text>

            <InlineNotice message={error} type="error" />
            <InlineNotice message={info} type="info" />

            {!awaitingVerification && step === 1 ? (
              <View style={styles.form}>
                <TextField
                  label="Claim code"
                  placeholder="DND-1234-5678-ABCD"
                  autoCapitalize="characters"
                  value={claimCode}
                  onChangeText={(value) => setClaimCode(formatClaimCode(value))}
                />
                <PrimaryButton
                  title={checkingCode ? 'Checking claim code…' : 'Continue'}
                  onPress={handleValidate}
                  disabled={checkingCode}
                  style={{ marginTop: spacing.md }}
                />
                <PrimaryButton
                  title="Back to Login"
                  onPress={() => navigation.goBack()}
                  variant="ghost"
                  style={{ marginTop: spacing.xs }}
                />
              </View>
            ) : null}

            {!awaitingVerification && step === 2 && claimContext ? (
              <View style={styles.form}>
                <View style={styles.row}>
                  <View style={styles.fieldWrap}>
                    <TextField
                      label="Portal username"
                      placeholder="Your username"
                      autoCapitalize="none"
                      value={form.username}
                      onChangeText={(v) => updateField('username', v)}
                    />
                  </View>
                  <View style={styles.fieldWrap}>
                    <TextField
                      label="Portal password"
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
                      label="Confirm password"
                      placeholder="••••••••"
                      secureTextEntry
                      secureToggle
                      autoCapitalize="none"
                      value={form.confirmPassword}
                      onChangeText={(v) => updateField('confirmPassword', v)}
                    />
                  </View>
                  <View style={styles.fieldWrap}>
                    <TextField
                      label="Homeowner email"
                      placeholder="you@example.com"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={form.email}
                      onChangeText={(v) => updateField('email', v)}
                    />
                  </View>
                </View>

                <View style={styles.row}>
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
                  <View style={styles.fieldWrap}>
                    <TextField
                      label="Home status"
                      value={claimContext.homeStatus ?? 'Pending'}
                      editable={false}
                    />
                  </View>
                </View>

                <PrimaryButton
                  title={loading ? 'Starting claim…' : 'Send verification email'}
                  onPress={handleSubmit}
                  disabled={loading}
                  style={{ marginTop: spacing.md }}
                />
                <View style={styles.inlineRow}>
                  <PrimaryButton
                    title="Change claim code"
                    onPress={() => {
                      setStep(1);
                      setClaimContext(null);
                      setInfo(null);
                      setError(null);
                    }}
                    variant="ghost"
                    style={styles.inlineButton}
                  />
                  <PrimaryButton
                    title="Back to Login"
                    onPress={() => navigation.goBack()}
                    variant="ghost"
                    style={styles.inlineButton}
                  />
                </View>
              </View>
            ) : null}

            {awaitingVerification ? (
              <View style={styles.form}>
                <Text style={styles.cardSub}>
                  Check your email and click the verification link. We’ll finish creating your homeowner
                  session on this device after approval.
                </Text>
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={palette.primary} />
                  <Text style={styles.statusText}>
                    {verifying ? 'Finishing setup…' : `Status: ${challengeStatus}`}
                  </Text>
                </View>
                <View style={styles.inlineRow}>
                  <PrimaryButton
                    title="Resend email"
                    onPress={() => void handleResend()}
                    variant="ghost"
                    style={styles.inlineButton}
                    disabled={verifying}
                  />
                  <PrimaryButton
                    title="Start over"
                    onPress={resetFlow}
                    variant="ghost"
                    style={styles.inlineButton}
                    disabled={verifying}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <LoadingOverlay
        visible={loading || verifying || checkingCode}
        label={
          loading
            ? 'Starting claim…'
            : verifying
            ? 'Waiting for verification…'
            : checkingCode
            ? 'Checking claim code…'
            : undefined
        }
        blocking={loading || verifying}
      />
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
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: '#c3d7ff',
    opacity: 0.35,
  },
  glowTop: { top: -60, left: -40 },
  glowBottom: { bottom: -40, right: -40, backgroundColor: '#d6f5ff' },
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
  cardSub: { color: palette.textMuted, marginBottom: spacing.md },
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  fieldWrap: { flex: 1 },
  inlineRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  inlineButton: { flex: 1 },
  errorText: { color: palette.danger, marginBottom: spacing.sm },
  infoText: { color: palette.primary, marginBottom: spacing.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: { color: palette.textMuted },
  cardTitle: { ...typography.heading, marginBottom: 4 },
});
