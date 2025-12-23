// src/navigation/TenantNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TenantDashboardScreen } from '../screens/TenantDashboardScreen';
import { TenantSettingsScreen } from '../screens/TenantSettingsScreen';
import { AutomationsListScreen } from '../screens/automations/AutomationsListScreen';
import { AutomationEditorScreen } from '../screens/automations/AutomationEditorScreen';

export type TenantStackParamList = {
  TenantDashboard: undefined;
  TenantSettings: undefined;
};

export type TenantAutomationsStackParamList = {
  AutomationsList: undefined;
  AutomationEditor: { automationId?: string } | undefined;
};

export type TenantTabParamList = {
  DashboardTab: undefined;
  AutomationsTab: undefined;
};

const Stack = createNativeStackNavigator<TenantStackParamList>();
const AutomationsStack = createNativeStackNavigator<TenantAutomationsStackParamList>();
const Tab = createBottomTabNavigator<TenantTabParamList>();

function DashboardStackScreen() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TenantDashboard" component={TenantDashboardScreen} />
      <Stack.Screen name="TenantSettings" component={TenantSettingsScreen} />
    </Stack.Navigator>
  );
}

function AutomationStackScreen() {
  return (
    <AutomationsStack.Navigator screenOptions={{ headerShown: false }}>
      <AutomationsStack.Screen name="AutomationsList" component={AutomationsListScreen} />
      <AutomationsStack.Screen name="AutomationEditor" component={AutomationEditorScreen} />
    </AutomationsStack.Navigator>
  );
}

export function TenantNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tab.Screen name="DashboardTab" component={DashboardStackScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="AutomationsTab" component={AutomationStackScreen} options={{ title: 'Home Automations' }} />
    </Tab.Navigator>
  );
}
