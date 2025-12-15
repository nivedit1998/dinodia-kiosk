// src/components/RingDoorbellCard.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  NativeModules,
  Platform,
} from 'react-native';

const { RingAppLauncher } = NativeModules as {
  RingAppLauncher?: { open?: () => Promise<void> | void };
};

const RING_APP_URL = 'ring:';

export function RingDoorbellCard() {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const canOpen = await Linking.canOpenURL(RING_APP_URL);
        if (!cancelled) {
          setIsInstalled(canOpen);
        }
      } catch {
        if (!cancelled) {
          setIsInstalled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePress = useCallback(async () => {
    setErrorMessage(null);
    try {
      if (Platform.OS === 'android' && RingAppLauncher && typeof RingAppLauncher.open === 'function') {
        await Promise.resolve(RingAppLauncher.open());
      } else {
        await Linking.openURL(RING_APP_URL);
      }
    } catch (err) {
      setErrorMessage('Unable to open Ring app.');
    }
  }, []);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handlePress}
      style={styles.card}
    >
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>🔔</Text>
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.title}>Ring Doorbell</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {isInstalled === false ? 'Install or open the Ring app' : 'Tap to open the Ring app'}
        </Text>
        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#fff8e1',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fde68a',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 22,
    color: '#0f172a',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  error: {
    marginTop: 6,
    fontSize: 11,
    color: '#dc2626',
  },
});
