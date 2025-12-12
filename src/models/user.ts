// src/models/user.ts
import type { Role } from './roles';

export type User = {
  id: number;
  username: string;
  passwordHash?: string; // only ever used server-side; avoid fetching on client
  role: Role;
  haConnectionId?: number | null;
};
