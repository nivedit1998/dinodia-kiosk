import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SegmentedTabs } from './SegmentedTabs';
import { palette, radii, shadows, spacing, maxContentWidth } from '../../ui/theme';

type Props = {
  areaLabel?: string;
  mode: 'home' | 'cloud';
  activeTab: 'dashboard' | 'automations';
  onChangeTab: (key: 'dashboard' | 'automations') => void;
  onPressMenu: () => void;
  onPressArea?: () => void;
};

export function TopBar({ areaLabel, mode, activeTab, onChangeTab, onPressArea, onPressMenu }: Props) {
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
                Area • tap to change
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.areaButton}>
              <Text style={styles.areaLabel}>Dinodia</Text>
              <Text style={styles.areaSub}>Control center</Text>
            </View>
          )}
          <View style={[styles.modePill, mode === 'cloud' ? styles.modePillCloud : styles.modePillHome]}>
            <View style={[styles.dot, mode === 'cloud' ? styles.dotCloud : styles.dotHome]} />
            <Text style={[styles.modeText, mode === 'cloud' ? styles.modeTextCloud : styles.modeTextHome]}>
              {mode === 'cloud' ? 'Cloud Mode' : 'Home Mode'}
            </Text>
          </View>
        </View>

        <View style={styles.right}>
          <SegmentedTabs
            tabs={[
              { key: 'dashboard', label: 'Dashboard' },
              { key: 'automations', label: 'Automations' },
            ]}
            activeKey={activeTab}
            onChange={(k) => onChangeTab(k as 'dashboard' | 'automations')}
          />
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
});
