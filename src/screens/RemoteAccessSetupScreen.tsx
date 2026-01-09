import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { TopBar } from '../components/ui/TopBar';
import { HeaderMenu } from '../components/HeaderMenu';
import { palette, radii, shadows, spacing, typography, maxContentWidth } from '../ui/theme';
import { WizardScaffold } from '../components/ui/WizardScaffold';
import { useSession } from '../store/sessionStore';
import { fetchHomeModeSecrets } from '../api/haSecrets';
import { platformFetch } from '../api/platformFetch';
import { fetchChallengeStatus, completeStepUpChallenge, resendChallenge } from '../api/auth';
import { getDeviceIdentity } from '../utils/deviceIdentity';
import { fetchKioskContext } from '../api/dinodia';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import CookieManager from '@react-native-cookies/cookies';
import { friendlyError } from '../ui/friendlyError';
import { InlineNotice } from '../components/ui/InlineNotice';
import { checkHomeModeReachable } from '../api/remoteAccess';

const LOG_TAG = '[RemoteAccessSetup]';

type LeaseResponse = { ok?: boolean; leaseToken?: string; expiresAt?: string; error?: string; stepUpRequired?: boolean };
type SecretsResponse = { haUsername?: string; haPassword?: string; error?: string; stepUpRequired?: boolean };
type SaveCloudUrlResponse = { ok?: boolean; cloudEnabled?: boolean; error?: string; stepUpRequired?: boolean };
type WizardStep = 0 | 1 | 2 | 3 | 4; // intro, home, verify, connect, result

function msUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return t - Date.now();
}

function normalizeCloudUrl(value: string): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    const raw = parsed.toString().replace(/\/+$/, '');
    // Reject masked values (e.g., •••).
    if (/[•\*]/.test(raw)) return null;
    if (!parsed.hostname.endsWith('.ui.nabu.casa')) return null;
    const normalized = raw;
    return normalized;
  } catch {
    return null;
  }
}

function buildAutoLoginScript(username: string, password: string) {
  return `
    (function() {
      const USERNAME = ${JSON.stringify(username)};
      const PASSWORD = ${JSON.stringify(password)};
      const MAX_ATTEMPTS = 60;
      let attempts = 0;

      function walk(root, predicate) {
        if (!root) return null;
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          if (!node) continue;
          try {
            if (predicate(node)) return node;
          } catch (e) {}
          if (node.shadowRoot) stack.push(node.shadowRoot);
          const children = node.children || [];
          for (let i = children.length - 1; i >= 0; i -= 1) {
            stack.push(children[i]);
          }
        }
        return null;
      }

      function findInput(predicate) {
        return walk(document, (el) => {
          if (!(el instanceof HTMLInputElement)) return false;
          return predicate(el);
        });
      }

      function isAuthPath() {
        try {
          const path = window.location.pathname || '';
          return (
            path.startsWith('/auth/authorize') ||
            path.startsWith('/auth/login') ||
            path.startsWith('/auth/flow') ||
            path.startsWith('/auth/mfa')
          );
        } catch (e) {
          return false;
        }
      }

      function findSubmitButton() {
        const selectors = ['button[type="submit"]', 'mwc-button', 'ha-progress-button', 'ha-button', 'button'];
        for (const sel of selectors) {
          const el = walk(document, (n) => {
            if (!(n instanceof HTMLElement)) return false;
            return Boolean(n.matches && n.matches(sel) && typeof n.click === 'function');
          });
          if (el && typeof el.click === 'function') return el;
        }
        return null;
      }

      function fillAndClick() {
        if (!isAuthPath()) return false;
        const userInput =
          findInput((el) => el.name === 'username' || el.id === 'username' || el.type === 'email' || el.autocomplete === 'username') ||
          findInput((el) => el.type === 'text');
        const passInput =
          findInput((el) => el.type === 'password' || el.id === 'password' || el.autocomplete === 'current-password');
        if (!userInput || !passInput) return false;
        userInput.value = USERNAME;
        passInput.value = PASSWORD;
        ['input', 'change'].forEach((ev) => {
          userInput.dispatchEvent(new Event(ev, { bubbles: true }));
          passInput.dispatchEvent(new Event(ev, { bubbles: true }));
        });
        const button = findSubmitButton();
        if (button) {
          button.click();
          return true;
        }
        return false;
      }

      function tick() {
        attempts += 1;
        try {
          if (fillAndClick()) return;
        } catch (err) {}
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(tick, 500 + attempts * 300);
        }
      }
      setTimeout(tick, 500);
    })();
  `;
}

