// src/components/SpotifyCard.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';
import sha256 from 'js-sha256';
import { URL } from 'react-native-url-polyfill';
import { loadJson, saveJson, removeKey } from '../utils/storage';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  getDevices,
  getPlaybackState,
  pausePlayback,
  resumePlayback,
  skipToNext,
  skipToPrevious,
  transferPlayback,
  SpotifyDevice,
  SpotifyPlaybackState,
  loadTokens,
} from '../spotify/spotifyApi';

type SpotifyAuthEphemeral = {
  codeVerifier: string;
  state: string;
};

const AUTH_EPHEMERAL_KEY = 'spotify_auth_ephemeral_v1';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * chars.length);
    result += chars[index];
  }
  return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;
  const len = bytes.length;

  while (i + 2 < len) {
    const trio = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += chars[(trio >> 18) & 63];
    output += chars[(trio >> 12) & 63];
    output += chars[(trio >> 6) & 63];
    output += chars[trio & 63];
    i += 3;
  }

  if (i < len) {
    let trio = bytes[i] << 16;
    output += chars[(trio >> 18) & 63];
    if (i + 1 < len) {
      trio |= bytes[i + 1] << 8;
      output += chars[(trio >> 12) & 63];
      output += chars[(trio >> 6) & 63];
      output += '=';
    } else {
      output += chars[(trio >> 12) & 63];
      output += '==';
    }
  }

  return output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildCodeChallenge(verifier: string): string {
  const buffer = (sha256 as unknown as { arrayBuffer: (input: string) => ArrayBuffer }).arrayBuffer(
    verifier
  );
  const bytes = new Uint8Array(buffer);
  return base64UrlEncode(bytes);
}

async function saveEphemeralAuth(data: SpotifyAuthEphemeral): Promise<void> {
  await saveJson(AUTH_EPHEMERAL_KEY, data);
}

async function loadEphemeralAuth(): Promise<SpotifyAuthEphemeral | null> {
  return loadJson<SpotifyAuthEphemeral>(AUTH_EPHEMERAL_KEY);
}

async function clearEphemeralAuth(): Promise<void> {
  await removeKey(AUTH_EPHEMERAL_KEY);
}

type SpotifyCardProps = {
  compact?: boolean;
};

