import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { palette, radii, shadows, spacing } from '../ui/theme';

type Props = {
  visible: boolean;
  isCloud: boolean;
  onClose: () => void;
  onToggleMode: () => void;
  onOpenWifi: () => void;
  onLogout: () => void;
};

export function HeaderMenu({
  visible,
  isCloud,
  onClose,
  onToggleMode,
  onOpenWifi,
  onLogout,
}: Props) {
  const modeLabel = isCloud ? 'Move to Home Mode' : 'Move to Cloud Mode';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={styles.menuContainer}>
        <View style={styles.menuCard}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              onToggleMode();
              onClose();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.menuItemText}>{modeLabel}</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              onOpenWifi();
              onClose();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.menuItemText}>Wi‑Fi Options</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              onLogout();
              onClose();
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.menuItemText, styles.logoutText]}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  menuContainer: {
    position: 'absolute',
    top: 70,
    right: 12,
  },
  menuCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.xs,
    minWidth: 200,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.medium,
  },
  menuItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.text,
  },
  logoutText: {
    color: palette.danger,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.outline,
    marginHorizontal: spacing.md,
  },
});
