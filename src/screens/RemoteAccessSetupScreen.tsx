// src/screens/RemoteAccessSetupScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { TextField } from '../components/ui/TextField';
import { useSession } from '../store/sessionStore';
import { updateHaSettings } from '../api/dinodia';
import {
  detectNabuCasaCloudUrl,
  detectNabuCasaRemoteUiUrl,
  isMaskedCloudUrl,
  verifyHaCloudConnection,
} from '../api/ha';
import { maxContentWidth, palette, radii, spacing, typography } from '../ui/theme';

const DEFAULT_HA_SETUP_BASE_URL = 'http://homeassistant.local:8123';
const HA_USERNAME = 'dinodiasmarthub_admin';
const HA_PASSWORD = 'DinodiaSmartHub123';
const LOCAL_HOST = 'homeassistant.local:8123';
const LOG_TAG = '[RemoteAccessSetup]';

const CLIPBOARD_HOOK_SCRIPT = `
  (function() {
    try {
      window.__DINODIA_DEBUG__ = ${__DEV__ ? 'true' : 'false'};
      const post = (url) => {
        if (!url || typeof url !== 'string') return;
        if (!url.includes('.ui.nabu.casa')) return;
        try {
          window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CLOUD_URL', url, source: 'clipboard' }));
        } catch (e) {}
      };
      const origWrite = navigator.clipboard && navigator.clipboard.writeText;
      if (origWrite) {
        navigator.clipboard.writeText = async function(str) {
          try { post(str); } catch (e) {}
          return origWrite.call(navigator.clipboard, str);
        };
      }
      const origExec = document.execCommand;
      document.execCommand = function(cmd, ...args) {
        if ((cmd || '').toLowerCase() === 'copy') {
          try {
            const selection = window.getSelection ? window.getSelection().toString() : '';
            post(selection);
          } catch (e) {}
        }
        return origExec.apply(document, [cmd, ...args]);
      };
    } catch (e) {
      // ignore
    }
  })();
`;

const AUTO_LOGIN_SCRIPT = `
  (function() {
    const USERNAME = '${HA_USERNAME}';
    const PASSWORD = '${HA_PASSWORD}';
    const MAX_ATTEMPTS = 6;
    let attempts = 0;

    function isAuthPath() {
      try {
        const path = window.location.pathname || '';
        return path.startsWith('/auth/authorize') || path.startsWith('/auth/login');
      } catch (e) {
        return false;
      }
    }

    function findSubmitButton() {
      const selectors = [
        'button[type="submit"]',
        'mwc-button[slot="primaryAction"]',
        'ha-progress-button',
        'ha-button',
        'button'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && typeof el.click === 'function') return el;
      }
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => /log\\s*in|login|sign\\s*in/i.test(b.textContent || '')) || null;
    }

    function fillAndClick() {
      if (!isAuthPath()) return false;
      const userInput =
        document.querySelector('input[name="username"]') ||
        document.querySelector('input#username') ||
        document.querySelector('input[type="email"]') ||
        document.querySelector('input[type="text"]');
      const passInput =
        document.querySelector('input[type="password"]') ||
        document.querySelector('input#password');
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
      } catch (err) {
        // ignore
      }
      if (attempts < MAX_ATTEMPTS) {
        const delay = 500 + attempts * 300;
        setTimeout(tick, delay);
      }
    }

    setTimeout(tick, 400);
  })();
`;

const HARDEN_CLOUD_PAGE_SCRIPT = `
  (function() {
    try {
      const style = document.createElement('style');
      style.innerHTML = \`
        header, app-toolbar, app-header, ha-tabs, ha-sidebar, mwc-list-item, ha-menu-button,
        a[href="/"], a[href="/lovelace"], a[href="/config"], a[href="/config/integrations"],
        a[href="/config/users"] { display: none !important; }
        a[href*="/config/"], a[href*="/lovelace"], a[href*="/settings"] { pointer-events: none !important; opacity: 0.35 !important; }
        ha-sidebar { width: 0 !important; }
      \`;
      document.head.appendChild(style);
    } catch (e) {}

    let postedCloud = false;
    function scanForCloudLink() {
      try {
        if (postedCloud) return;
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          const href = (link.getAttribute('href') || link.textContent || '').trim();
          if (href.includes('.ui.nabu.casa')) {
            postedCloud = true;
            window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CLOUD_URL', url: href }));
            break;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    setInterval(scanForCloudLink, 1200);
  })();
`;

