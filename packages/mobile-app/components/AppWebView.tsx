import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, usePathname } from "expo-router";
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
import { useNativeAppAuthEnabled } from "@/lib/native-app-auth";
import { validateNativeSession } from "@/lib/native-auth";
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
import { buildMobileWebViewAuthUrl } from "@/lib/webview-auth-url";
import {
  isTrustedWebViewUrl,
  parseTrustedOrigin,
  shouldOpenExternalWebViewUrl,
} from "@/lib/webview-security";
import {
  createWorkspaceAppEmbedSession,
  isWorkspaceSsoEnabled,
} from "@/lib/workspace-app-auth";

interface AppWebViewProps {
  url: string;
  captureSessionToken?: boolean;
  sessionTokenKey?: string;
  /** Parent credential used to mint a target app-scoped embed session. */
  parentSessionTokenKey?: string;
  sessionOwnerKey?: string;
  /** Workspace app id for the parent-authenticated embed-session path. */
  workspaceAppId?: string;
  /** Shown in the load-failure message, e.g. "Failed to load Calendar". */
  appName?: string;
}

export interface AppWebViewHandle {
  reload: () => void;
}

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

// The web sign-in page navigates the WebView to this same-origin endpoint,
// which then 302s to accounts.google.com. Android does not re-fire
// onShouldStartLoadWithRequest on that server redirect, so Google's block
// page loads inside the WebView. Intercept the start URL here instead.
const GOOGLE_AUTH_URL_PATH = "/_agent-native/google/auth-url";

// The remote sign-in page opens Google in a window.open popup. Inside this
// WebView that popup either loads Google inline (which Google blocks) or spins
// forever polling a callback that never lands. Neutering window.open on the
// sign-in page forces the page's built-in redirect fallback, which navigates
// the main frame to /_agent-native/google/auth-url — a top-level navigation
// handleShouldStartLoad intercepts and hands to the system browser. The SSO
// button is hidden for the whole embedded document because the parent mobile
// shell owns Agent Native sign-in; the CSS also covers client-side route changes.
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

