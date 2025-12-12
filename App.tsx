import React, { useEffect } from 'react';
import { StatusBar, View, Keyboard } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from './src/store/sessionStore';
import { RootNavigator } from './src/navigation';
import { resetIdleTimer } from './src/utils/idleTimer';

export default function App() {
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', resetIdleTimer),
      Keyboard.addListener('keyboardDidHide', resetIdleTimer),
      Keyboard.addListener('keyboardDidChangeFrame', resetIdleTimer),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f7' }}>
      <SessionProvider>
        <SafeAreaProvider>
          <StatusBar barStyle="dark-content" backgroundColor="#f5f5f7" />
          <View
            style={{ flex: 1 }}
            onStartShouldSetResponderCapture={() => {
              resetIdleTimer();
              return false; // Observe touches globally without capturing them
            }}
          >
            <RootNavigator />
          </View>
        </SafeAreaProvider>
      </SessionProvider>
    </View>
  );
}
