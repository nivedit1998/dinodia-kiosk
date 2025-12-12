// src/utils/deviceSections.ts
import type { UIDevice } from '../models/device';
import { getGroupLabel, getPrimaryLabel, sortLabels, OTHER_LABEL } from './deviceLabels';

export type DeviceLayoutSize = 'small' | 'medium' | 'large';

export type DeviceRow = {
  key: string;
  devices: UIDevice[];
};

export type DeviceSection = {
  title: string;
  data: DeviceRow[];
};

export type LayoutSection = {
  key: string;
  title: string;
  span: number;
  devices: UIDevice[];
};

export type LayoutRow = {
  key: string;
  sections: LayoutSection[];
};

export type DeviceDimension = { width: number; height: number };

export function getDeviceLayoutSize(device: UIDevice): DeviceLayoutSize {
  const label = getPrimaryLabel(device);
  if (label === 'Spotify') return 'medium';
  return 'small';
}

export function getDeviceDimensions(size: DeviceLayoutSize): DeviceDimension {
  if (size === 'medium') return { width: 2, height: 1 };
  if (size === 'large') return { width: 2, height: 2 };
  return { width: 1, height: 1 };
}

export function buildDeviceSections(devices: UIDevice[]): DeviceSection[] {
  const groups = new Map<string, UIDevice[]>();

  for (const device of devices) {
    const label = getGroupLabel(device);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(device);
  }

  const sections: DeviceSection[] = [];
  const sortedLabels = sortLabels(Array.from(groups.keys()));

  for (const label of sortedLabels) {
    if (label === OTHER_LABEL) continue;

    const list = groups.get(label) ?? [];
    if (list.length === 0) continue;

    const rows: DeviceRow[] = [];
    for (let i = 0; i < list.length; i += 4) {
      const slice = list.slice(i, i + 4);
      const rowKey = `${label}-${slice.map((d) => d.entityId).join('|')}`;
      rows.push({ key: rowKey, devices: slice });
    }

    sections.push({ title: label, data: rows });
  }

  return sections;
}

function flattenSectionDevices(section: DeviceSection): UIDevice[] {
  const items: UIDevice[] = [];
  for (const row of section.data) {
    items.push(...row.devices);
  }
  return items;
}

export function buildSectionLayoutRows(sections: DeviceSection[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let currentSections: LayoutSection[] = [];
  let usedColumns = 0;

  const pushRow = () => {
    if (currentSections.length === 0) return;
    rows.push({ key: `row-${rows.length}`, sections: currentSections });
    currentSections = [];
    usedColumns = 0;
  };

  for (const section of sections) {
    const devices = flattenSectionDevices(section);
    const span = getSectionSpanForDevices(devices);

    if (usedColumns + span > 4 && currentSections.length > 0) {
      pushRow();
    }

    currentSections.push({
      key: `section-${rows.length}-${currentSections.length}-${section.title}`,
      title: section.title,
      span,
      devices,
    });
    usedColumns += span;

    if (usedColumns === 4) {
      pushRow();
    }
  }

  pushRow();

  return rows;
}

function getSectionSpanForDevices(devices: UIDevice[]): number {
  if (devices.length === 0) return 1;
  let totalWidth = 0;
  let maxWidth = 1;
  for (const device of devices) {
    const size = getDeviceLayoutSize(device);
    const { width } = getDeviceDimensions(size);
    totalWidth += width;
    maxWidth = Math.max(maxWidth, width);
  }
  const normalizedTotal = Math.min(4, totalWidth);
  return Math.min(4, Math.max(maxWidth, normalizedTotal));
}