// Resolve the auth-url endpoint's JSON form (without `redirect=1`) so we get
// the accounts.google.com URL — including the server-minted `state`. The start
// URL itself has no `state` yet (the server mints it), so it can't be opened
// directly without breaking the callback's state check.
async function resolveGoogleAuthUrl(startUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(startUrl);
    parsed.searchParams.delete("redirect");
    // The callback can be handled by a browser with a desktop-style user
    // agent. Carry native intent in the signed server state so the callback
    // always returns to this app instead of redirecting the WebView to sign-in.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
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
    "idle" | "loading" | "disabled" | "ready" | "error"
  >("idle");
  const [workspaceEmbedAttempt, setWorkspaceEmbedAttempt] = useState(0);
  const [nativeSignInOpen, setNativeSignInOpen] = useState(false);
  const lastTokenRef = useRef<string | null>(null);
  const oauthInFlightRef = useRef(false);
  const sessionUrlLoadedRef = useRef(false);
  const isFocusedRef = useRef(false);
  const trustedOrigin = useMemo(() => parseTrustedOrigin(url), [url]);
  const nativeAuthEnabled = useNativeAppAuthEnabled();
  const effectiveCaptureSessionToken = captureSessionToken && nativeAuthEnabled;
  const shouldHideEmbeddedAuth =
    nativeAuthEnabled && (!workspaceAppId || workspaceEmbedState === "ready");
  const resolvedParentSessionTokenKey =
    parentSessionTokenKey ?? sessionTokenKey;
  const canCaptureSessionToken =
    effectiveCaptureSessionToken &&
    (!workspaceAppId || sessionTokenKey !== resolvedParentSessionTokenKey);

  // Remember the current route so the oauth-complete fallback can return here
  // instead of Home if the deep link leaks to the OS (Android resets the stack,
  // so router.canGoBack() is false and it would otherwise land on Home).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const reload = useCallback(() => {
    setError(false);
    setLoading(true);
    if (workspaceAppId) {
      setWorkspaceEmbedAttempt((attempt) => attempt + 1);
      return;
    }
    webviewRef.current?.reload();
  }, [workspaceAppId]);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  const readStoredSessions = useCallback(async () => {
    const [targetToken, parentToken] = await Promise.all([
      getSessionToken(sessionTokenKey),
      getSessionToken(resolvedParentSessionTokenKey),
    ]);
    let nextTargetToken = targetToken;
    let nextParentToken = parentToken;
    if (nativeAuthEnabled && parentToken) {
      const validParent = await validateNativeSession(parentToken);
      if (!validParent) {
        const currentParentToken = await getSessionToken(
          resolvedParentSessionTokenKey,
        );
        if (currentParentToken === parentToken) {
          await clearSessionToken(resolvedParentSessionTokenKey);
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

  // Load stored session tokens on mount. The parent token and target app token
  // are intentionally separate for Clips and other app-scoped sessions.
  useEffect(() => {
    void readStoredSessions();
  }, [readStoredSessions]);

  // A mobile parent session is not a valid cookie/session in every hosted app.
  // When the targeted rollout is on, exchange it through Dispatch for a
  // one-time app-scoped embed URL instead of leaking the parent bearer via
  // `?_session` to a different deployment.
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
      const enabled = await isWorkspaceSsoEnabled();
      if (cancelled) return;
      if (!enabled) {
        setWorkspaceEmbedState("disabled");
        return;
      }
      const result = await createWorkspaceAppEmbedSession({
        app: workspaceAppId!,
        path: embedTargetPath(url),
      });
      if (cancelled) return;
      setWorkspaceEmbedUrl(result.startUrl);
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

  // Re-read the token every time this screen regains focus. Returning from the
  // Google sign-in browser (via oauth-complete's replace/back, or the inline
  // auth session) refocuses this screen; without this, an already-mounted
  // WebView keeps its stale null token and stays signed out.
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

  // When the app returns to foreground, check if the session token was updated
  // (e.g. by the oauth-complete deep link handler storing a new token in
  // SecureStore). If it changed, update state — the resulting URL change
  // causes the WebView to navigate to the new URL with ?_session automatically.
  // No explicit reload() needed; changing source.uri triggers navigation.
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

  // The OAuth completion context for this WebView — passed to the shared
  // completeOAuthCallback so the iOS inline path and the Android deep-link
  // handler validate and persist the session identically.
  const oauthContext = useMemo(
    () => ({
      tokenKey: sessionTokenKey,
      ownerKeyName: sessionOwnerKey ?? null,
      baseUrl: trustedOrigin,
    }),
    [sessionTokenKey, sessionOwnerKey, trustedOrigin],
  );

  // Persist everything the deep-link handler needs to finish an OAuth callback
  // (route to return to, token/owner storage keys, app origin) so completion
  // works even if Android kills this app while it's in the browser. Shared by
  // every path that hands OAuth off to the system browser via a deep link.
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

  // Google refuses OAuth inside embedded WebViews, so run the flow in a system
  // browser tab.
  const openGoogleSession = useCallback(
    async (googleUrl: string) => {
      if (oauthInFlightRef.current) return;
      oauthInFlightRef.current = true;
      try {
        await rememberOAuthState(googleUrl);
        await persistOAuthReturnContext();
        if (Platform.OS === "android") {
          // openAuthSessionAsync is unreliable on Android — it can hand off to
          // an external browser/app and never redirect back (expo #27500).
          // Open a Custom Tab in the preferred browser and let the
          // agentnative://oauth-complete deep link (OAuthDeepLinkHandler) bring
          // the result back.
          const { preferredBrowserPackage } =
            await WebBrowser.getCustomTabsSupportingBrowsersAsync();
          await WebBrowser.openBrowserAsync(googleUrl, {
            browserPackage: preferredBrowserPackage,
            showInRecents: true,
          });
          return;
        }
        // iOS: the auth session returns the callback inline. Run it through the
        // same validated completion, then apply the token to this WebView.
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
        // The root deep-link handler can win the callback race on a cold or
        // resumed app. In that case it already persisted the validated token;
        // pick it up here so the WebView still transitions out of sign-in.
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

  // Some core versions navigate the WebView straight to the auth-url endpoint,
  // which has no `state` yet; resolve its JSON form to the accounts.google.com
  // URL (with state) before opening the browser session.
  const startGoogleAuth = useCallback(
    async (startUrl: string) => {
      const authUrl = await resolveGoogleAuthUrl(startUrl);
      if (authUrl) {
        await openGoogleSession(authUrl);
      } else {
        // We already blocked the in-WebView auth navigation, so a failed
        // resolve would otherwise leave the page stuck with no browser and no
        // feedback. Surface the recoverable error/retry screen instead.
        setError(true);
      }
    },
    [openGoogleSession],
  );

  const handleShouldStartLoad = useCallback(
    (event: { url: string }) => {
      // Same-origin Google sign-in start URL: open the flow in the system
      // browser so Google doesn't reject the embedded WebView.
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
        // Direct navigation to Google's consent screen: it already carries the
        // `state`, so open it in the browser session and apply the token here.
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

  // Handle messages from the web app (e.g. open a URL in the system browser)
  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string; url: string } }) => {
      if (!isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)) return;
      try {
        const msg = JSON.parse(event.nativeEvent.data);
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
            // The sign-in page has a separate cookie jar from the native
            // browser auth session. Ignore its stale heartbeat while OAuth is
            // open or while the newly returned token is loading into the URL.
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
          // Only open external hosts in Safari — anything else is ignored.
          // These are Google OAuth hosts, so persist the completion context
          // (like the intercepted-navigation path) before handing off, or the
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
    ],
  );

  const handleLoadEnd = useCallback(
    (event: { nativeEvent: { url: string } }) => {
      setLoading(false);
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
    [canCaptureSessionToken, trustedOrigin],
  );

  // Append the session token as a query param so the server can promote it to
  // an httpOnly cookie (bridges the Safari/WKWebView cookie jar gap).
  const webviewUrl = useMemo(() => {
    if (!effectiveCaptureSessionToken) return url;
    return buildMobileWebViewAuthUrl({
      url,
      sessionToken,
      sessionTokenKey,
      parentSessionTokenKey: resolvedParentSessionTokenKey,
      workspaceAppId,
      workspaceEmbedState,
      workspaceEmbedUrl,
    });
  }, [
    effectiveCaptureSessionToken,
    resolvedParentSessionTokenKey,
    sessionTokenKey,
    sessionToken,
    url,
    workspaceAppId,
    workspaceEmbedState,
    workspaceEmbedUrl,
  ]);

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
          className="mt-6 min-h-11 items-center justify-center rounded-xl bg-white px-5 active:opacity-75"
          onPress={() => setNativeSignInOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text className="text-background-dark text-[14px] font-bold">
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

  if (workspaceSessionPending) {
    return <MobileWebViewLoading label="Opening your workspace app…" />;
  }

  if (workspaceEmbedState === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-background-pure px-7">
        <Feather name="alert-circle" size={42} color="#EF4444" />
        <Text className="mt-4 text-center text-white text-[18px] font-semibold">
          Could not open{appName ? ` ${appName}` : " the workspace app"}
        </Text>
        <Text className="mt-2 text-center text-gray-medium text-[13px]">
          {workspaceEmbedError ?? "The workspace session could not be created."}
        </Text>
        <TouchableOpacity
          className="mt-5 flex-row items-center gap-2 rounded-lg bg-white px-5 py-2.5 active:opacity-75"
          onPress={reload}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Feather name="refresh-cw" size={16} color="#111111" />
          <Text className="text-background-dark text-sm font-semibold">
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center bg-background-pure p-6">
        <Feather name="alert-circle" size={48} color="#EF4444" />
        <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
          Failed to load{appName ? ` ${appName}` : ""}
        </Text>
        <Text className="text-gray-medium text-xs mb-5">{url}</Text>
        <TouchableOpacity
          className="flex-row items-center bg-white px-5 py-2.5 rounded-lg gap-2 active:opacity-75"
          onPress={reload}
        >
          <Feather name="refresh-cw" size={16} color="#111111" />
          <Text className="text-background-dark text-sm font-semibold">
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

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
        injectedJavaScriptBeforeContentLoaded={`${MOBILE_ANALYTICS_PLATFORM_SCRIPT}${
          shouldHideEmbeddedAuth ? `\n${FORCE_REDIRECT_AUTH_SCRIPT}` : ""
        }`}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        startInLoadingState={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        // Google refuses OAuth in embedded WebViews. The remote sign-in page
        // defaults to a window.open popup that Android's multi-window support
        // would load inline (and Google blocks). Disabling it makes window.open
        // return null, so the page falls back to a top-level redirect to
        // /_agent-native/google/auth-url — which handleShouldStartLoad hands to
        // the system browser. Works across every app domain and core version.
        setSupportMultipleWindows={false}
      />
      {loading && (
        <View className="absolute inset-0 justify-center items-center bg-background-pure">
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </View>
  );
}

function MobileWebViewLoading({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background-pure">
      <ActivityIndicator color="#d4d4d8" />
      <Text className="mt-2.5 text-[13px] text-gray-medium">{label}</Text>
    </View>
  );
}

export default forwardRef(AppWebView);
