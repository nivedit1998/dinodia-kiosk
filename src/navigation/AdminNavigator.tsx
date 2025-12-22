// src/navigation/AdminNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
import { AdminSettingsScreen } from '../screens/AdminSettingsScreen';
import { AutomationsListScreen } from '../screens/automations/AutomationsListScreen';
import { AutomationEditorScreen } from '../screens/automations/AutomationEditorScreen';

export type AdminStackParamList = {
  AdminDashboard: undefined;
  AdminSettings: undefined;
};

export type AdminAutomationsStackParamList = {
  AutomationsList: undefined;
  AutomationEditor: { automationId?: string } | undefined;
};

export type AdminTabParamList = {
  DashboardTab: undefined;
  AutomationsTab: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();
const AutomationsStack = createNativeStackNavigator<AdminAutomationsStackParamList>();
const Tab = createBottomTabNavigator<AdminTabParamList>();

function DashboardStackScreen() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} />
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

export function AdminNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="DashboardTab" component={DashboardStackScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="AutomationsTab" component={AutomationStackScreen} options={{ title: 'Home Automations' }} />
    </Tab.Navigator>
  );
}
