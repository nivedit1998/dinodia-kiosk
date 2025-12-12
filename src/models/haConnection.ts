// src/models/haConnection.ts
export type HaConnection = {
  id: number;
  baseUrl: string;
  cloudUrl: string | null;
  haUsername: string;
  haPassword: string;
  longLivedToken: string;
  ownerId: number;
};
