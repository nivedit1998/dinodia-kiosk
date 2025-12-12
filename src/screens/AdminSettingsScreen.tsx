// src/screens/AdminSettingsScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSession } from '../store/sessionStore';
import { changePassword, logoutRemote } from '../api/auth';
import { updateHaSettings } from '../api/dinodia';

export function AdminSettingsScreen() {
  const { session, clearSession, setSession } = useSession();
  const user = session.user!;
  const haInitial = session.haConnection;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [haUsername, setHaUsername] = useState(haInitial?.haUsername ?? '');
  const [haBaseUrl, setHaBaseUrl] = useState(haInitial?.baseUrl ?? '');
  const [haCloudUrl, setHaCloudUrl] = useState(haInitial?.cloudUrl ?? '');
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
        haCloudUrl,
        haPassword,
        haLongLivedToken: haToken,
      });
      Alert.alert('Updated', 'Dinodia Hub settings updated.');
      await setSession({ user, haConnection: updated });
      setHaBaseUrl(updated.baseUrl);
      setHaCloudUrl(updated.cloudUrl ?? '');
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
    await logoutRemote();
    await clearSession();
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Admin Settings</Text>
      <Text style={styles.subheader}>Logged in as {user.username}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Change password</Text>
        <TextInput
          style={styles.input}
          placeholder="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          value={confirmNewPassword}
          onChangeText={setConfirmNewPassword}
          secureTextEntry
        />
        <Button title="Update password" onPress={onChangePassword} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dinodia Hub</Text>
        <TextInput
          style={styles.input}
          placeholder="HA username"
          value={haUsername}
          onChangeText={setHaUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Dinodia Hub URL (home Wi-Fi)"
          value={haBaseUrl}
          onChangeText={setHaBaseUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="Dinodia Cloud URL (Nabu Casa)"
          value={haCloudUrl}
          onChangeText={setHaCloudUrl}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="New Dinodia Hub password (optional)"
          value={haPassword}
          onChangeText={setHaPassword}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="New Dinodia Hub long-lived token (optional)"
          value={haToken}
          onChangeText={setHaToken}
          secureTextEntry
        />
        <Button title="Update Dinodia Hub settings" onPress={onUpdateHa} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Session</Text>
        <Button title="Logout" color="red" onPress={onLogout} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  header: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
  subheader: { fontSize: 14, marginBottom: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
});
