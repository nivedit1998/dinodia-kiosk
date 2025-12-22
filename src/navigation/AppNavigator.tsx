// src/navigation/AppNavigator.tsx
import React from 'react';
import { AdminNavigator } from './AdminNavigator';
import { TenantNavigator } from './TenantNavigator';
import { useSession } from '../store/sessionStore';

export type AppTabParamList = {
  Admin: undefined;
  Tenant: undefined;
};

export function AppNavigator() {
  const { session } = useSession();
  const role = session.user?.role;

  if (role === 'ADMIN') {
    return <AdminNavigator />;
  }

  return <TenantNavigator />;
}