export function SpotifyCard({ compact }: SpotifyCardProps) {
  const [isSpotifyInstalled, setIsSpotifyInstalled] = useState<boolean | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [devicePickerVisible, setDevicePickerVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const hasClientConfigured = useMemo(
    () =>
      !!SPOTIFY_CLIENT_ID &&
      SPOTIFY_CLIENT_ID !== 'YOUR_SPOTIFY_CLIENT_ID' &&
      !!SPOTIFY_REDIRECT_URI,
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const canOpen = await Linking.canOpenURL('spotify:');
        if (!cancelled) {
          setIsSpotifyInstalled(canOpen);
        }
      } catch {
        if (!cancelled) {
          setIsSpotifyInstalled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await loadTokens().catch(() => null);
      if (cancelled) return;
      if (tokens) {
        setIsLoggedIn(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPlayback = useCallback(async () => {
    setErrorMessage(null);
    setLoadingPlayback(true);
    try {
      const state = await getPlaybackState();
      setPlayback(state);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load Spotify playback state.';
      setErrorMessage(message);
      setPlayback(null);
    } finally {
      setLoadingPlayback(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setPlayback(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        await refreshPlayback();
      } catch {
        // handled in refreshPlayback
      }
      if (cancelled) return;
      interval = setInterval(() => {
        void refreshPlayback();
      }, 5000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [isLoggedIn, refreshPlayback]);

  const handleStartLogin = useCallback(async () => {
    if (!hasClientConfigured) {
      setErrorMessage(
        'Spotify is not configured on this build. Please set the client ID and redirect URI.'
      );
      return;
    }
    if (loggingIn) return;

    setErrorMessage(null);
    setLoggingIn(true);

    try {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[SpotifyCard] Starting login…');
      }

      // Clear cookies so each login starts fresh.
      try {
        await CookieManager.clearAll(true);
      } catch {
        // ignore cookie clear failures
      }

      const codeVerifier = generateRandomString(64);
      const state = generateRandomString(32);
      const codeChallenge = buildCodeChallenge(codeVerifier);

      await saveEphemeralAuth({ codeVerifier, state }).catch(() => undefined);

      const url = buildAuthorizeUrl(codeChallenge, state);
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[SpotifyCard] Auth URL:', url);
      }

      setAuthUrl(url);
      setAuthVisible(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'We could not start Spotify login. Please try again.';
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error('[SpotifyCard] Login error:', error);
      }
      setErrorMessage(message);
    } finally {
      setLoggingIn(false);
    }
  }, [hasClientConfigured, loggingIn]);

  const handleAuthRedirect = useCallback(
    async (url: string) => {
      if (!url.startsWith(SPOTIFY_REDIRECT_URI)) {
        return;
      }
      setAuthVisible(false);
      setLoggingIn(true);
      try {
        const current = await loadEphemeralAuth();
        await clearEphemeralAuth().catch(() => undefined);
        if (!current) {
          setErrorMessage('We could not finish Spotify login. Please try again.');
          return;
        }

        const parsed = new URL(url);
        const returnedState = parsed.searchParams.get('state');
        if (!returnedState || returnedState !== current.state) {
          setErrorMessage('We could not finish Spotify login. Please try again.');
          return;
        }

        const error = parsed.searchParams.get('error');
        if (error) {
          setErrorMessage('Spotify login was cancelled or did not finish. Please try again.');
          return;
        }

        const code = parsed.searchParams.get('code');
        if (!code) {
          setErrorMessage('We could not finish Spotify login. Please try again.');
          return;
        }

        try {
          await exchangeCodeForTokens(code, current.codeVerifier);
          setIsLoggedIn(true);
          setErrorMessage(null);
          await refreshPlayback();
        } catch (tokenError) {
          const message =
            tokenError instanceof Error
              ? tokenError.message
              : 'We could not finish Spotify login. Please try again.';
          setErrorMessage(message);
          setIsLoggedIn(false);
        }
      } finally {
        setLoggingIn(false);
      }
    },
    [refreshPlayback]
  );

  const handleAuthNavigation = useCallback(
    async (navState: { url: string }) => {
      const { url } = navState;
      await handleAuthRedirect(url);
    },
    [handleAuthRedirect]
  );

  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      void handleAuthRedirect(event.url);
    });

    (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          await handleAuthRedirect(initialUrl);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      subscription.remove();
    };
  }, [handleAuthRedirect]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setErrorMessage(null);
    try {
      await clearTokens();
      await clearEphemeralAuth();
      try {
        await CookieManager.clearAll(true);
      } catch {
        // ignore cookie clear failures
      }
      setIsLoggedIn(false);
      setPlayback(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to log out from Spotify.';
      setErrorMessage(message);
    } finally {
      setLoggingOut(false);
      setMenuVisible(false);
    }
  }, [loggingOut]);

  const handleTogglePlayPause = useCallback(async () => {
    if (!isLoggedIn) return;
    setErrorMessage(null);
    try {
      if (playback?.isPlaying) {
        await pausePlayback();
      } else {
        await resumePlayback();
      }
      await refreshPlayback();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to control Spotify playback. Please ensure Spotify is open.';
      setErrorMessage(message);
    }
  }, [isLoggedIn, playback?.isPlaying, refreshPlayback]);

  const handleSkipNext = useCallback(async () => {
    if (!isLoggedIn) return;
    setErrorMessage(null);
    try {
      await skipToNext();
      await refreshPlayback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to skip to next track.';
      setErrorMessage(message);
    }
  }, [isLoggedIn, refreshPlayback]);

  const handleSkipPrevious = useCallback(async () => {
    if (!isLoggedIn) return;
    setErrorMessage(null);
    try {
      await skipToPrevious();
      await refreshPlayback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to skip to previous track.';
      setErrorMessage(message);
    }
  }, [isLoggedIn, refreshPlayback]);

  const handleOpenDevicePicker = useCallback(async () => {
    if (!isLoggedIn) return;
    setErrorMessage(null);
    try {
      const deviceList = await getDevices();
      setDevices(deviceList);
      setDevicePickerVisible(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load Spotify devices.';
      setErrorMessage(message);
    }
  }, [isLoggedIn]);

  const handleSelectDevice = useCallback(
    async (device: SpotifyDevice) => {
      setErrorMessage(null);
      try {
        await transferPlayback(device.id);
        setDevicePickerVisible(false);
        await refreshPlayback();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to transfer Spotify playback.';
        setErrorMessage(message);
      }
    },
    [refreshPlayback]
  );

  const handleOpenSpotifyApp = useCallback(async () => {
    try {
      const url = 'spotify:';
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        setErrorMessage('Spotify app is not installed on this device.');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open Spotify app.';
      setErrorMessage(message);
    }
  }, []);

  const title = playback?.trackName ?? (isLoggedIn ? 'No track playing' : 'Connect to Spotify');
  const subtitle = useMemo(() => {
    if (!isLoggedIn) {
      if (!hasClientConfigured) {
        return 'Spotify client ID is not configured for this build.';
      }
      if (isSpotifyInstalled === false) {
        return 'Spotify app is not installed.';
      }
      return 'Log in to control music from this tablet.';
    }
    if (!playback) {
      return 'Start playing music in Spotify to see details here.';
    }
    const artist = playback.artistName ?? '';
    const album = playback.albumName ?? '';
    if (artist && album) return `${artist} • ${album}`;
    if (artist) return artist;
    if (album) return album;
    return 'Spotify';
  }, [hasClientConfigured, isLoggedIn, isSpotifyInstalled, playback]);

  const deviceLabel = useMemo(() => {
    if (!isLoggedIn) return 'Not connected';
    if (!playback?.deviceName) return 'Device unknown';
    return playback.deviceName;
  }, [isLoggedIn, playback?.deviceName]);

  const showControls = isLoggedIn;

  return (
    <>
      <View style={[styles.card, compact && styles.cardCompact]}>
        <TouchableOpacity
          onPress={isLoggedIn ? handleOpenSpotifyApp : handleStartLogin}
          activeOpacity={0.85}
          style={styles.leftSection}
        >
          <View style={styles.artworkPlaceholder}>
            <Text style={styles.artworkText}>
              {playback?.trackName ? playback.trackName.charAt(0) : '♫'}
            </Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
            <View style={styles.deviceRow}>
              <TouchableOpacity
                onPress={handleOpenDevicePicker}
                style={styles.deviceChip}
                activeOpacity={0.7}
                disabled={!isLoggedIn}
              >
                <Text style={styles.deviceChipText} numberOfLines={1}>
                  {deviceLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {loadingPlayback || loggingIn ? (
            <ActivityIndicator size="small" color="#4ade80" />
          ) : null}
        </TouchableOpacity>

        <View style={styles.centerSection}>
          {showControls && (
            <>
              <TouchableOpacity
                style={styles.controlButton}
                onPress={handleSkipPrevious}
                activeOpacity={0.7}
              >
                <Text style={styles.controlIcon}>⏮</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.controlButton, styles.playPauseButton]}
                onPress={handleTogglePlayPause}
                activeOpacity={0.8}
              >
                <Text style={styles.playPauseIcon}>{playback?.isPlaying ? '⏸' : '▶'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.controlButton}
                onPress={handleSkipNext}
                activeOpacity={0.7}
              >
                <Text style={styles.controlIcon}>⏭</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.rightSection}>
          <TouchableOpacity
            onPress={() => setMenuVisible(true)}
            style={styles.menuButton}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>⋯</Text>
          </TouchableOpacity>
        </View>

        {errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText} numberOfLines={2}>
              {errorMessage}
            </Text>
          </View>
        )}
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.menuContainer}>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleOpenSpotifyApp}
              activeOpacity={0.8}
            >
              <Text style={styles.menuItemText}>Open Spotify app</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogout}
              disabled={!isLoggedIn || loggingOut}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.menuItemText,
                  (!isLoggedIn || loggingOut) && styles.menuItemDisabledText,
                ]}
              >
                {loggingOut ? 'Logging out…' : 'Log out of Spotify'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={authVisible && !!authUrl}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setAuthVisible(false)}
      >
        <View style={styles.authFullscreen}>
          <View style={styles.authHeader}>
            <Text style={styles.authTitle}>Spotify Login</Text>
            <TouchableOpacity
              onPress={() => setAuthVisible(false)}
              style={styles.authCloseButton}
              activeOpacity={0.8}
            >
              <Text style={styles.authCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          {authUrl ? (
            <WebView
              source={{ uri: authUrl }}
              onNavigationStateChange={handleAuthNavigation}
              startInLoadingState
              style={styles.authWebView}
            />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={devicePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDevicePickerVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDevicePickerVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.devicesContainer}>
          <View style={styles.devicesCard}>
            <Text style={styles.devicesTitle}>Choose playback device</Text>
            {devices.length === 0 ? (
              <Text style={styles.devicesEmpty}>No devices available for this account.</Text>
            ) : (
              devices.map((device) => (
                <TouchableOpacity
                  key={device.id}
                  style={styles.deviceItem}
                  onPress={() => void handleSelectDevice(device)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deviceItemName}>{device.name}</Text>
                  {device.isActive && <Text style={styles.deviceItemActive}>Active</Text>}
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 999,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
  },
  cardCompact: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937',
  },
  menuIcon: {
    color: '#e5e7eb',
    fontSize: 18,
    marginTop: -2,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1.3,
  },
  centerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  artworkPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  artworkText: {
    color: '#e5e7eb',
    fontSize: 24,
    fontWeight: '700',
  },
  textContainer: {
    flexShrink: 1,
  },
  title: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 11,
  },
  deviceRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#1f2937',
  },
  deviceChipText: {
    color: '#e5e7eb',
    fontSize: 11,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  controlButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937',
    marginHorizontal: 8,
  },
  controlIcon: {
    color: '#e5e7eb',
    fontSize: 18,
  },
  playPauseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#22c55e',
  },
  playPauseIcon: {
    color: '#022c22',
    fontSize: 22,
    fontWeight: '700',
  },
  errorContainer: {
    marginTop: 8,
  },
  errorText: {
    color: '#f97373',
    fontSize: 11,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  menuContainer: {
    position: 'absolute',
    bottom: 72,
    right: 16,
    alignItems: 'flex-end',
  },
  menuCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  menuItemText: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  menuItemDisabledText: {
    color: '#6b7280',
  },
  devicesContainer: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  devicesCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 260,
    maxWidth: 480,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  devicesTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  devicesEmpty: {
    color: '#9ca3af',
    fontSize: 13,
  },
  deviceItem: {
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceItemName: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  deviceItemActive: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '600',
  },
  authFullscreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111827',
  },
  authTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
  },
  authCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1f2937',
  },
  authCloseText: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  authWebView: {
    flex: 1,
    backgroundColor: '#000',
  },
  authContainer: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    bottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    width: '100%',
    maxWidth: 640,
    flex: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