const CLOUD_CAPTURE_SCRIPT = `
  (function() {
    let lastSent = '';
    const postUrl = (url) => {
      if (!url || typeof url !== 'string') return;
      if (!url.includes('.ui.nabu.casa')) return;
      if (url === lastSent) return;
      lastSent = url;
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CLOUD_URL', url }));
      } catch (e) {}
    };

    function collectRoots() {
      const roots = [document];
      const walk = (node) => {
        if (!node || !node.querySelectorAll) return;
        const elems = Array.from(node.querySelectorAll('*'));
        for (const el of elems) {
          if (el.shadowRoot && !roots.includes(el.shadowRoot)) {
            roots.push(el.shadowRoot);
            walk(el.shadowRoot);
          }
        }
      };
      walk(document);
      return roots;
    }

    function findCopyButtons(roots) {
      const buttons = [];
      roots.forEach((root) => {
        try {
          buttons.push(...Array.from(root.querySelectorAll('button')));
        } catch (e) {}
      });
      return buttons.filter((b) => /copy\\s*link/i.test(b.textContent || ''));
    }

    function autoClickCopy(roots) {
      if (window.__dinodiaCopyAttempted) return;
      window.__dinodiaCopyAttempted = true;
      const btn = findCopyButtons(roots)[0];
      if (btn && typeof btn.click === 'function') {
        try { btn.click(); } catch (e) {}
      }
    }

    function scan() {
      try {
        const roots = collectRoots();
        roots.forEach((root) => {
          try {
            const inputs = Array.from(root.querySelectorAll('input,textarea,a'));
            for (const el of inputs) {
              const val = el.value || el.href || '';
              if (typeof val === 'string' && val.includes('.ui.nabu.casa')) {
                postUrl(val.trim());
                break;
              }
            }
          } catch (e) {}
        });
        roots.forEach((root) => {
          try {
            const text = root.textContent || '';
            if (text && text.length < 200000) {
              const match = text.match(/https:\\/\\/[^\\s"']+\\.ui\\.nabu\\.casa[^\\s"']*/i);
              if (match && match[0]) postUrl(match[0]);
            }
          } catch (e) {}
        });
        const buttons = findCopyButtons(roots);
        buttons.forEach((btn) => {
          if (btn.__dinodia_hooked) return;
          btn.__dinodia_hooked = true;
          btn.addEventListener(
            'click',
            () => {
              try {
                const secrets = [];
                roots.forEach((root) => {
                  try {
                    secrets.push(...Array.from(root.querySelectorAll('input,textarea')));
                  } catch (e) {}
                });
                for (const el of secrets) {
                  const val = el.value || '';
                  if (typeof val === 'string' && val.includes('.ui.nabu.casa')) {
                    postUrl(val.trim());
                    break;
                  }
                }
              } catch (e) {}
            },
            true
          );
        });
        const path = window.location.pathname || '';
        if (path.startsWith('/config/cloud')) {
          autoClickCopy(roots);
        }
      } catch (e) {}
    }

    function runShallowScan() {
      try {
        const inputs = Array.from(document.querySelectorAll('input,textarea,a'));
        for (const el of inputs) {
          const val = el.value || el.href || '';
          if (typeof val === 'string' && val.includes('.ui.nabu.casa')) {
            postUrl(val.trim());
            break;
          }
        }
        const text = document.body ? document.body.innerText : '';
        if (text && text.length < 200000) {
          const match = text.match(/https:\\/\\/[^\\s"']+\\.ui\\.nabu\\.casa[^\\s"']*/i);
          if (match && match[0]) postUrl(match[0]);
        }
      } catch (e) {}
    }

    runShallowScan();
    scan();
    setInterval(scan, 1200);
  })();
`;

