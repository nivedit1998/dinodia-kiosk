// src/screens/TenantSettingsScreen.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, SafeAreaView } from 'react-native';
import { useSession } from '../store/sessionStore';
import { changePassword, logoutRemote } from '../api/auth';
import { palette, radii, shadows, spacing, typography } from '../ui/theme';
import { TextField } from '../components/ui/TextField';
import { PrimaryButton } from '../components/ui/PrimaryButton';

export function TenantSettingsScreen() {
  const { session, clearSession } = useSession();
  const user = session.user!;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

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

  async function onLogout() {
    await logoutRemote();
    await clearSession();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Tenant Settings</Text>
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
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
});
