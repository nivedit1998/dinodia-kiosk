import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SegmentedTabs } from './SegmentedTabs';
import { palette, radii, shadows, spacing, maxContentWidth } from '../../ui/theme';

type Props = {
  areaLabel?: string;
  mode: 'home' | 'cloud';
  activeTab: 'dashboard' | 'automations' | 'homeSetup' | 'addDevices';
  onChangeTab: (key: 'dashboard' | 'automations' | 'homeSetup' | 'addDevices') => void;
  onPressMenu: () => void;
  onPressArea?: () => void;
  onPressMode?: () => void;
  wifiName?: string | null;
  batteryLevel?: number | null;
  onPressWifi?: () => void;
  tabs?: Array<{ key: 'dashboard' | 'automations' | 'homeSetup' | 'addDevices'; label: string }>;
};

export function TopBar({
  areaLabel,
  mode,
  activeTab,
  onChangeTab,
  onPressArea,
  onPressMenu,
  onPressMode,
  wifiName,
  batteryLevel,
  onPressWifi,
  tabs,
}: Props) {
  const wifiLabel =
    typeof wifiName === 'string' && wifiName.trim().length > 0 ? wifiName.trim() : 'Wi-Fi';
  const batteryPct =
    typeof batteryLevel === 'number' && Number.isFinite(batteryLevel)
      ? Math.max(0, Math.min(100, Math.round(batteryLevel)))
      : null;
  const batteryLabel = batteryPct === null ? '--%' : `${batteryPct}%`;
  const resolvedTabs =
    tabs && tabs.length > 0
      ? tabs
      : [
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'automations', label: 'Automations' },
        ];

  return (
    <View style={styles.wrap}>
      <View style={styles.inner}>
        <View style={styles.left}>
          {areaLabel ? (
            <TouchableOpacity
              onPress={onPressArea}
              activeOpacity={0.8}
              style={styles.areaButton}
            >
              <Text style={styles.areaLabel} numberOfLines={1}>
                {areaLabel}
              </Text>
              <Text style={styles.areaSub} numberOfLines={1} ellipsizeMode="tail">
                Area - tap to change
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.areaButton}>
              <Text style={styles.areaLabel}>Dinodia</Text>
              <Text style={styles.areaSub}>Control center</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={onPressMode}
            activeOpacity={0.8}
            disabled={!onPressMode}
            style={[styles.modePill, mode === 'cloud' ? styles.modePillCloud : styles.modePillHome]}
          >
            <View style={[styles.dot, mode === 'cloud' ? styles.dotCloud : styles.dotHome]} />
            <Text style={[styles.modeText, mode === 'cloud' ? styles.modeTextCloud : styles.modeTextHome]}>
              {mode === 'cloud' ? 'Cloud Mode' : 'Home Mode'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.right}>
          <SegmentedTabs
            tabs={resolvedTabs}
            activeKey={activeTab}
            onChange={(k) => onChangeTab(k as 'dashboard' | 'automations' | 'homeSetup' | 'addDevices')}
          />
          <TouchableOpacity
            onPress={onPressWifi}
            activeOpacity={0.8}
            style={styles.statusChip}
          >
            <Text style={styles.statusLabel} numberOfLines={1} ellipsizeMode="tail">
              {wifiLabel}
            </Text>
          </TouchableOpacity>
          <View style={styles.statusChip}>
            <View style={styles.batteryIcon}>
              <View
                style={[
                  styles.batteryFill,
                  batteryPct === null && styles.batteryFillEmpty,
                  batteryPct !== null && { width: `${batteryPct}%` },
                ]}
              />
              <View style={styles.batteryCap} />
            </View>
            <Text style={styles.statusLabel}>{batteryLabel}</Text>
          </View>
          <TouchableOpacity onPress={onPressMenu} activeOpacity={0.8} style={styles.menuButton}>
            <Text style={styles.menuGlyph}>⋯</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    width: '100%',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
    width: '100%',
    maxWidth: maxContentWidth,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  areaButton: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.soft,
    maxWidth: 260,
  },
  areaLabel: { fontSize: 15, fontWeight: '700', color: palette.text },
  areaSub: { fontSize: 11, color: palette.textMuted, marginTop: 0, lineHeight: 13 },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: spacing.xs,
  },
  modePillHome: { backgroundColor: 'rgba(14,165,233,0.12)' },
  modePillCloud: { backgroundColor: 'rgba(124,58,237,0.12)' },
  modeText: { fontWeight: '700', fontSize: 12 },
  modeTextHome: { color: palette.home },
  modeTextCloud: { color: palette.cloud },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginRight: 6,
  },
  dotHome: { backgroundColor: palette.home },
  dotCloud: { backgroundColor: palette.cloud },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  menuGlyph: { fontSize: 18, color: palette.text, marginTop: -2 },
  statusChip: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 140,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusLabel: { fontSize: 12, color: palette.text, fontWeight: '600' },
  batteryIcon: {
    width: 18,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: '#fff',
    position: 'relative',
    overflow: 'hidden',
  },
  batteryFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: palette.success,
  },
  batteryFillEmpty: {
    width: '100%',
    backgroundColor: palette.surfaceMuted,
  },
  batteryCap: {
    position: 'absolute',
    right: -3,
    top: 2,
    width: 3,
    height: 6,
    borderRadius: 1,
    backgroundColor: palette.outline,
  },
});