export function RemoteAccessSetupScreen() {
  const navigation = useNavigation<any>();
  const { session, haMode, setHaMode, setSession, resetApp } = useSession();
  const { wifiName, batteryLevel } = useDeviceStatus();
  const user = session.user;
  const isAdmin = user?.role === 'ADMIN';

  const [step, setStep] = useState<WizardStep>(0);
  const [openingWeb, setOpeningWeb] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'waiting' | 'leasing' | 'ready' | 'saving' | 'testing' | 'done'
  >('idle');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState<string | null>(null);
  const [haCreds, setHaCreds] = useState<{ haUsername: string; haPassword: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [lockdownEnabled, setLockdownEnabled] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [webVisible, setWebVisible] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const webRef = useRef<WebView>(null);
  const saveInFlightRef = useRef(false);
  const lastCapturedUrlRef = useRef<string | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const leaseExpiresAtRef = useRef<string | null>(null);
  const haCredsRef = useRef<{ haUsername: string; haPassword: string } | null>(null);
  const [homeReachable, setHomeReachable] = useState(false);
  const [checkingHome, setCheckingHome] = useState(false);

  const leaseMsLeft = useMemo(() => msUntil(leaseExpiresAt), [leaseExpiresAt]);
  const leaseActive = Boolean(leaseToken && leaseMsLeft != null && leaseMsLeft > 0 && haCreds);

  const clearSensitive = useCallback(() => {
    setLeaseToken(null);
    setLeaseExpiresAt(null);
    setHaCreds(null);
    setChallengeId(null);
    setChallengeError(null);
    saveInFlightRef.current = false;
    leaseTokenRef.current = null;
    leaseExpiresAtRef.current = null;
    haCredsRef.current = null;
  }, []);

  useEffect(() => {
    leaseTokenRef.current = leaseToken;
  }, [leaseToken]);

  useEffect(() => {
    leaseExpiresAtRef.current = leaseExpiresAt;
  }, [leaseExpiresAt]);

  useEffect(() => {
    haCredsRef.current = haCreds;
  }, [haCreds]);

  useEffect(() => {
    const ms = leaseMsLeft;
    if (!leaseToken || !ms || ms <= 0) return;
    const id = setTimeout(() => {
      clearSensitive();
      setStatus('idle');
    }, Math.min(ms, 10 * 60 * 1000));
    return () => clearTimeout(id);
  }, [clearSensitive, leaseMsLeft, leaseToken]);

  useEffect(() => {
    if (haMode !== 'home') {
      setHaMode('home');
    }
    // Remote access setup is home-mode only.
  }, [haMode, setHaMode]);

  const goToDashboard = useCallback(async () => {
    await closeWeb();
    clearSensitive();
    setStatus('idle');
    setStep(0);
    navigation.getParent()?.navigate('DashboardTab', {
      screen: isAdmin ? ('AdminDashboard' as never) : ('TenantDashboard' as never),
    });
  }, [clearSensitive, closeWeb, isAdmin, navigation]);

  const goBackStep = useCallback(() => {
    setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
  }, []);

  const goNextStep = useCallback(() => {
    setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s));
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) return;
    (async () => {
      try {
        const secrets = await fetchHomeModeSecrets();
        if (active) {
          const hubBase = secrets.baseUrl.replace(/\/+$/, '');
          try {
            const url = new URL(hubBase);
            // Force HA UI port to 8123 (hub-agent stays on 8099).
            url.port = '8123';
            setBaseUrl(`${url.origin}`);
          } catch {
            setBaseUrl(hubBase);
          }
        }
      } catch (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(`${LOG_TAG}[home-mode]`, err);
        }
        if (active) setBaseUrl(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const accountUrl = useMemo(() => {
    if (!baseUrl) return null;
    try {
      const u = new URL(baseUrl);
      // Ensure port is 8123 and origin-only for HA UI.
      u.port = '8123';
      return `${u.origin}/config/cloud/account`;
    } catch {
      return `${baseUrl}/config/cloud/account`;
    }
  }, [baseUrl]);

  const dashboardScreen = isAdmin ? 'AdminDashboard' : 'TenantDashboard';
  const addDevicesScreen = isAdmin ? null : 'TenantAddDevices';
  const isHttpsHa = useMemo(() => {
    if (!baseUrl) return false;
    try {
      const u = new URL(baseUrl);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }, [baseUrl]);

  const startStepUp = useCallback(async () => {
    if (!user) return;
    setChallengeError(null);
    setStatus('sending');
    try {
      const { data } = await platformFetch<{ ok?: boolean; challengeId?: string; error?: string }>(
        '/api/kiosk/remote-access/step-up/start',
        { method: 'POST' }
      );
      if (!data?.challengeId) {
        throw new Error(data?.error || 'Unable to start verification.');
      }
      setChallengeId(data.challengeId);
      setStatus('waiting');
    } catch (err) {
      setStatus('idle');
      setChallengeError(friendlyError(err, 'remoteAccess'));
    }
  }, [user]);

  const mintLeaseOnly = useCallback(async () => {
    if (!user) return;
    setStatus('leasing');
    try {
      const { data: lease } = await platformFetch<LeaseResponse>('/api/kiosk/remote-access/lease', {
        method: 'POST',
      });
      if (!lease?.leaseToken || !lease?.expiresAt) {
        throw new Error(lease?.error || 'Email verification is required.');
      }
      leaseTokenRef.current = lease.leaseToken;
      leaseExpiresAtRef.current = lease.expiresAt;
      setLeaseToken(lease.leaseToken);
      setLeaseExpiresAt(lease.expiresAt);
      setStatus('ready');
    } catch (err) {
      clearSensitive();
      setStatus('idle');
      setChallengeError(friendlyError(err, 'remoteAccess'));
      throw err;
    }
  }, [clearSensitive, user]);

  const fetchHubCreds = useCallback(async () => {
    const token = leaseTokenRef.current;
    if (!token) {
      throw new Error('Email verification is required.');
    }
    const { data: secrets } = await platformFetch<SecretsResponse>('/api/kiosk/remote-access/secrets', {
      method: 'POST',
      body: JSON.stringify({ leaseToken: token }),
    });
    if (!secrets?.haUsername || !secrets?.haPassword) {
      throw new Error(secrets?.error || 'Unable to load Dinodia Hub credentials.');
    }
    haCredsRef.current = { haUsername: secrets.haUsername, haPassword: secrets.haPassword };
    setHaCreds({ haUsername: secrets.haUsername, haPassword: secrets.haPassword });
  }, []);

  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const st = await fetchChallengeStatus(challengeId);
        if (cancelled) return;
        if (st === 'APPROVED') {
          const identity = await getDeviceIdentity();
          try {
            await completeStepUpChallenge(challengeId, identity.deviceId, identity.deviceLabel);
          } catch {
            // retry a couple times before failing
            let attempts = 0;
            while (attempts < 2) {
              attempts += 1;
              try {
                await new Promise((r) => setTimeout(r, 1000));
                await completeStepUpChallenge(challengeId, identity.deviceId, identity.deviceLabel);
                break;
              } catch {
                if (attempts >= 2) throw new Error('Unable to finalize verification. Please try again.');
              }
            }
          }
          if (cancelled) return;
          await mintLeaseOnly().catch(() => undefined);
          return;
        }
        if (st === 'EXPIRED' || st === 'NOT_FOUND') {
          setChallengeError('Verification expired. Please start again.');
          setStatus('idle');
          return;
        }
        if (st === 'CONSUMED') {
          // In case the device missed the APPROVED state, try to mint a lease.
          await mintLeaseOnly().catch(() => undefined);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setChallengeError(
            err instanceof Error ? err.message : 'We could not check verification status. Please try again.'
          );
          setStatus('idle');
        }
        return;
      }

      setTimeout(poll, 2000);
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [challengeId, mintLeaseOnly]);

  const handleResend = useCallback(async () => {
    if (!challengeId) return;
    try {
      await resendChallenge(challengeId);
      Alert.alert('Sent', 'We sent another verification email.');
    } catch {
      Alert.alert('Error', 'We could not resend that email. Please try again.');
    }
  }, [challengeId]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await resetApp();
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, resetApp]);

  const closeWeb = useCallback(async () => {
    setWebVisible(false);
    setLockdownEnabled(false);
    setWebKey((k) => k + 1);
    try {
      await CookieManager.clearAll(true);
      if (CookieManager.flush) {
        await CookieManager.flush();
      }
    } catch {
      // ignore cookie clear errors
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        // Keep the ~10 minute verification window even if the user switches to Mail to click the link.
        // Just close the web view to avoid leaving sensitive pages open in the app switcher.
        closeWeb();
      }
    });
    return () => sub.remove();
  }, [closeWeb]);

  const openWeb = useCallback(() => {
    if (!accountUrl) return;
    const ensureLeaseAndCreds = async (): Promise<boolean> => {
      let attempt = 0;
      while (attempt < 3) {
        try {
          const msLeft = msUntil(leaseExpiresAtRef.current);
          if (!leaseTokenRef.current || !msLeft || msLeft <= 0) {
            await mintLeaseOnly();
          }
          await fetchHubCreds();
          return true;
        } catch (err) {
          attempt += 1;
          if (attempt >= 3) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      return false;
    };
    if (openingWeb) return;
    setOpeningWeb(true);
    ensureLeaseAndCreds()
      .then((ok) => {
        if (!ok) return;
        setLockdownEnabled(false);
        setWebVisible(true);
        setWebKey((k) => k + 1);
      })
      .catch((err) => {
        Alert.alert('Verification required', friendlyError(err, 'remoteAccess'));
      })
      .finally(() => setOpeningWeb(false));
  }, [accountUrl, fetchHubCreds, mintLeaseOnly, openingWeb]);

  const onWebMessage = useCallback(
    async (event: any) => {
      const raw = event?.nativeEvent?.data;
      if (!raw || typeof raw !== 'string') return;
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed?.type === 'ACCOUNT_UI_READY') {
        setLockdownEnabled(true);
        return;
      }
      if (saveInFlightRef.current) return;
      if (parsed?.type !== 'CLOUD_URL') return;
      const normalized = normalizeCloudUrl(parsed?.url);
      if (!normalized) return;
      if (lastCapturedUrlRef.current === normalized) return;

      // Ensure lease is still valid; if expired, re-mint within the approval window.
      try {
        const currentExpiry = leaseExpiresAtRef.current;
        const currentLease = leaseTokenRef.current;
        const msLeft = msUntil(currentExpiry);
        if (!currentLease || !msLeft || msLeft <= 0) {
          let attempt = 0;
          while (attempt < 3) {
            try {
              await mintLeaseOnly();
              break;
            } catch (err) {
              attempt += 1;
              if (attempt >= 3) throw err;
              await new Promise((r) => setTimeout(r, 500 * attempt));
            }
          }
        }
      } catch (err) {
        setStatus('idle');
        setChallengeError(friendlyError(err, 'remoteAccess'));
        return;
      }

      const tokenToUse = leaseTokenRef.current;
      if (!tokenToUse) return;
      lastCapturedUrlRef.current = normalized;
      saveInFlightRef.current = true;
      setStatus('saving');
      setStep(4);
      try {
        const { data } = await platformFetch<SaveCloudUrlResponse>(
          '/api/kiosk/remote-access/cloud-url',
          { method: 'POST', body: JSON.stringify({ leaseToken: tokenToUse, cloudUrl: normalized }) }
        );
        if (!data?.ok) {
          throw new Error(data?.error || 'We could not save remote access.');
        }
        try {
          const refreshed = await fetchKioskContext();
          if (user) {
            await setSession({ user, haConnection: refreshed.haConnection });
          }
        } catch {
          // best effort; status will refresh on next login
        }

        // Begin verification without revealing the URL.
        setStatus('testing');
        setVerifyState('testing');
        setVerifyMessage(null);
        setWebVisible(false);
        setWebKey((k) => k + 1);

        const testUrl = normalized;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          await fetch(testUrl, { method: 'GET', signal: controller.signal });
          clearTimeout(timeout);
          setVerifyState('success');
          setVerifyMessage(
            'Remote access enabled. Your household can now use Alexa and cloud mode to control devices from anywhere.'
          );
        } catch {
          setVerifyState('failed');
          setVerifyMessage('Saved, but we could not verify the remote link right now.');
        }

        setStatus('done');
        lastCapturedUrlRef.current = null;
        clearSensitive();
        Alert.alert('Saved', 'Remote access detected and saved.');
      } catch (err) {
        saveInFlightRef.current = false;
        setStatus('ready');
        Alert.alert('Error', friendlyError(err, 'remoteAccess'));
      }
    },
    [clearSensitive, leaseExpiresAt, leaseToken, mintLeaseOnly, setSession, user]
  );

  const canProceed = Boolean(user && baseUrl && isAdmin);
  const stepLabel = `Step ${step + 1} of 5`;

  const refreshHomeReachable = useCallback(async () => {
    setCheckingHome(true);
    try {
      const reachable = await checkHomeModeReachable();
      setHomeReachable(Boolean(reachable));
    } finally {
      setCheckingHome(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 1) return;
    refreshHomeReachable();
  }, [refreshHomeReachable, step]);
  const allowedHosts = useMemo(() => {
    if (!baseUrl) return new Set<string>();
    try {
      const parsed = new URL(baseUrl);
      const host = parsed.host.toLowerCase();
      return new Set([
        host,
        'account.nabucasa.com',
        'auth.nabucasa.com',
        'cloud.nabucasa.com',
      ]);
    } catch {
      return new Set<string>();
    }
  }, [baseUrl]);
  const shouldStartLoad = useCallback(
    (req: any) => {
      try {
        const urlString = req?.url;
        if (!urlString) return false;
        if (urlString.startsWith('about:') || urlString.startsWith('blob:')) return true;
        const u = new URL(urlString);
        const host = u.host.toLowerCase();
        const protocol = u.protocol.toLowerCase();
        if (!allowedHosts.has(host)) return false;
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(protocol)) return false;
        // When locked down, only allow hub host (baseUrl host); block others (including nabucasa).
        if (lockdownEnabled) {
          try {
            const hubHost = new URL(baseUrl ?? '').host.toLowerCase();
            if (host !== hubHost) return false;
            // Allow all paths on the hub host, except block top-frame auth redirects.
            if (u.pathname.startsWith('/auth/')) return false;
          } catch {
            // if parsing baseUrl fails, fall back to allow
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    [allowedHosts, lockdownEnabled, baseUrl]
  );

  const injectedJs = useMemo(() => {
    return `
      (function() {
        let posted = false;
        let accountReadySent = false;
        const ACCOUNT_URL = ${JSON.stringify(accountUrl || '')};

        function withinShadow(root, predicate) {
          try {
            if (!root) return null;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
            let node = walker.currentNode;
            while (node) {
              if (predicate(node)) return node;
              if (node.shadowRoot) {
                const found = withinShadow(node.shadowRoot, predicate);
                if (found) return found;
              }
              node = walker.nextNode();
            }
          } catch (e) {}
          return null;
        }

        function findCloudInput() {
          const matcher = (el) => {
            const tag = (el.tagName || '').toLowerCase();
            if (tag !== 'input' && tag !== 'textarea') return false;
            const val = (el.value || '').toString();
            const type = (el.getAttribute && el.getAttribute('type'))?.toString().toLowerCase() || '';
            const hasMask = /[•\\*]/.test(val);
            // Only capture when unhidden (not password) and unmasked.
            return typeof val === 'string' && val.includes('.ui.nabu.casa') && !hasMask && type !== 'password';
          };
          const direct = withinShadow(document, matcher);
          return direct;
        }

        function isAccountPageRendered() {
          try {
            const path = (window.location && window.location.pathname) || '';
            if (!path.startsWith('/config/cloud/account')) return false;
            // Heuristic: look for cloud settings form elements.
            const selector = 'ha-card, ha-settings-row, ha-form, mwc-button';
            const el = withinShadow(document, (node) => {
              if (!(node instanceof HTMLElement)) return false;
              return node.matches && node.matches(selector);
            });
            return Boolean(el);
          } catch (e) {
            return false;
          }
        }

        function enforceAccountOnly(accountUrl) {
          try {
            const goAccount = () => {
              if (location.pathname !== '/config/cloud/account') {
                location.replace(accountUrl);
              }
            };
            const blockNav = (e, targetHref) => {
              try {
                const u = new URL(targetHref, location.href);
                if (u.pathname !== '/config/cloud/account') {
                  e.preventDefault();
                  e.stopPropagation();
                  goAccount();
                  return false;
                }
              } catch (err) {}
              return true;
            };
            document.addEventListener('click', function(e) {
              let el = e.target;
              while (el && el.tagName && el.tagName.toLowerCase() !== 'a') {
                el = el.parentElement;
              }
              if (el && el.href) {
                blockNav(e, el.href);
              }
            }, true);
            const origPush = history.pushState;
            const origReplace = history.replaceState;
            history.pushState = function(a,b,url){ if (typeof url==='string') { const u=new URL(url, location.href); if (u.pathname !== '/config/cloud/account') { return; } } return origPush.apply(this, arguments); };
            history.replaceState = function(a,b,url){ if (typeof url==='string') { const u=new URL(url, location.href); if (u.pathname !== '/config/cloud/account') { return; } } return origReplace.apply(this, arguments); };
            window.addEventListener('popstate', goAccount, true);
            goAccount();
            setInterval(goAccount, 1500);
          } catch (err) {}
        }

        function redact(el) {
          try {
            el.value = 'Saved';
            el.type = 'password';
            el.setAttribute('readonly', 'true');
            el.style.opacity = '0.6';
          } catch (e) {}
        }

        function tick() {
          if (posted) return;
          try {
            const path = (window.location && window.location.pathname) || '';
            if (typeof path === 'string') {
              if (path.startsWith('/config/cloud/account') && !accountReadySent && isAccountPageRendered()) {
                accountReadySent = true;
                window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'ACCOUNT_UI_READY' }));
                enforceAccountOnly(ACCOUNT_URL);
              }
              if (!path.startsWith('/config/cloud/account')) {
                setTimeout(tick, 800);
                return;
              }
            }
            if (typeof path === 'string' && !path.startsWith('/config/cloud/account')) {
              setTimeout(tick, 800);
              return;
            }
            const input = findCloudInput();
            if (input) {
              const raw = (input.value || '').toString().trim();
              if (raw && raw.includes('.ui.nabu.casa') && !/[•\\*]/.test(raw)) {
                posted = true;
                redact(input);
                window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CLOUD_URL', url: raw }));
                return;
              }
            }
          } catch (e) {}
          setTimeout(tick, 800);
        }
        setTimeout(tick, 800);
      })();
    `;
  }, []);

  const onNavStateChange = useCallback(
    (navState: any) => {
      try {
        const url = navState?.url || '';
        if (!url) return;
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(`${LOG_TAG}[nav]`, url);
        }
        // No path gating here; allow HA to complete its own redirects/auth flow.
      } catch {
        // ignore
      }
    },
    []
  );

  const wizard = useMemo(() => {
    if (!isAdmin) {
      return {
        title: 'Remote Access Setup',
        subtitle: 'Only homeowners can set up remote access.',
        showBack: false,
        showNext: true,
        nextLabel: 'Close',
        canNext: true,
        onNext: goToDashboard,
        body: (
          <View style={styles.block}>
            <Text style={styles.bigIcon}>🔒</Text>
            <Text style={styles.bodyText}>
              Sign in as a homeowner/admin to enable remote access.
            </Text>
          </View>
        ),
      };
    }

    if (!baseUrl) {
      return {
        title: 'Remote Access Setup',
        subtitle: 'Dinodia Hub not detected.',
        showBack: false,
        showNext: true,
        nextLabel: 'Close',
        canNext: true,
        onNext: goToDashboard,
        body: (
          <View style={styles.block}>
            <Text style={styles.bigIcon}>⚠️</Text>
            <Text style={styles.bodyText}>
              Home mode must be connected to your Dinodia Hub to continue.
            </Text>
            <InlineNotice message="Make sure you are on your home Wi‑Fi and signed in again." type="warning" />
          </View>
        ),
      };
    }

    if (step === 0) {
      return {
        title: 'Have your Nabu Casa login ready',
        subtitle: 'You will log into your Nabu Casa account on your Dinodia Hub to enable remote access.',
        showBack: false,
        showNext: true,
        nextLabel: 'Next',
        canNext: canProceed,
        onNext: () => setStep(1),
        body: (
          <View style={styles.block}>
            <Text style={styles.bigIcon}>🔑</Text>
            <Text style={styles.bodyText}>
              Before you start, make sure you know your Nabu Casa email + password.
            </Text>
            <PrimaryButton
              title="Open Nabu Casa account page"
              variant="ghost"
              onPress={() => Linking.openURL('https://account.nabucasa.com/')}
            />
            <View style={styles.list}>
              <Text style={styles.listItem}>• We will never show the remote access URL in the app.</Text>
              <Text style={styles.listItem}>• Setup is available for ~10 minutes after email verification.</Text>
            </View>
          </View>
        ),
      };
    }

    if (step === 1) {
      return {
        title: 'Make sure you are at home',
        subtitle: 'This requires a direct connection to your Dinodia Hub over home Wi‑Fi.',
        showBack: true,
        showNext: true,
        nextLabel: 'Next',
        canBack: true,
        onBack: goBackStep,
        canNext: homeReachable && canProceed,
        onNext: () => setStep(2),
        body: (
          <View style={styles.block}>
            <Text style={styles.bigIcon}>{homeReachable ? '✅' : '📡'}</Text>
            <Text style={styles.bodyText}>
              {checkingHome
                ? 'Checking Dinodia Hub reachability…'
                : homeReachable
                ? 'Dinodia Hub reachable.'
                : 'Dinodia Hub not reachable.'}
            </Text>
            <PrimaryButton
              title={checkingHome ? 'Checking…' : 'Check again'}
              variant="ghost"
              onPress={refreshHomeReachable}
              disabled={checkingHome}
            />
            {!homeReachable && !checkingHome ? (
              <InlineNotice
                type="warning"
                message="Connect to your home Wi‑Fi and ensure the Dinodia Hub is powered on."
              />
            ) : null}
          </View>
        ),
      };
    }

    if (step === 2) {
      const minutesLeft = leaseMsLeft != null && leaseMsLeft > 0 ? Math.ceil(leaseMsLeft / 60000) : null;
      return {
        title: 'Verify your email',
        subtitle: 'We will send a verification email to unlock setup for ~10 minutes.',
        showBack: true,
        showNext: true,
        nextLabel: 'Next',
        canBack: true,
        onBack: goBackStep,
        canNext: status === 'ready' && leaseActive,
        onNext: () => setStep(3),
        body: (
          <View style={styles.block}>
            {status === 'idle' ? (
              <PrimaryButton title="Verify email to continue" onPress={startStepUp} />
            ) : null}

            {status === 'sending' ? (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.progressText}>Sending verification email…</Text>
              </View>
            ) : null}

            {status === 'waiting' ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Check your email</Text>
                <Text style={styles.panelText}>
                  Click the verification link, then return here. This unlocks remote access setup for ~10 minutes.
                </Text>
                <View style={styles.panelActions}>
                  <PrimaryButton title="Resend email" variant="ghost" onPress={handleResend} />
                  <PrimaryButton
                    title="Cancel"
                    variant="danger"
                    onPress={() => {
                      clearSensitive();
                      setStatus('idle');
                    }}
                  />
                </View>
              </View>
            ) : null}

            {status === 'leasing' ? (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.progressText}>Unlocking setup…</Text>
              </View>
            ) : null}

            {status === 'ready' ? (
              <View style={styles.successPanel}>
                <Text style={styles.successTitle}>Verified</Text>
                <Text style={styles.successText}>
                  {minutesLeft ? `Setup window: ~${minutesLeft} min left.` : 'Setup window is active.'}
                </Text>
                <PrimaryButton
                  title="Lock again"
                  variant="ghost"
                  onPress={() => {
                    clearSensitive();
                    setStatus('idle');
                  }}
                />
              </View>
            ) : null}

            <InlineNotice message={challengeError} type="error" />
          </View>
        ),
      };
    }

    if (step === 3) {
      return {
        title: 'Login on Dinodia Hub',
        subtitle:
          'We will open your Dinodia Hub, auto-fill your Home Assistant login, and detect the Nabu Casa URL when you unhide it.',
        showBack: true,
        showNext: true,
        backLabel: 'Back',
        nextLabel: 'Login to Nabu Casa on Dinodia Hub',
        canBack: true,
        onBack: goBackStep,
        canNext: Boolean(accountUrl) && !openingWeb,
        onNext: openWeb,
        body: (
          <View style={styles.block}>
            <Text style={styles.bigIcon}>🌐</Text>
            <View style={styles.list}>
              <Text style={styles.listItem}>1) Enter your Nabu Casa login details.</Text>
              <Text style={styles.listItem}>2) Scroll down and tap the eye icon to unhide the remote access URL.</Text>
              <Text style={styles.listItem}>3) Dinodia saves it automatically (it won’t be shown here).</Text>
            </View>
            {openingWeb ? (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.progressText}>Opening Dinodia Hub…</Text>
              </View>
            ) : null}
            <InlineNotice
              type="warning"
              message="Stay on your home Wi‑Fi during this step. Do not share or screenshot the URL."
            />
          </View>
        ),
      };
    }

    // step 4
    const isBusy = status === 'saving' || status === 'testing';
    const title = verifyState === 'success' ? 'Remote access enabled' : verifyState === 'failed' ? 'Setup incomplete' : 'Enabling remote access';
    const subtitle =
      verifyState === 'success'
        ? 'Cloud mode and Alexa can now work from anywhere.'
        : verifyState === 'failed'
        ? 'We saved the link, but verification failed. You can try again.'
        : 'Saving and verifying your remote access…';
    return {
      title,
      subtitle,
      showBack: false,
      showNext: true,
      nextLabel: 'Close',
      canNext: !isBusy,
      onNext: goToDashboard,
      body: (
        <View style={styles.block}>
          {isBusy ? (
            <View style={styles.progressCenter}>
              <ActivityIndicator size="large" color={palette.primary} />
              <Text style={styles.progressText}>
                {status === 'saving' ? 'Saving remote access…' : 'Testing remote access…'}
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.bigIcon}>{verifyState === 'success' ? '✅' : verifyState === 'failed' ? '⚠️' : '✅'}</Text>
              <Text style={styles.bodyText}>{verifyMessage || 'Done.'}</Text>
              {verifyState === 'failed' ? (
                <PrimaryButton title="Try again" variant="ghost" onPress={() => setStep(3)} />
              ) : null}
            </>
          )}
        </View>
      ),
    };
  }, [
    accountUrl,
    baseUrl,
    canProceed,
    challengeError,
    checkingHome,
    clearSensitive,
    goBackStep,
    goToDashboard,
    handleResend,
    homeReachable,
    isAdmin,
    leaseActive,
    leaseMsLeft,
    openingWeb,
    openWeb,
    refreshHomeReachable,
    startStepUp,
    status,
    step,
    verifyMessage,
    verifyState,
  ]);

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar
        mode={haMode}
        activeTab={null}
        tabs={
          isAdmin
            ? [
                { key: 'dashboard', label: 'Dashboard' },
                { key: 'automations', label: 'Automations' },
                { key: 'homeSetup', label: 'Home Setup' },
              ]
            : [
                { key: 'dashboard', label: 'Dashboard' },
                { key: 'automations', label: 'Automations' },
              ]
        }
        onChangeTab={(tab) => {
          if (tab === 'dashboard') {
            navigation.getParent()?.navigate('DashboardTab', {
              screen: dashboardScreen as never,
            });
            return;
          }
          if (tab === 'automations') {
            navigation.getParent()?.navigate('AutomationsTab', { screen: 'AutomationsList' as never });
            return;
          }
          if (tab === 'homeSetup' && isAdmin) {
            navigation.getParent()?.navigate('DashboardTab', { screen: 'AdminHomeSetup' as never });
            return;
          }
          if (tab === 'addDevices' && addDevicesScreen) {
            navigation.getParent()?.navigate('DashboardTab', { screen: addDevicesScreen as never });
          }
        }}
        onPressMenu={() => setMenuVisible(true)}
        onPressMode={undefined}
        wifiName={wifiName}
        batteryLevel={batteryLevel}
      />

      {!isHttpsHa ? (
        <View style={styles.httpNotice}>
          <Text style={styles.httpNoticeText}>
            Using HTTP. Stay on the same Wi‑Fi as your Dinodia Hub while we auto-login and save remote access.
          </Text>
        </View>
      ) : null}

      <View style={styles.wizardWrap}>
        <WizardScaffold
          title={wizard.title}
          subtitle={wizard.subtitle}
          stepLabel={stepLabel}
          onBack={wizard.onBack}
          onNext={wizard.onNext}
          canBack={wizard.canBack ?? true}
          canNext={wizard.canNext ?? true}
          nextLabel={wizard.nextLabel}
          backLabel={wizard.backLabel}
          showBack={wizard.showBack}
          showNext={wizard.showNext}
        >
          {wizard.body}
        </WizardScaffold>
      </View>

          <Modal visible={webVisible} animationType="slide" onRequestClose={closeWeb}>
            <SafeAreaView style={styles.webRoot}>
              <View style={styles.webHeader}>
                <Text style={styles.webTitle}>Dinodia Hub</Text>
                <PrimaryButton title="Close" variant="ghost" onPress={closeWeb} />
              </View>
              {(() => {
                const creds = haCreds ?? haCredsRef.current;
                if (!accountUrl || !creds) return null;
                return (
                <WebView
                  ref={webRef}
                  key={webKey}
                  source={{ uri: accountUrl }}
                  onShouldStartLoadWithRequest={shouldStartLoad}
                  onMessage={onWebMessage}
                  onNavigationStateChange={onNavStateChange}
                  injectedJavaScript={buildAutoLoginScript(creds.haUsername, creds.haPassword)}
                  injectedJavaScriptBeforeContentLoaded={injectedJs}
                  javaScriptEnabled
                  domStorageEnabled
                  incognito
                  setSupportMultipleWindows={false}
                  javaScriptCanOpenWindowsAutomatically={false}
                  allowFileAccess={false}
                  allowUniversalAccessFromFileURLs={false}
                  startInLoadingState
                  renderLoading={() => (
                    <View style={styles.webLoading}>
                      <ActivityIndicator size="large" color={palette.primary} />
                      <Text style={styles.webLoadingText}>Loading…</Text>
                    </View>
                  )}
                />
                );
              })() ?? (
                <View style={styles.webLoading}>
                  <Text style={styles.webLoadingText}>Verification required.</Text>
                </View>
              )}
            </SafeAreaView>
          </Modal>
      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onLogout={handleLogout}
        onManageDevices={() => {
          setMenuVisible(false);
          navigation.navigate('ManageDevices' as never);
        }}
        onRemoteAccess={() => {
          setMenuVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressText: { color: palette.textMuted, fontWeight: '700' },
  wizardWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    maxWidth: maxContentWidth + 80,
    width: '100%',
    alignSelf: 'center',
  },
  httpNotice: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  httpNoticeText: { color: '#9a3412', fontWeight: '700' },
  block: { flex: 1, gap: spacing.md },
  bigIcon: { fontSize: 52, textAlign: 'center', marginBottom: spacing.sm },
  bodyText: { color: palette.text, lineHeight: 22, fontSize: 16, textAlign: 'center' },
  list: { gap: 8 },
  listItem: { color: palette.textMuted, lineHeight: 20, fontSize: 15 },
  panel: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  panelTitle: { color: palette.text, fontWeight: '800', fontSize: 16 },
  panelText: { color: palette.textMuted, lineHeight: 20 },
  panelActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  successPanel: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  successTitle: { color: '#166534', fontWeight: '900', fontSize: 16 },
  successText: { color: '#14532d', lineHeight: 20 },
  progressCenter: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, flex: 1 },
  webRoot: { flex: 1, backgroundColor: palette.background },
  webHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },
  webTitle: { fontSize: 16, fontWeight: '900', color: palette.text },
  webLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  webLoadingText: { color: palette.textMuted, fontWeight: '700' },
});
