// src/screens/AdminSettingsScreen.tsx
import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, Alert, ScrollView, SafeAreaView } from 'react-native';
import { useSession } from '../store/sessionStore';
import { changePassword } from '../api/auth';
import { updateHaSettings } from '../api/dinodia';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

export function AdminSettingsScreen() {
  const navigation = useNavigation<any>();
  const { session, setSession, resetApp } = useSession();
  const user = session.user!;
  const haInitial = session.haConnection;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [haUsername, setHaUsername] = useState(haInitial?.haUsername ?? '');
  const [haBaseUrl, setHaBaseUrl] = useState(haInitial?.baseUrl ?? '');
  const [haPassword, setHaPassword] = useState('');
  const [haToken, setHaToken] = useState('');

  async function onChangePassword() {
    try {
      await changePassword({
        role: user.role,
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      Alert.alert('Success', 'Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      Alert.alert(
        'Something went wrong',
        'We could not update that password. Please check your details and try again.'
      );
    }
  }

  async function onUpdateHa() {
    try {
      const updated = await updateHaSettings({
        adminId: user.id,
        haUsername,
        haBaseUrl,
        haPassword,
        haLongLivedToken: haToken,
      });
      Alert.alert('Updated', 'Dinodia Hub settings updated.');
      await setSession({ user, haConnection: updated });
      setHaBaseUrl(updated.baseUrl ?? '');
      setHaPassword('');
      setHaToken('');
    } catch (err) {
      Alert.alert(
        'Something went wrong',
        'We could not update your Dinodia Hub settings right now. Please check the details and try again.'
      );
    }
  }

  async function onLogout() {
    await resetApp();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Admin Settings</Text>
        <Text style={styles.subheader}>Logged in as {user.username}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change password</Text>
          <TextField
            label="Current password"
            placeholder="••••••••"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            secureToggle
          />
          <TextField
            label="New password"
            placeholder="••••••••"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            secureToggle
          />
          <TextField
            label="Confirm new password"
            placeholder="••••••••"
            value={confirmNewPassword}
            onChangeText={setConfirmNewPassword}
            secureTextEntry
            secureToggle
          />
          <PrimaryButton title="Update password" onPress={onChangePassword} style={{ marginTop: spacing.sm }} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Dinodia Hub</Text>
            <PrimaryButton
              title="Enable Remote Access (Nabu Casa)"
              variant="ghost"
              onPress={() => navigation.navigate('RemoteAccessSetup' as never)}
              style={styles.secondaryButton}
            />
          </View>
          <Text style={styles.helperText}>
            Enable secure cloud access from the in-home kiosk without revealing your Dinodia Hub
            password.
          </Text>
          <TextField
            label="HA username"
            placeholder="HA username"
            value={haUsername}
            onChangeText={setHaUsername}
          />
          <TextField
            label="Dinodia Hub URL (home Wi‑Fi)"
            placeholder="https://home.example.com"
            value={haBaseUrl}
            onChangeText={setHaBaseUrl}
          />
          <View style={styles.remoteStatusRow}>
            <Text style={styles.remoteStatusLabel}>Remote access</Text>
            <Text style={styles.remoteStatusValue}>
              {haInitial?.cloudEnabled ? 'Saved' : 'Not enabled'}
            </Text>
          </View>
          <TextField
            label="New Dinodia Hub password (optional)"
            placeholder="••••••••"
            value={haPassword}
            onChangeText={setHaPassword}
            secureTextEntry
            secureToggle
          />
          <TextField
            label="New Dinodia Hub long-lived token (optional)"
            placeholder="Token"
            value={haToken}
            onChangeText={setHaToken}
            secureTextEntry
            secureToggle
          />
          <PrimaryButton title="Update Dinodia Hub settings" onPress={onUpdateHa} style={{ marginTop: spacing.sm }} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session</Text>
          <PrimaryButton title="Logout" variant="danger" onPress={onLogout} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  container: { padding: spacing.xl, gap: spacing.lg },
  header: { ...typography.heading },
  subheader: { color: palette.textMuted },
  section: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4, color: palette.text },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  helperText: { color: palette.textMuted, fontSize: 13, marginBottom: spacing.sm },
  remoteStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  remoteStatusLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
  remoteStatusValue: { color: palette.text, fontSize: 13, fontWeight: '800' },
  secondaryButton: { alignSelf: 'flex-start', paddingHorizontal: spacing.md },
});
