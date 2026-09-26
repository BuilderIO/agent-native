import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { WebView as WebViewRef } from "react-native-webview";

import { NativeSignInSheet } from "@/components/NativeSignInSheet";
import { WebView } from "@/components/uniwind-interop";
import { clipsSessionOwnerKey } from "@/lib/clips-session";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { buildMobileGuestThemeScript } from "@/lib/mobile-theme";
import { useNativeAppAuthState } from "@/lib/native-app-auth";
import {
  inspectNativeSessionShared,
  NATIVE_AUTH_BASE_URL,
} from "@/lib/native-auth";
import { useCurrentPathname } from "@/lib/navigation";
import { completeOAuthCallback, rememberOAuthState } from "@/lib/oauth-session";
import {
  OAUTH_BASE_URL_KEY,
  OAUTH_OWNER_KEY_KEY,
  OAUTH_RETURN_PATH_KEY,
  OAUTH_TOKEN_STORE_KEY,
} from "@/lib/oauth-storage";
import {
  clearSessionToken,
  getSessionToken,
  saveSessionToken,
  SESSION_TOKEN_KEY,
} from "@/lib/session-token-store";
import {
  buildMobileWebViewAuthUrl,
  canCaptureMobileWebViewSession,
  resolveStickyWebViewUrl,
} from "@/lib/webview-auth-url";
import {
  isTrustedWebViewUrl,
  parseTrustedOrigin,
  shouldOpenExternalWebViewUrl,
} from "@/lib/webview-security";
import {
  createWorkspaceAppEmbedSession,
  ensureLiveWorkspaceAppSessionsHydrated,
  mobileSessionFingerprint,
  forgetLiveWorkspaceAppSession,
  hasLiveWorkspaceAppSession,
  peekWorkspaceSsoEnabled,
  readWorkspaceSsoEnabled,
  rememberLiveWorkspaceAppSession,
} from "@/lib/workspace-app-auth";

interface AppWebViewProps {
  url: string;
  captureSessionToken?: boolean;
  sessionTokenKey?: string;
  parentSessionTokenKey?: string;
  sessionOwnerKey?: string;
  workspaceAppId?: string;
  appName?: string;
}

export interface AppWebViewHandle {
  reload: () => void;
}

const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

const GOOGLE_AUTH_URL_PATH = "/_agent-native/google/auth-url";

const MAX_AUTOMATIC_WORKSPACE_EMBED_RETRIES = 2;

const FORCE_REDIRECT_AUTH_SCRIPT = `
  (function () {
    try {
      var style = document.createElement('style');
      style.textContent = '#identity-sso-btn { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
      var markMobileGoogleAuth = function (input) {
        try {
          var raw = typeof input === 'string' ? input : input && input.url;
          if (!raw) return input;
          var parsed = new URL(raw, location.href);
          if (parsed.origin !== location.origin) return input;
          if (!/\\/_agent-native\\/google\\/(?:add-account\\/)?auth-url$/.test(parsed.pathname)) {
            return input;
          }
          parsed.searchParams.set('mobile', '1');
          if (typeof input === 'string') return parsed.toString();
          return new Request(parsed.toString(), input);
        } catch (e) {
          return input;
        }
      };
      if (!window.__agentNativeMobileGoogleAuthPatched) {
        window.__agentNativeMobileGoogleAuthPatched = true;
        var originalFetch = window.fetch;
        window.fetch = function (input, init) {
          return originalFetch.call(this, markMobileGoogleAuth(input), init);
        };
        var originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          var args = Array.prototype.slice.call(arguments);
          args[1] = markMobileGoogleAuth(url);
          return originalOpen.apply(this, args);
        };
      }
      if (
        location.pathname.endsWith('/sign-in') ||
        location.pathname.endsWith('/_agent-native/sign-in')
      ) {
        window.open = function () { return null; };
      }
    } catch (e) {}
    return true;
  })();
  true;
`;
const MOBILE_ANALYTICS_PLATFORM_SCRIPT = `
  (function () {
    window.__AGENT_NATIVE_HOST_PLATFORM__ = "mobile";
  })();
  true;
`;
const SESSION_BRIDGE_SCRIPT = `
  (function () {
    if (window.__agentNativeSessionBridgeRunning) return true;
    window.__agentNativeSessionBridgeRunning = true;
    var tokenFetchInFlight = false;
    var hasReportedSession = false;
    var postToken = function () {
      if (document.hidden || tokenFetchInFlight) return;
      tokenFetchInFlight = true;
      var controller = new AbortController();
      var abortTimer = setTimeout(function () { controller.abort(); }, 20000);
      fetch('/_agent-native/auth/session', {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (
            data &&
            typeof data.token === 'string' &&
            data.token.length > 0 &&
            typeof data.email === 'string' &&
            data.email.length > 0
          ) {
            hasReportedSession = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'agent-native-session',
              token: data.token,
              email: data.email,
              orgId: typeof data.orgId === 'string' ? data.orgId : null
            }));
          } else if (hasReportedSession) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'agent-native-session-cleared'
            }));
          }
        })
        // coercion-ok: the page keeps its current session and the 5s repost retries
        .catch(function () {})
        .then(function () { clearTimeout(abortTimer); tokenFetchInFlight = false; });
    };
    postToken();
    setTimeout(postToken, 1000);
    setInterval(postToken, 5000);
    window.addEventListener('focus', postToken);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) postToken();
    });
    return true;
  })();
  true;
`;

function isGoogleAuthUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(GOOGLE_AUTH_URL_PATH);
  } catch {
    return false;
  }
}

async function resolveGoogleAuthUrl(startUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(startUrl);
    parsed.searchParams.delete("redirect");
    parsed.searchParams.set("mobile", "1");
    const res = await fetch(parsed.toString(), {
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as { url?: unknown };
    return typeof data.url === "string" && data.url.length > 0
      ? data.url
      : null;
  } catch {
    return null;
  }
}

function embedTargetPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname || "/"}${parsed.search}`;
  } catch {
    return "/";
  }
}

const SIGN_IN_ENTRY_PATHS = [
  "/sign-in",
  "/_agent-native/sign-in",
  "/login",
  "/_agent-native/login",
  "/signup",
] as const;

function urlPathOnly(rawUrl: string): string {
  const queryOrFragmentIndex = rawUrl.search(/[?#]/);
  return queryOrFragmentIndex === -1
    ? rawUrl
    : rawUrl.slice(0, queryOrFragmentIndex);
}

function isSignInEntryUrl(rawUrl: string): boolean {
  const path = urlPathOnly(rawUrl);
  return SIGN_IN_ENTRY_PATHS.some((entry) => path.endsWith(entry));
}

function isEmbedStartUrl(rawUrl: string): boolean {
  return urlPathOnly(rawUrl).endsWith("/_agent-native/embed/start");
}

function AppWebView(
  {
    url,
    captureSessionToken = false,
    sessionTokenKey = SESSION_TOKEN_KEY,
    parentSessionTokenKey,
    sessionOwnerKey,
    workspaceAppId,
    appName,
  }: AppWebViewProps,
  ref: React.Ref<AppWebViewHandle>,
) {
  const webviewRef = useRef<WebViewRef>(null);
  const { destructive, foreground, primaryForeground, theme } =
    useMobileThemeColors();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [, setSessionToken] = useState<string | null>(null);
  const [parentSessionToken, setParentSessionToken] = useState<string | null>(
    null,
  );
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [workspaceEmbedUrl, setWorkspaceEmbedUrl] = useState<string | null>(
    null,
  );
  const [workspaceEmbedError, setWorkspaceEmbedError] = useState<string | null>(
    null,
  );
  const [workspaceEmbedState, setWorkspaceEmbedState] = useState<
    "idle" | "loading" | "disabled" | "ready" | "reused" | "error"
  >("idle");
  const [workspaceEmbedAttempt, setWorkspaceEmbedAttempt] = useState(0);
  const workspaceEmbedAutoRetryRef = useRef(0);
  const [nativeSignInOpen, setNativeSignInOpen] = useState(false);
  const lastTokenRef = useRef<string | null>(null);
  const oauthInFlightRef = useRef(false);
  const sessionUrlLoadedRef = useRef(false);
  const isFocusedRef = useRef(false);
  const loadedWebviewRef = useRef<{ owner: string | null; url: string } | null>(
    null,
  );
  const trustedOrigin = useMemo(() => parseTrustedOrigin(url), [url]);
  const { enabled: nativeAuthEnabled, ready: nativeAuthReady } =
    useNativeAppAuthState();
  const effectiveCaptureSessionToken = captureSessionToken && nativeAuthEnabled;
  const shouldHideEmbeddedAuth =
    nativeAuthEnabled &&
    Boolean(workspaceAppId) &&
    workspaceEmbedState === "ready";
  const resolvedParentSessionTokenKey =
    parentSessionTokenKey ?? sessionTokenKey;
  const canCaptureSessionToken = canCaptureMobileWebViewSession({
    enabled: effectiveCaptureSessionToken,
    sessionTokenKey,
    parentSessionTokenKey: resolvedParentSessionTokenKey,
  });

  const pathname = useCurrentPathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const refreshWorkspaceEmbed = useCallback(
    (automatic: boolean) => {
      if (workspaceAppId && parentSessionToken) {
        forgetLiveWorkspaceAppSession(workspaceAppId, parentSessionToken);
      }
      if (automatic) {
        if (
          workspaceEmbedAutoRetryRef.current >=
          MAX_AUTOMATIC_WORKSPACE_EMBED_RETRIES
        ) {
          setWorkspaceEmbedUrl(null);
          setWorkspaceEmbedError(
            "The workspace app session could not be refreshed. Try again.",
          );
          setWorkspaceEmbedState("error");
          setLoading(false);
          return;
        }
        workspaceEmbedAutoRetryRef.current += 1;
      } else {
        workspaceEmbedAutoRetryRef.current = 0;
      }
      setError(false);
      setLoading(true);
      setWorkspaceEmbedUrl(null);
      setWorkspaceEmbedError(null);
      setWorkspaceEmbedState("loading");
      setWorkspaceEmbedAttempt((attempt) => attempt + 1);
    },
    [parentSessionToken, workspaceAppId],
  );

  const reload = useCallback(() => {
    setError(false);
    setLoading(true);
    if (workspaceAppId) {
      refreshWorkspaceEmbed(false);
      return;
    }
    webviewRef.current?.reload();
  }, [refreshWorkspaceEmbed, workspaceAppId]);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  useEffect(() => {
    webviewRef.current?.injectJavaScript(buildMobileGuestThemeScript(theme));
  }, [theme]);

  const readStoredSessions = useCallback(async () => {
    const [targetToken, parentToken] = await Promise.all([
      getSessionToken(sessionTokenKey),
      getSessionToken(resolvedParentSessionTokenKey),
    ]);
    let nextTargetToken = targetToken;
    let nextParentToken = parentToken;
    if (nativeAuthEnabled && parentToken) {
      const parentCheck = await inspectNativeSessionShared(
        parentToken,
        NATIVE_AUTH_BASE_URL,
      );
      if (parentCheck.status === "invalid") {
        const currentParentToken = await getSessionToken(
          resolvedParentSessionTokenKey,
        );
        if (currentParentToken === parentToken) {
          nextParentToken = null;
          if (sessionTokenKey === resolvedParentSessionTokenKey) {
            nextTargetToken = null;
          }
        } else {
          nextParentToken = currentParentToken;
          if (sessionTokenKey === resolvedParentSessionTokenKey) {
            nextTargetToken = currentParentToken;
          }
        }
      }
    }
    lastTokenRef.current = nextTargetToken;
    setSessionToken(nextTargetToken);
    setParentSessionToken(nextParentToken);
    setSessionLoaded(true);
  }, [nativeAuthEnabled, resolvedParentSessionTokenKey, sessionTokenKey]);

  useEffect(() => {
    void readStoredSessions();
  }, [readStoredSessions]);

  useEffect(() => {
    const shouldUseWorkspaceSso =
      effectiveCaptureSessionToken && Boolean(workspaceAppId);
    if (!shouldUseWorkspaceSso || !parentSessionToken) {
      setWorkspaceEmbedUrl(null);
      setWorkspaceEmbedError(null);
      setWorkspaceEmbedState("idle");
      return;
    }

    let cancelled = false;
    setWorkspaceEmbedUrl(null);
    setWorkspaceEmbedError(null);
    setWorkspaceEmbedState("loading");
    void (async () => {
      await ensureLiveWorkspaceAppSessionsHydrated();
      if (cancelled) return;
      if (hasLiveWorkspaceAppSession(workspaceAppId!, parentSessionToken)) {
        setWorkspaceEmbedState("reused");
        return;
      }
      const mint = () =>
        createWorkspaceAppEmbedSession({
          app: workspaceAppId!,
          path: embedTargetPath(url),
        });
      const known = peekWorkspaceSsoEnabled(parentSessionToken);
      if (known === false) {
        setWorkspaceEmbedState("disabled");
        return;
      }
      const [enabled, session] =
        known === true
          ? [true, await mint()]
          : await Promise.all([
              readWorkspaceSsoEnabled(parentSessionToken),
              mint(),
            ]);
      if (cancelled) return;
      if (!enabled) {
        setWorkspaceEmbedState("disabled");
        return;
      }
      setWorkspaceEmbedUrl(session.startUrl);
      setWorkspaceEmbedState("ready");
    })().catch((cause: unknown) => {
      if (cancelled) return;
      setWorkspaceEmbedError(
        cause instanceof Error
          ? cause.message
          : "Could not open the signed-in workspace app.",
      );
      setWorkspaceEmbedState("error");
    });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveCaptureSessionToken,
    parentSessionToken,
    url,
    workspaceAppId,
    workspaceEmbedAttempt,
  ]);

  useEffect(() => {
    workspaceEmbedAutoRetryRef.current = 0;
  }, [parentSessionToken, url, workspaceAppId]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      void readStoredSessions();
      return () => {
        isFocusedRef.current = false;
      };
    }, [readStoredSessions]),
  );

  useEffect(() => {
    if (
      !effectiveCaptureSessionToken ||
      !sessionLoaded ||
      parentSessionToken ||
      !isFocusedRef.current
    ) {
      return;
    }
    setNativeSignInOpen(true);
  }, [effectiveCaptureSessionToken, parentSessionToken, sessionLoaded]);

  // surface and never receive the parent token in a URL.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setTimeout(() => {
          void readStoredSessions();
        }, 1000);
      }
    });
    return () => sub.remove();
  }, [readStoredSessions]);

  const oauthContext = useMemo(
    () => ({
      tokenKey: sessionTokenKey,
      ownerKeyName: sessionOwnerKey ?? null,
      baseUrl: trustedOrigin,
    }),
    [sessionTokenKey, sessionOwnerKey, trustedOrigin],
  );

  const persistOAuthReturnContext = useCallback(
    () =>
      AsyncStorage.multiSet([
        [OAUTH_RETURN_PATH_KEY, pathnameRef.current],
        [OAUTH_TOKEN_STORE_KEY, sessionTokenKey],
        [OAUTH_OWNER_KEY_KEY, sessionOwnerKey ?? ""],
        [OAUTH_BASE_URL_KEY, trustedOrigin ?? ""],
      ]),
    [sessionTokenKey, sessionOwnerKey, trustedOrigin],
  );

  const openGoogleSession = useCallback(
    async (googleUrl: string) => {
      if (oauthInFlightRef.current) return;
      oauthInFlightRef.current = true;
      try {
        await rememberOAuthState(googleUrl);
        await persistOAuthReturnContext();
        if (Platform.OS === "android") {
          const { preferredBrowserPackage } =
            await WebBrowser.getCustomTabsSupportingBrowsersAsync();
          await WebBrowser.openBrowserAsync(googleUrl, {
            browserPackage: preferredBrowserPackage,
            showInRecents: true,
          });
          return;
        }
        const result = await WebBrowser.openAuthSessionAsync(
          googleUrl,
          "agentnative://oauth-complete",
        );
        console.log("[oauth] auth session result:", result.type);
        if (result.type !== "success" || !result.url) return;
        const token = await completeOAuthCallback(result.url, oauthContext);
        if (token && token !== lastTokenRef.current) {
          lastTokenRef.current = token;
          setSessionToken(token);
          return;
        }
        const storedToken = await getSessionToken(sessionTokenKey);
        if (storedToken && storedToken !== lastTokenRef.current) {
          lastTokenRef.current = storedToken;
          setSessionToken(storedToken);
        }
      } catch (e) {
        console.log("[oauth] auth session error:", String(e));
      } finally {
        oauthInFlightRef.current = false;
      }
    },
    [oauthContext, persistOAuthReturnContext, sessionTokenKey],
  );

  const startGoogleAuth = useCallback(
    async (startUrl: string) => {
      const authUrl = await resolveGoogleAuthUrl(startUrl);
      if (authUrl) {
        await openGoogleSession(authUrl);
      } else {
        setError(true);
      }
    },
    [openGoogleSession],
  );

  const handleShouldStartLoad = useCallback(
    (event: { url: string }) => {
      if (
        isTrustedWebViewUrl(event.url, trustedOrigin) &&
        isGoogleAuthUrl(event.url)
      ) {
        void startGoogleAuth(event.url);
        return false;
      }
      if (isTrustedWebViewUrl(event.url, trustedOrigin)) return true;
      try {
        const parsed = new URL(event.url);
        if (parsed.protocol === "about:") return true;
        parsed.searchParams.delete("_session");
        if (parsed.hostname === "accounts.google.com") {
          void openGoogleSession(parsed.toString());
          return false;
        }
        if (shouldOpenExternalWebViewUrl(parsed.toString())) {
          void Linking.openURL(parsed.toString());
        }
      } catch {
        // Invalid and non-web URLs do not belong in the authenticated WebView.
      }
      return false;
    },
    [trustedOrigin, startGoogleAuth, openGoogleSession],
  );

  const handleOpenWindow = useCallback(
    (event: { nativeEvent: { targetUrl?: string } }) => {
      const targetUrl = event.nativeEvent.targetUrl;
      if (typeof targetUrl === "string" && targetUrl.length > 0) {
        void handleShouldStartLoad({ url: targetUrl });
      }
    },
    [handleShouldStartLoad],
  );

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string; url: string } }) => {
      if (!isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)) return;
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (workspaceAppId && msg.type === "agentNative.embedSessionExpired") {
          refreshWorkspaceEmbed(true);
          return;
        }
        if (
          canCaptureSessionToken &&
          isFocusedRef.current &&
          msg.type === "agent-native-session" &&
          typeof msg.token === "string" &&
          msg.token.length > 0 &&
          (!sessionOwnerKey ||
            (typeof msg.email === "string" && msg.email.trim().length > 0))
        ) {
          void (async () => {
            if (!isFocusedRef.current) return;
            await saveSessionToken(msg.token, sessionTokenKey);
            if (!isFocusedRef.current) return;
            if (sessionOwnerKey) {
              await AsyncStorage.setItem(
                sessionOwnerKey,
                clipsSessionOwnerKey(
                  msg.email,
                  typeof msg.orgId === "string" ? msg.orgId : undefined,
                ),
              );
            }
            sessionUrlLoadedRef.current = true;
            if (msg.token !== lastTokenRef.current) {
              lastTokenRef.current = msg.token;
              setSessionToken(msg.token);
              if (sessionTokenKey === resolvedParentSessionTokenKey) {
                setParentSessionToken(msg.token);
              }
            }
          })().catch(() => {});
          return;
        }
        if (
          canCaptureSessionToken &&
          isFocusedRef.current &&
          msg.type === "agent-native-session-cleared"
        ) {
          void (async () => {
            if (!isFocusedRef.current) return;
            if (oauthInFlightRef.current) return;
            if (!sessionUrlLoadedRef.current) {
              const storedToken =
                lastTokenRef.current ??
                (await getSessionToken(sessionTokenKey));
              if (storedToken) {
                lastTokenRef.current = storedToken;
                setSessionToken(storedToken);
                return;
              }
            }
            await clearSessionToken(sessionTokenKey);
            if (sessionOwnerKey) {
              await AsyncStorage.removeItem(sessionOwnerKey);
            }
            lastTokenRef.current = null;
            setSessionToken(null);
            if (sessionTokenKey === resolvedParentSessionTokenKey) {
              setParentSessionToken(null);
            }
          })().catch(() => {});
          return;
        }
        if (msg.type === "openUrl" && typeof msg.url === "string") {
          const parsed = new URL(msg.url);
          // deep-link callback can't restore the return route / Clips token key.
          if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
            void openGoogleSession(msg.url);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [
      effectiveCaptureSessionToken,
      canCaptureSessionToken,
      resolvedParentSessionTokenKey,
      sessionOwnerKey,
      sessionTokenKey,
      trustedOrigin,
      openGoogleSession,
      refreshWorkspaceEmbed,
      workspaceAppId,
    ],
  );

  const handleLoadEnd = useCallback(
    (event: { nativeEvent: { url: string } }) => {
      if (workspaceAppId && isEmbedStartUrl(event.nativeEvent.url)) {
        refreshWorkspaceEmbed(true);
        return;
      }
      if (workspaceAppId && parentSessionToken) {
        if (
          workspaceEmbedState === "reused" &&
          isSignInEntryUrl(event.nativeEvent.url)
        ) {
          refreshWorkspaceEmbed(true);
          return;
        }
        workspaceEmbedAutoRetryRef.current = 0;
        // and set its session cookie. Only a freshly minted session may start
        if (workspaceEmbedState === "ready") {
          rememberLiveWorkspaceAppSession(workspaceAppId, parentSessionToken);
        }
      } else if (workspaceAppId) {
        workspaceEmbedAutoRetryRef.current = 0;
      }
      setLoading(false);
      if (isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)) {
        webviewRef.current?.injectJavaScript(
          buildMobileGuestThemeScript(theme),
        );
      }
      if (
        canCaptureSessionToken &&
        isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)
      ) {
        try {
          if (new URL(event.nativeEvent.url).searchParams.has("_session")) {
            sessionUrlLoadedRef.current = true;
          }
        } catch (error) {
          console.warn("[webview] failed to parse trusted load URL:", error);
          return;
        }
        webviewRef.current?.injectJavaScript(SESSION_BRIDGE_SCRIPT);
      }
    },
    [
      canCaptureSessionToken,
      parentSessionToken,
      refreshWorkspaceEmbed,
      theme,
      trustedOrigin,
      workspaceAppId,
      workspaceEmbedState,
    ],
  );

  // stay on their ordinary app-owned URL and never receive a reusable token.
  const requestedWebviewUrl = useMemo(() => {
    return buildMobileWebViewAuthUrl({
      url,
      workspaceAppId: effectiveCaptureSessionToken ? workspaceAppId : undefined,
      workspaceEmbedState,
      workspaceEmbedUrl,
    });
  }, [
    effectiveCaptureSessionToken,
    url,
    workspaceAppId,
    workspaceEmbedState,
    workspaceEmbedUrl,
  ]);

  const workspaceHandshakeInFlight =
    Boolean(workspaceAppId) &&
    effectiveCaptureSessionToken &&
    (workspaceEmbedState === "idle" || workspaceEmbedState === "loading");
  const webviewOwner = parentSessionToken
    ? mobileSessionFingerprint(parentSessionToken)
    : null;
  const webviewUrl = resolveStickyWebViewUrl({
    requestedUrl: requestedWebviewUrl,
    loaded: loadedWebviewRef.current,
    owner: webviewOwner,
    workspaceHandshakeInFlight,
  });

  const handleNativeSignedIn = useCallback(async () => {
    setNativeSignInOpen(false);
    await readStoredSessions();
    await import("@/lib/workspace-apps")
      .then(({ refreshWorkspaceApps }) => refreshWorkspaceApps())
      .catch(() => {});
  }, [readStoredSessions]);

  const workspaceSessionPending =
    effectiveCaptureSessionToken &&
    Boolean(workspaceAppId) &&
    Boolean(parentSessionToken) &&
    (workspaceEmbedState === "idle" || workspaceEmbedState === "loading");

  if (!nativeAuthReady) {
    return <MobileWebViewLoading label="Preparing secure app sign-in…" />;
  }

  if (effectiveCaptureSessionToken && !sessionLoaded) {
    return <MobileWebViewLoading label="Opening app…" />;
  }

  if (effectiveCaptureSessionToken && !parentSessionToken) {
    return (
      <View className="flex-1 items-center justify-center bg-background-pure px-7">
        <Text className="text-center text-white text-[22px] font-bold">
          Sign in to open{appName ? ` ${appName}` : " this app"}
        </Text>
        <Text className="mt-2.5 text-center text-gray-medium text-[13px]">
          Sign in once in the mobile app and your workspace apps will open
          automatically.
        </Text>
        <TouchableOpacity
          className="mt-6 min-h-11 items-center justify-center rounded-xl bg-primary px-5 active:opacity-75"
          onPress={() => setNativeSignInOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text className="text-primary-foreground text-[14px] font-bold">
            Sign in
          </Text>
        </TouchableOpacity>
        <NativeSignInSheet
          visible={nativeSignInOpen}
          onClose={() => setNativeSignInOpen(false)}
          onSignedIn={handleNativeSignedIn}
        />
      </View>
    );
  }

  if (
    workspaceSessionPending &&
    loadedWebviewRef.current?.owner !== webviewOwner
  ) {
    return <MobileWebViewLoading label="Opening your workspace app…" />;
  }

  if (workspaceEmbedState === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-background-pure px-7">
        <Feather name="alert-circle" size={42} color={destructive} />
        <Text className="mt-4 text-center text-white text-[18px] font-semibold">
          Could not open{appName ? ` ${appName}` : " the workspace app"}
        </Text>
        <Text className="mt-2 text-center text-gray-medium text-[13px]">
          {workspaceEmbedError ?? "The workspace session could not be created."}
        </Text>
        <TouchableOpacity
          className="mt-5 flex-row items-center gap-2 rounded-lg bg-primary px-5 py-2.5 active:opacity-75"
          onPress={reload}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Feather name="refresh-cw" size={16} color={primaryForeground} />
          <Text className="text-primary-foreground text-sm font-semibold">
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center bg-background-pure p-6">
        <Feather name="alert-circle" size={48} color={destructive} />
        <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
          Failed to load{appName ? ` ${appName}` : ""}
        </Text>
        <Text className="text-gray-medium text-xs mb-5">{url}</Text>
        <TouchableOpacity
          className="flex-row items-center bg-primary px-5 py-2.5 rounded-lg gap-2 active:opacity-75"
          onPress={reload}
        >
          <Feather name="refresh-cw" size={16} color={primaryForeground} />
          <Text className="text-primary-foreground text-sm font-semibold">
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  loadedWebviewRef.current = { owner: webviewOwner, url: webviewUrl };

  return (
    <View className="flex-1 bg-background-pure">
      <WebView
        ref={webviewRef}
        source={{ uri: webviewUrl }}
        className="flex-1 bg-background-pure"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={handleLoadEnd}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        onHttpError={(event: { nativeEvent: { statusCode: number } }) => {
          if (event.nativeEvent.statusCode >= 500) setError(true);
        }}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onOpenWindow={handleOpenWindow}
        onMessage={handleMessage}
        injectedJavaScriptBeforeContentLoaded={`${MOBILE_ANALYTICS_PLATFORM_SCRIPT}
${buildMobileGuestThemeScript(theme)}${
          shouldHideEmbeddedAuth ? `\n${FORCE_REDIRECT_AUTH_SCRIPT}` : ""
        }`}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        startInLoadingState={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
      />
      {loading && (
        <View className="absolute inset-0 justify-center items-center bg-background-pure">
          <ActivityIndicator size="large" color={foreground} />
        </View>
      )}
    </View>
  );
}

function MobileWebViewLoading({ label }: { label: string }) {
  const { background, mutedForeground } = useMobileThemeColors();

  return (
    <View
      className="flex-1 items-center justify-center bg-background-pure"
      style={{ backgroundColor: background }}
    >
      <ActivityIndicator color={mutedForeground} />
      <Text className="mt-2.5 text-[13px] text-gray-medium">{label}</Text>
    </View>
  );
}

export default forwardRef(AppWebView);
