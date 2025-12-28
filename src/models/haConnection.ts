// src/models/haConnection.ts
// Metadata about the home's HA connection; secrets (token/baseUrl/password) are fetched on-demand.
export type HaConnection = {
  id: number;
  cloudEnabled?: boolean;
  baseUrl?: string | null;
  haUsername?: string;
  haPassword?: string;
  longLivedToken?: string;
  ownerId?: number | null;
};
