// src/screens/TenantSettingsScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSession } from '../store/sessionStore';
import { changePassword, logoutRemote } from '../api/auth';

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Tenant Settings</Text>
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
