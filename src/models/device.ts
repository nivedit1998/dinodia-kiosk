// src/models/device.ts
export type UIDevice = {
  entityId: string;
  deviceId: string | null;
  name: string;
  state: string;
  area: string | null;
  areaName?: string | null;
  label: string | null;
  labelCategory?: string | null;
  labels?: string[];
  domain: string;
  attributes: Record<string, unknown>;
};

export type DeviceOverride = {
  id: number;
  haConnectionId: number;
  entityId: string;
  name: string;
  area: string | null;
  label: string | null;
};
