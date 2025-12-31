// src/navigation/AuthNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';
import { SetupHomeScreen } from '../screens/SetupHomeScreen';
import { ClaimHomeScreen } from '../screens/ClaimHomeScreen';
import { TenantEmailSetupScreen } from '../screens/TenantEmailSetupScreen';

export type AuthStackParamList = {
  Login: undefined;
  SetupHome: undefined;
  ClaimHome: undefined;
  TenantEmailSetup: {
    username: string;
    password: string;
    deviceId: string;
    deviceLabel: string;
    challengeId?: string | null;
  };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SetupHome" component={SetupHomeScreen} />
      <Stack.Screen name="ClaimHome" component={ClaimHomeScreen} />
      <Stack.Screen name="TenantEmailSetup" component={TenantEmailSetupScreen} />
    </Stack.Navigator>
  );
}
