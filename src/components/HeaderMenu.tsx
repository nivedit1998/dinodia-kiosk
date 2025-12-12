import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';

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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  menuContainer: {
    position: 'absolute',
    top: 50,
    right: 12,
  },
  menuCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    paddingVertical: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 14,
    color: '#111827',
  },
  logoutText: {
    color: '#b91c1c',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 12,
  },
});
