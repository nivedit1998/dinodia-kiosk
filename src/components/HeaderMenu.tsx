import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { palette, radii, shadows, spacing } from '../ui/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onLogout: () => void;
};

export function HeaderMenu({ visible, onClose, onLogout }: Props) {
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
});