export function RemoteAccessSetupScreen() {
  const navigation = useNavigation<any>();
  const { session, setSession, resetApp } = useSession();
  const user = session.user;
  const haConnection = session.haConnection;

  const baseUrl = useMemo(
    () => (haConnection?.baseUrl ?? '').trim().replace(/\/+$/, ''),
    [haConnection?.baseUrl]
  );
  const normalizeBase = useCallback((value: string) => value.trim().replace(/\/+$/, ''), []);
  const [setupBaseUrl, setSetupBaseUrl] = useState(() => {
    const configured = normalizeBase(baseUrl || '');
    if (configured) return configured;
    return normalizeBase(DEFAULT_HA_SETUP_BASE_URL);
  });
  const webViewRef = useRef<WebView>(null);
  const setupHost = useMemo(() => {
    try {
      return new URL(setupBaseUrl).host.toLowerCase();
    } catch {
      return '';
    }
  }, [setupBaseUrl]);
  const baseHost = useMemo(() => {
    try {
      return new URL(baseUrl).host.toLowerCase();
    } catch {
      return '';
    }
  }, [baseUrl]);
  const allowedHosts = useMemo(() => {
    const hosts = new Set<string>();
    if (baseHost) hosts.add(baseHost);
    if (setupHost) hosts.add(setupHost);
    hosts.add('account.nabucasa.com');
    hosts.add('auth.nabucasa.com');
    hosts.add('www.nabucasa.com');
    hosts.add('cloud.nabucasa.com');
    return hosts;
  }, [baseHost, setupHost]);
  const setupCloudAccountUrl = setupBaseUrl ? `${setupBaseUrl}/config/cloud/account` : '';
  const [webviewVisible, setWebviewVisible] = useState<boolean>(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [cloudUrlInput, setCloudUrlInput] = useState(haConnection?.cloudUrl ?? '');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loginPromptVisible, setLoginPromptVisible] = useState(false);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const debugEnabled = __DEV__;
  const hasAutoSavedRef = useRef(false);
  const [lastProbeSuccess, setLastProbeSuccess] = useState(false);
  const [hasSavedCloudUrl, setHasSavedCloudUrl] = useState(false);
  const [candidateCloudUrl, setCandidateCloudUrl] = useState<string | null>(null);
  const [cloudCheckStatus, setCloudCheckStatus] = useState<'idle' | 'checking' | 'green' | 'red'>(
    'idle'
  );
  const [cloudCheckLastError, setCloudCheckLastError] = useState<string | null>(null);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [hasAcknowledgedLogin, setHasAcknowledgedLogin] = useState(false);
  const [allowReconnect, setAllowReconnect] = useState(false);
  const [showConnectSection, setShowConnectSection] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const existingCloudUrl = useMemo(
    () => (haConnection?.cloudUrl ?? '').trim().replace(/\/+$/, ''),
    [haConnection?.cloudUrl]
  );
  const checkingCandidate = Boolean(hasAcknowledgedLogin && candidateCloudUrl);
  const cloudConnected =
    cloudCheckStatus === 'green' && !checkingCandidate && Boolean(existingCloudUrl);
  const connectDisabled = cloudConnected && !allowReconnect;
  const effectiveCloudUrl = useMemo(() => {
    if (checkingCandidate && candidateCloudUrl) return candidateCloudUrl;
    if (existingCloudUrl) return existingCloudUrl;
    return '';
  }, [candidateCloudUrl, checkingCandidate, existingCloudUrl]);

  useEffect(() => {
    if (cloudConnected && !allowReconnect) {
      setShowConnectSection(false);
    }
  }, [allowReconnect, cloudConnected]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setCloudCheckStatus('checking');
    setCloudCheckLastError(null);
    setTimeout(() => {
      setRefreshing(false);
    }, 500);
  }, []);

  useEffect(() => {
    setCloudUrlInput(haConnection?.cloudUrl ?? '');
  }, [haConnection?.cloudUrl]);

  useEffect(() => {
    const configured = normalizeBase(baseUrl || '');
    if (configured) {
      setSetupBaseUrl(configured);
    }
  }, [baseUrl, normalizeBase]);

  useEffect(() => {
    if (setupCloudAccountUrl) {
      setWebviewKey((k) => k + 1);
    }
  }, [setupCloudAccountUrl]);

  useEffect(() => {
    if (
      !hasAcknowledgedLogin ||
      !baseUrl ||
      !haConnection?.longLivedToken ||
      hasAutoSavedRef.current ||
      candidateCloudUrl
    ) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const haLike = { baseUrl, longLivedToken: haConnection.longLivedToken };
    const poll = async () => {
      const found =
        (await detectNabuCasaRemoteUiUrl(haLike, 3000)) ||
        (await detectNabuCasaCloudUrl(haLike, 3000));
      if (!cancelled && found) {
        await handleDetectedUrl(found, 'auto-api');
      }
    };
    void poll();
    const id = setInterval(async () => {
      if (cancelled || hasAutoSavedRef.current || candidateCloudUrl) {
        clearInterval(id);
        return;
      }
      attempts += 1;
      if (attempts * 2000 >= 90000) {
        clearInterval(id);
        return;
      }
      await poll();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    baseUrl,
    candidateCloudUrl,
    haConnection?.longLivedToken,
    handleDetectedUrl,
    hasAcknowledgedLogin,
  ]);

  const normalizeCloudUrl = useCallback((value: string) => {
    const trimmed = value.trim();
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('invalid');
    }
    return parsed.toString().replace(/\/+$/, '');
  }, []);

  const saveCloudUrl = useCallback(
    async (
      value: string,
      source: 'manual' | 'auto-api' | 'auto-dom' | 'clipboard' | 'shadow-scan'
    ): Promise<{ ok: true; updated: typeof haConnection } | { ok: false; errorMessage: string }> => {
      if (!user || !haConnection) {
        const msg = 'You must be logged in as a homeowner to continue.';
        return { ok: false, errorMessage: msg };
      }

      let normalized: string;
      try {
        normalized = normalizeCloudUrl(value);
      } catch {
        const msg = 'Enter a valid remote access link like https://xxxxx.ui.nabu.casa';
        return { ok: false, errorMessage: msg };
      }

      const current = (cloudUrlInput || '').trim().replace(/\/+$/, '');
      if (source !== 'manual' && hasAutoSavedRef.current && current === normalized) {
        return { ok: true, updated: haConnection };
      }

      if (source === 'manual') {
        setSessionExpired(false);
      }

      try {
        const updated = await updateHaSettings({
          adminId: user.id,
          haUsername: haConnection.haUsername,
          haBaseUrl: haConnection.baseUrl,
          haCloudUrl: normalized,
        });
        if (!updated || (updated as any).cloudUrl !== normalized) {
          const msg =
            'Remote access works, but we could not save it to Dinodia. Please try again or contact support.';
          return { ok: false, errorMessage: msg };
        }
        setSessionExpired(false);
        await setSession({ user, haConnection: updated });
        hasAutoSavedRef.current = true;
        setHasSavedCloudUrl(true);
        setCloudUrlInput(updated.cloudUrl ?? normalized);

        setLastProbeSuccess(true);
        return { ok: true, updated };
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Remote access works, but we could not save it to Dinodia. Please try again or contact support.';
        if (typeof message === 'string' && message.toLowerCase().includes('session expired')) {
          setSessionExpired(true);
        }
        if (__DEV__) {
          console.log(`${LOG_TAG}[SAVE_ERROR]`, {
            error: message,
            haConnectionId: haConnection.id,
          });
        }
        return { ok: false, errorMessage: message };
      }
    },
    [cloudUrlInput, haConnection, normalizeCloudUrl, setSession, user]
  );

  const handleSaveCloudUrl = async () => {
    const raw = cloudUrlInput.trim();
    if (!raw) {
      return;
    }
    if (isMaskedCloudUrl(raw)) {
      return;
    }
    let normalized: string;
    try {
      normalized = normalizeCloudUrl(raw);
    } catch {
      return;
    }

    setCandidateCloudUrl(normalized);
    const result = await saveCloudUrl(normalized, 'manual');
    if (!result.ok) {
      setSaveCompleted(false);
      return;
    }
  };

  const handleDetectedUrl = useCallback(
    async (
      url: string,
      source: 'auto-api' | 'auto-dom' | 'manual' | 'clipboard' | 'shadow-scan'
    ) => {
      if (!hasAcknowledgedLogin) return;
      if (!url) return;
      if (isMaskedCloudUrl(url)) {
        return;
      }
      try {
        const normalized = normalizeCloudUrl(url);
        const current = (cloudUrlInput || '').trim().replace(/\/+$/, '');
        if (hasAutoSavedRef.current && current === normalized) return;
        if (candidateCloudUrl === normalized) return;
        setCandidateCloudUrl(normalized);
        setCloudUrlInput(normalized);
        setCloudCheckStatus('checking');
        setCloudCheckLastError(null);
      } catch {
        // ignore invalid detected values
      }
    },
    [candidateCloudUrl, cloudUrlInput, hasAcknowledgedLogin, normalizeCloudUrl]
  );

  const isAllowedNavigation = useCallback(
    (url: string) => {
      if (!url || url.startsWith('about:')) return true;
      try {
        const parsed = new URL(url);
        const host = parsed.host.toLowerCase();
        const pathname = parsed.pathname || '/';
        const isHaHost = host === baseHost || host === setupHost;
        if (isHaHost) {
          if (pathname.startsWith('/config/cloud')) return true;
          if (pathname.startsWith('/auth')) return true;
          return false;
        }
        if (allowedHosts.has(host)) return true;
        if (debugEnabled && host.endsWith('nabucasa.com')) return true;
        if (host.endsWith('.ui.nabu.casa')) return true;
        return false;
      } catch {
        return false;
      }
    },
    [allowedHosts, baseHost, debugEnabled, setupHost]
  );

  const navigateInWebView = useCallback(
    (targetUrl: string) => {
      if (webViewRef.current && targetUrl) {
        const js = `try{window.location.replace(${JSON.stringify(targetUrl)});}catch(e){}; true;`;
        webViewRef.current.injectJavaScript(js);
      } else {
        setWebviewKey((k) => k + 1);
      }
    },
    []
  );

  const returnToCloud = useCallback(() => {
    setBlockedUrl(null);
    if (setupCloudAccountUrl) {
      navigateInWebView(setupCloudAccountUrl);
    } else {
      setWebviewVisible(true);
      setWebviewKey((k) => k + 1);
    }
  }, [navigateInWebView, setupCloudAccountUrl]);

  const handleNavigationChange = useCallback(
    (event: any) => {
      const url: string = event?.url || '';
      if (__DEV__) {
        try {
          const parsed = new URL(url);
          const keys = Array.from(new URLSearchParams(parsed.search).keys());
          const redactedKeys = keys.join(',') || 'none';
          console.log(
            `${LOG_TAG}[NAV]`,
            `host=${parsed.host} path=${parsed.pathname} queryKeys=${redactedKeys}`
          );
          if (parsed.host.endsWith('nabucasa.com')) {
            console.log(`${LOG_TAG}[NABU]`, `host=${parsed.host} path=${parsed.pathname}`);
            const params = new URLSearchParams(parsed.search);
            const ruRaw = params.get('redirect_uri');
            if (ruRaw) {
              let decoded = ruRaw;
              try {
                decoded = decodeURIComponent(ruRaw);
              } catch {
                // ignore decode errors
              }
              try {
                const ruParsed = new URL(decoded);
                console.log(`${LOG_TAG}[OAUTH]`, {
                  authHost: parsed.host,
                  redirectHostPath: `${ruParsed.host}${ruParsed.pathname}`,
                });
              } catch {
                // ignore parse errors
              }
            }
          }
        } catch {
          console.log(`${LOG_TAG}[NAV]`, 'unparseable url');
        }
      }
      if (!isAllowedNavigation(url)) {
        setBlockedUrl(url);
        if (__DEV__) {
          console.log(`${LOG_TAG}[BLOCK]`, url);
        }
        returnToCloud();
        return;
      }
      if (url.includes('/auth/authorize') || url.includes('/auth/login')) {
        setLoginPromptVisible(true);
      } else if (url.includes('/config/cloud')) {
        setLoginPromptVisible(false);
      }
    },
    [isAllowedNavigation, returnToCloud]
  );

  function hasUnsafeAuthCreds(url: string) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname || '';
      if (!path.startsWith('/auth/authorize')) return false;
      const params = new URLSearchParams(parsed.search);
      return params.has('username') || params.has('password');
    } catch {
      return false;
    }
  }

  const handleShouldStartLoadWithRequest = useCallback(
    (request: any) => {
      const rawUrl = request?.url || '';
      if (!rawUrl) return false;

      if (hasUnsafeAuthCreds(rawUrl)) {
        if (__DEV__) {
          console.log(`${LOG_TAG}[BLOCK]`, rawUrl);
        }
        return false;
      }

      const callbackRewrite = rewriteHaLocalToBase(rawUrl);
      if (callbackRewrite && callbackRewrite !== rawUrl) {
        if (__DEV__) {
          console.log(`${LOG_TAG}[REWRITE]`, { from: rawUrl, to: callbackRewrite });
        }
        navigateInWebView(callbackRewrite);
        return false;
      }

      const authRewrite = rewriteNabuRedirectUri(rawUrl);
      if (authRewrite && authRewrite !== rawUrl) {
        if (__DEV__) {
          console.log(`${LOG_TAG}[REWRITE]`, { from: rawUrl, to: authRewrite });
        }
        navigateInWebView(authRewrite);
        return false;
      }

      const ok = isAllowedNavigation(rawUrl);
      if (!ok) {
        setBlockedUrl(rawUrl);
        if (__DEV__) {
          console.log(`${LOG_TAG}[BLOCK]`, rawUrl);
        }
        returnToCloud();
      }
      return ok;
    },
    [
      hasUnsafeAuthCreds,
      isAllowedNavigation,
      navigateInWebView,
      returnToCloud,
      rewriteHaLocalToBase,
      rewriteNabuRedirectUri,
    ]
  );

  const handleWebViewMessage = useCallback(
    (event: any) => {
      if (!hasAcknowledgedLogin) return;
      try {
        const data = JSON.parse(event?.nativeEvent?.data ?? '{}');
        if (data?.type === 'CLOUD_URL' && typeof data.url === 'string') {
          const source: 'auto-dom' | 'clipboard' | 'shadow-scan' =
            typeof data.source === 'string' && data.source.length > 0
              ? (data.source as any)
              : 'auto-dom';
          void handleDetectedUrl(data.url, source);
        }
      } catch {
        // ignore malformed messages
      }
    },
    [handleDetectedUrl, hasAcknowledgedLogin]
  );

  const handleWebviewError = useCallback(() => {
    if (__DEV__) {
      console.log(`${LOG_TAG}[WEBVIEW_ERROR]`);
    }
  }, []);

  const saveVerifiedCloudUrl = useCallback(async () => {
    if (!candidateCloudUrl || !haConnection || !user || saveCompleted || hasAutoSavedRef.current) {
      return;
    }
    const result = await saveCloudUrl(candidateCloudUrl, 'auto-api');
    if (!result.ok) {
      setSaveCompleted(false);
      setCloudCheckStatus('red');
      setCloudCheckLastError(result.errorMessage);
      return;
    }
    const expected = candidateCloudUrl.replace(/\/+$/, '');
    const returned = (result.updated as any)?.cloudUrl?.replace(/\/+$/, '');
    if (returned !== expected) {
      if (__DEV__) {
        console.log(`${LOG_TAG}[SAVE_MISMATCH]`, {
          haConnectionId: haConnection.id,
          expected,
          returned,
        });
      }
      setSaveCompleted(false);
      setCloudCheckStatus('red');
      setCloudCheckLastError(
        'Remote access works, but we could not save it to Dinodia. Please try again or contact support.'
      );
      return;
    }
    setSaveCompleted(true);
    setWebviewVisible(false);
    setWebviewKey((k) => k + 1);
    if (typeof navigation?.canGoBack === 'function') {
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    } else {
      navigation.goBack?.();
    }
  }, [candidateCloudUrl, haConnection, navigation, saveCompleted, saveCloudUrl, user]);

  useEffect(() => {
    if (!effectiveCloudUrl || !haConnection?.longLivedToken) {
      setCloudCheckStatus('checking');
      setCloudCheckLastError(null);
      return;
    }
    let cancelled = false;
    let elapsed = 0;
    let successCount = 0;
    setCloudCheckStatus('checking');
    setCloudCheckLastError(null);
    const verify = async () => {
      const ok = await verifyHaCloudConnection(
        { baseUrl: effectiveCloudUrl, longLivedToken: haConnection.longLivedToken },
        4000
      );
      if (cancelled) return;
      if (ok) {
        successCount += 1;
        setCloudCheckStatus('green');
        setCloudCheckLastError(null);
        if (checkingCandidate && successCount >= 1) {
          await saveVerifiedCloudUrl();
          return;
        }
      } else {
        successCount = 0;
        setCloudCheckStatus('red');
        setCloudCheckLastError('Remote access not reachable yet. Finish Nabu Casa login.');
      }
    };
    void verify();
    const id = setInterval(() => {
      if (cancelled || saveCompleted || hasAutoSavedRef.current) {
        clearInterval(id);
        return;
      }
      elapsed += 2000;
      if (elapsed >= 180000) {
        clearInterval(id);
        return;
      }
      void verify();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    checkingCandidate,
    effectiveCloudUrl,
    haConnection?.longLivedToken,
    saveCompleted,
    saveVerifiedCloudUrl,
  ]);

  const rewriteHaLocalToBase = useCallback(
    (url: string) => {
      if (!baseUrl || !baseHost || debugEnabled) return null;
      try {
        const parsed = new URL(url);
        const host = parsed.host.toLowerCase();
        if (host !== 'homeassistant.local:8123' && parsed.hostname.toLowerCase() !== 'homeassistant.local') return null;
        if (baseHost === 'homeassistant.local') return null;
        const baseParsed = new URL(baseUrl);
        const rewritten = `${baseParsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        return rewritten;
      } catch {
        return null;
      }
    },
    [baseHost, baseUrl, debugEnabled]
  );

  const rewriteNabuRedirectUri = useCallback(
    (url: string) => {
      const hubHosts = [baseHost, setupHost].filter(Boolean);
      if (hubHosts.length === 0 || debugEnabled) return null;
      try {
        const parsed = new URL(url);
        const host = parsed.host.toLowerCase();
        if (!host.includes('nabucasa.com')) return null;
        const params = new URLSearchParams(parsed.search);
        const redirectUri = params.get('redirect_uri');
        if (!redirectUri) return null;
        const redirectParsed = new URL(redirectUri);
        if (
          redirectParsed.hostname.toLowerCase() === 'homeassistant.local' ||
          redirectParsed.host.toLowerCase() === 'homeassistant.local:8123'
        ) {
          return null;
        }
        if (!hubHosts.includes(redirectParsed.host.toLowerCase())) return null;
        const rewrittenRedirect = `http://homeassistant.local:8123${redirectParsed.pathname}${redirectParsed.search}${redirectParsed.hash}`;
        params.set('redirect_uri', rewrittenRedirect);
        parsed.search = params.toString();
        return parsed.toString();
      } catch {
        return null;
      }
    },
    [baseHost, debugEnabled, setupHost]
  );

  const missingBase = !baseUrl || !haConnection || !user;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.header}>Enable Remote Access (Nabu Casa)</Text>
          <PrimaryButton
            title="Exit to Dashboard"
            onPress={() => navigation.navigate('AdminDashboard' as never)}
            variant="ghost"
            style={[styles.compactButton, styles.exitButton]}
          />
        </View>
        <Text style={styles.subheader}>
          Use the in-home kiosk on your Wi‑Fi to link your Dinodia Hub to Nabu Casa without exposing
          the Hub password.
        </Text>

        {missingBase ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dinodia Hub URL not set</Text>
            <Text style={styles.cardText}>
              Go back to Admin Settings and add your Dinodia Hub address on home Wi‑Fi before
              enabling remote access.
            </Text>
            <PrimaryButton
              title="Back to Admin Settings"
              onPress={() => navigation.goBack()}
              style={[styles.compactButton, { marginTop: spacing.md }]}
            />
          </View>
        ) : (
          <>
            {cloudConnected && !allowReconnect ? (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedTitle}>
                  Your Dinodia Home is already connected to the cloud!
                </Text>
                <PrimaryButton
                  title="I want to Change my Nabu Casa account"
                  onPress={() => {
                    setAllowReconnect(true);
                    setHasAcknowledgedLogin(false);
                    setCandidateCloudUrl(null);
                    setCloudCheckLastError(null);
                    setCloudCheckStatus('checking');
                    setSaveCompleted(false);
                    hasAutoSavedRef.current = false;
                    setShowConnectSection(true);
                  }}
                  variant="ghost"
                  style={[styles.compactButton, { marginTop: spacing.sm }]}
                />
              </View>
            ) : (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedTitle}>Cloud mode isn’t set up yet.</Text>
                <PrimaryButton
                  title="Setup Cloud Mode!"
                  onPress={() => setShowConnectSection(true)}
                  style={[styles.compactButton, { marginTop: spacing.sm }]}
                />
              </View>
            )}

            {showConnectSection ? (
              <View
                style={[styles.card, connectDisabled && styles.cardDisabled]}
                pointerEvents={connectDisabled ? 'none' : 'auto'}
              >
                <Text style={styles.cardTitle}>Connect your Nabu Casa to your Dinodia Hub</Text>
                <PrimaryButton
                  title="Connect"
                  onPress={() => {
                    setWebviewVisible(true);
                    setWebviewKey((k) => k + 1);
                  }}
                  style={[styles.compactButton, { marginTop: spacing.md }]}
                />
                <TouchableOpacity
                  onPress={() => setHasAcknowledgedLogin((prev) => !prev)}
                  style={styles.checkboxRow}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.checkbox,
                      hasAcknowledgedLogin && styles.checkboxChecked,
                    ]}
                  >
                    {hasAcknowledgedLogin ? (
                      <Text style={styles.checkboxMark}>X</Text>
                    ) : null}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    I have logged into my Nabu Casa account and unhidden the remote URL
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Confirming Connection</Text>
              <View style={styles.connectionRow}>
                {cloudCheckStatus === 'green' ? (
                  <View style={[styles.statusDot, styles.statusDotSuccess]}>
                    <Text style={styles.statusDotText}>OK</Text>
                  </View>
                ) : cloudCheckStatus === 'red' ? (
                  <View style={[styles.statusDot, styles.statusDotError]}>
                    <Text style={styles.statusDotText}>!</Text>
                  </View>
                ) : (
                  <ActivityIndicator size="small" color={palette.primary} />
                )}
                <Text style={styles.connectionText}>
                  {cloudCheckStatus === 'green'
                    ? 'Connected'
                    : cloudCheckStatus === 'red'
                    ? 'Unable to connect'
                    : 'Connecting…'}
                </Text>
              </View>
              <TextField
                label="Remote access link"
                value={cloudUrlInput}
                placeholder="Waiting for the remote access link…"
                editable={false}
                style={styles.readonlyInput}
              />
              {cloudCheckStatus === 'red' && cloudCheckLastError ? (
                <Text style={styles.errorText}>{cloudCheckLastError}</Text>
              ) : null}
              {sessionExpired ? (
                <PrimaryButton
                  title="Log in again"
                  onPress={() => void resetApp()}
                  variant="ghost"
                  style={[styles.compactButton, { marginTop: spacing.xs }]}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={webviewVisible && !!setupCloudAccountUrl}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setWebviewVisible(false)}
      >
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Dinodia Hub — Cloud login</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => {
                  setWebviewVisible(false);
                  setWebviewKey((k) => k + 1);
                }}
                style={styles.modalClose}
                disabled={!hasSavedCloudUrl && !lastProbeSuccess && !saveCompleted}
              >
                <Text
                  style={[
                    styles.modalCloseText,
                    (!hasSavedCloudUrl && !lastProbeSuccess && !saveCompleted) && { opacity: 0.5 },
                  ]}
                >
                  Done
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setWebviewVisible(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.modalHelper}>
            Sign into your Nabu Casa account on this page to connect cloud. We will detect the
            Remote access link automatically.
          </Text>
          {loginPromptVisible ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                This kiosk signs into the Dinodia Hub automatically. If you still see a login page
                (or extra verification like 2FA), close and reopen. If it keeps showing, contact
                installer support.
              </Text>
            </View>
          ) : null}
          {blockedUrl ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                For security, only Nabu Casa setup is available here. Navigation to other pages was
                blocked.
              </Text>
              <PrimaryButton
                title="Return to Cloud setup"
                variant="ghost"
                onPress={returnToCloud}
                style={[styles.compactButton, { marginTop: spacing.sm }]}
              />
            </View>
          ) : null}
          {setupCloudAccountUrl ? (
            <WebView
              key={webviewKey}
              source={{ uri: setupCloudAccountUrl }}
              onNavigationStateChange={handleNavigationChange}
              injectedJavaScriptBeforeContentLoaded={AUTO_LOGIN_SCRIPT}
              injectedJavaScript={`${debugEnabled ? '' : HARDEN_CLOUD_PAGE_SCRIPT}\n${CLOUD_CAPTURE_SCRIPT}`}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onMessage={handleWebViewMessage}
              onError={handleWebviewError}
              onHttpError={handleWebviewError}
              incognito
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled={false}
              domStorageEnabled
              cacheEnabled={false}
              startInLoadingState
              javaScriptEnabled
              ref={webViewRef}
              style={styles.webview}
            />
          ) : (
            <View style={styles.webviewFallback}>
              <Text style={styles.errorText}>
                Dinodia Hub URL missing. Close this window and update your settings.
              </Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  header: { ...typography.heading, letterSpacing: 0.2 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  subheader: { color: palette.textMuted, marginTop: 4, lineHeight: 20 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  cardText: { color: palette.text, lineHeight: 20 },
  cardMeta: { color: palette.textMuted, fontSize: 13 },
  cardHint: { color: palette.textMuted, fontSize: 13 },
  cardDisabled: { opacity: 0.45 },
  connectedBanner: {
    backgroundColor: '#eef6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  connectedTitle: { color: '#1d4ed8', fontWeight: '700' },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  checkboxChecked: {
    borderColor: palette.primary,
    backgroundColor: '#e0f2fe',
  },
  checkboxMark: { color: palette.primary, fontWeight: '800', fontSize: 11 },
  checkboxLabel: { color: palette.text, flex: 1, lineHeight: 18 },
  warningBox: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 4,
  },
  warningTitle: { fontWeight: '800', color: '#b45309' },
  warningText: { color: '#92400e' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { color: palette.textMuted },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  connectionText: { color: palette.text, fontWeight: '600' },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
  },
  statusDotSuccess: { backgroundColor: palette.success, borderColor: palette.success },
  statusDotError: { backgroundColor: palette.danger, borderColor: palette.danger },
  statusDotText: { color: '#ffffff', fontWeight: '800', fontSize: 11 },
  errorText: { color: palette.danger, marginTop: spacing.xs, lineHeight: 18 },
  readonlyInput: {
    backgroundColor: palette.surfaceMuted,
    color: palette.textMuted,
  },
  compactButton: {
    paddingVertical: spacing.sm,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  exitButton: {
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  statusBox: {
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  statusSuccess: { backgroundColor: '#ecfdf3', borderWidth: 1, borderColor: '#bbf7d0' },
  statusError: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecdd3' },
  statusInfo: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  statusBoxText: { fontWeight: '700' },
  modalWrap: { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: { color: '#e2e8f0', fontSize: 16, fontWeight: '800' },
  modalClose: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  modalCloseText: { color: '#cbd5e1', fontWeight: '700' },
  modalHelper: {
    color: '#cbd5e1',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  noticeBox: {
    backgroundColor: '#1f2937',
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#334155',
  },
  noticeText: { color: '#e2e8f0' },
  webview: { flex: 1, marginTop: spacing.sm },
  webviewFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
