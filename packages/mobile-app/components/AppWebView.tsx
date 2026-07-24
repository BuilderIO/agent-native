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

import { WebView } from "@/components/uniwind-interop";
import { clipsSessionOwnerKey } from "@/lib/clips-session";
import {
  OAUTH_BASE_URL_KEY,
  OAUTH_OWNER_KEY_KEY,
  OAUTH_RETURN_PATH_KEY,
  OAUTH_STATE_KEY,
  OAUTH_TOKEN_STORE_KEY,
} from "@/lib/oauth-storage";
import {
  clearSessionToken,
  getSessionToken,
  saveSessionToken,
  SESSION_TOKEN_KEY,
} from "@/lib/session-token-store";
import {
  isTrustedWebViewUrl,
  parseTrustedOrigin,
} from "@/lib/webview-security";

interface AppWebViewProps {
  url: string;
  captureSessionToken?: boolean;
  sessionTokenKey?: string;
  sessionOwnerKey?: string;
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
// handleShouldStartLoad intercepts and hands to the system browser. Scoped to
// the sign-in page so the authenticated app's own window.open is untouched.
const FORCE_REDIRECT_AUTH_SCRIPT = `
  (function () {
    try {
      if (location.pathname.indexOf('/_agent-native/sign-in') !== -1) {
        window.open = function () { return null; };
      }
    } catch (e) {}
    return true;
  })();
  true;
`;
const SESSION_BRIDGE_SCRIPT = `
  (function () {
    if (window.__agentNativeSessionBridgeRunning) return true;
    window.__agentNativeSessionBridgeRunning = true;
    var postToken = function () {
      fetch('/_agent-native/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
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
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'agent-native-session',
              token: data.token,
              email: data.email,
              orgId: typeof data.orgId === 'string' ? data.orgId : null
            }));
          } else {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'agent-native-session-cleared'
            }));
          }
        })
        .catch(function () {});
    };
    postToken();
    setTimeout(postToken, 1000);
    setInterval(postToken, 5000);
    window.addEventListener('focus', postToken);
    return true;
  })();
  true;
`;

function rememberOAuthState(url: string) {
  try {
    const state = new URL(url).searchParams.get("state");
    if (state) void AsyncStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    // Invalid URL — ignore
  }
}

function isGoogleAuthUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(GOOGLE_AUTH_URL_PATH);
  } catch {
    return false;
  }
}

// The redirect is agentnative://oauth-complete?token=…&state=…. Custom-scheme
// URLs don't parse reliably via `new URL` in React Native, so read the token
// straight off the query string.
function tokenFromRedirect(url: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return null;
  const token = new URLSearchParams(url.slice(queryStart + 1)).get("token");
  return token && token.length > 0 ? token : null;
}

// Resolve the auth-url endpoint's JSON form (without `redirect=1`) so we get
// the accounts.google.com URL — including the server-minted `state`. The start
// URL itself has no `state` yet (the server mints it), so it can't be opened
// directly without breaking the callback's state check.
async function resolveGoogleAuthUrl(startUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(startUrl);
    parsed.searchParams.delete("redirect");
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

function AppWebView(
  {
    url,
    captureSessionToken = false,
    sessionTokenKey = SESSION_TOKEN_KEY,
    sessionOwnerKey,
    appName,
  }: AppWebViewProps,
  ref: React.Ref<AppWebViewHandle>,
) {
  const webviewRef = useRef<WebViewRef>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);
  const trustedOrigin = useMemo(() => parseTrustedOrigin(url), [url]);

  // Remember the current route so the oauth-complete fallback can return here
  // instead of Home if the deep link leaks to the OS (Android resets the stack,
  // so router.canGoBack() is false and it would otherwise land on Home).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const reload = useCallback(() => {
    setError(false);
    setLoading(true);
    webviewRef.current?.reload();
  }, []);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  // Load stored session token on mount.
  useEffect(() => {
    void getSessionToken(sessionTokenKey).then((token) => {
      lastTokenRef.current = token;
      setSessionToken(token);
    });
  }, [sessionTokenKey]);

  // Re-read the token every time this screen regains focus. Returning from the
  // Google sign-in browser (via oauth-complete's replace/back, or the inline
  // auth session) refocuses this screen; without this, an already-mounted
  // WebView keeps its stale null token and stays signed out.
  useFocusEffect(
    useCallback(() => {
      void getSessionToken(sessionTokenKey).then((token) => {
        if (token !== lastTokenRef.current) {
          lastTokenRef.current = token;
          setSessionToken(token);
        }
      });
    }, [sessionTokenKey]),
  );

  // When the app returns to foreground, check if the session token was updated
  // (e.g. by the oauth-complete deep link handler storing a new token in
  // SecureStore). If it changed, update state — the resulting URL change
  // causes the WebView to navigate to the new URL with ?_session automatically.
  // No explicit reload() needed; changing source.uri triggers navigation.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setTimeout(() => {
          void getSessionToken(sessionTokenKey).then((token) => {
            if (token !== lastTokenRef.current) {
              lastTokenRef.current = token;
              setSessionToken(token);
            }
          });
        }, 1000);
      }
    });
    return () => sub.remove();
  }, [sessionTokenKey]);

  const applySessionToken = useCallback(
    (token: string) => {
      void saveSessionToken(token, sessionTokenKey).then(() => {
        if (token !== lastTokenRef.current) {
          lastTokenRef.current = token;
          setSessionToken(token);
        }
      });
    },
    [sessionTokenKey],
  );

  // Google refuses OAuth inside embedded WebViews, so run the flow in a system
  // browser tab. The return-path and token key are persisted first so the
  // OAuthDeepLinkHandler can finish the sign-in even if Android kills this app
  // while it's in the browser.
  const openGoogleSession = useCallback(
    async (googleUrl: string) => {
      rememberOAuthState(googleUrl);
      await AsyncStorage.multiSet([
        [OAUTH_RETURN_PATH_KEY, pathnameRef.current],
        [OAUTH_TOKEN_STORE_KEY, sessionTokenKey],
        // Only Clips passes a sessionOwnerKey; the handler uses it plus the app
        // origin to set the owner key the Clips session also requires.
        [OAUTH_OWNER_KEY_KEY, sessionOwnerKey ?? ""],
        [OAUTH_BASE_URL_KEY, trustedOrigin ?? ""],
      ]);
      try {
        if (Platform.OS === "android") {
          // openAuthSessionAsync is unreliable on Android — it can hand off to
          // an external browser/app and never redirect back (expo #27500).
          // Open a Custom Tab in the preferred browser instead and let the
          // agentnative://oauth-complete deep link (OAuthDeepLinkHandler) bring
          // the result back into the app.
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
        const token = tokenFromRedirect(result.url);
        console.log("[oauth] inline token extracted:", token ? "yes" : "no");
        if (token) applySessionToken(token);
      } catch (e) {
        console.log("[oauth] auth session error:", String(e));
      }
    },
    [applySessionToken, sessionTokenKey, sessionOwnerKey, trustedOrigin],
  );

  // Some core versions navigate the WebView straight to the auth-url endpoint,
  // which has no `state` yet; resolve its JSON form to the accounts.google.com
  // URL (with state) before opening the browser session.
  const startGoogleAuth = useCallback(
    async (startUrl: string) => {
      const authUrl = await resolveGoogleAuthUrl(startUrl);
      if (authUrl) await openGoogleSession(authUrl);
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
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          void Linking.openURL(parsed.toString());
        }
      } catch {
        // Invalid and non-web URLs do not belong in the authenticated WebView.
      }
      return false;
    },
    [trustedOrigin, startGoogleAuth, openGoogleSession],
  );

  // Handle messages from the web app (e.g. open a URL in the system browser)
  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string; url: string } }) => {
      if (!isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)) return;
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (
          captureSessionToken &&
          msg.type === "agent-native-session" &&
          typeof msg.token === "string" &&
          msg.token.length > 0 &&
          (!sessionOwnerKey ||
            (typeof msg.email === "string" && msg.email.trim().length > 0))
        ) {
          void (async () => {
            await saveSessionToken(msg.token, sessionTokenKey);
            if (sessionOwnerKey) {
              await AsyncStorage.setItem(
                sessionOwnerKey,
                clipsSessionOwnerKey(
                  msg.email,
                  typeof msg.orgId === "string" ? msg.orgId : undefined,
                ),
              );
            }
            if (msg.token !== lastTokenRef.current) {
              lastTokenRef.current = msg.token;
              setSessionToken(msg.token);
            }
          })().catch(() => {});
          return;
        }
        if (
          captureSessionToken &&
          msg.type === "agent-native-session-cleared"
        ) {
          void (async () => {
            await clearSessionToken(sessionTokenKey);
            if (sessionOwnerKey) {
              await AsyncStorage.removeItem(sessionOwnerKey);
            }
            lastTokenRef.current = null;
            setSessionToken(null);
          })().catch(() => {});
          return;
        }
        if (msg.type === "openUrl" && typeof msg.url === "string") {
          const parsed = new URL(msg.url);
          // Only open external hosts in Safari — anything else is ignored
          if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
            rememberOAuthState(msg.url);
            void Linking.openURL(msg.url);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [captureSessionToken, sessionOwnerKey, sessionTokenKey, trustedOrigin],
  );

  const handleLoadEnd = useCallback(
    (event: { nativeEvent: { url: string } }) => {
      setLoading(false);
      if (
        captureSessionToken &&
        isTrustedWebViewUrl(event.nativeEvent.url, trustedOrigin)
      ) {
        webviewRef.current?.injectJavaScript(SESSION_BRIDGE_SCRIPT);
      }
    },
    [captureSessionToken, trustedOrigin],
  );

  // Append the session token as a query param so the server can promote it to
  // an httpOnly cookie (bridges the Safari/WKWebView cookie jar gap), and force
  // the sign-in page into redirect mode. Its default popup flow opens Google in
  // a window this WebView can't intercept; redirect mode navigates the main
  // frame to the auth-url endpoint, which handleShouldStartLoad hands to Safari.
  const webviewUrl = useMemo(() => {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("authMode", "redirect");
      if (sessionToken) parsed.searchParams.set("_session", sessionToken);
      return parsed.toString();
    } catch {
      return url;
    }
  }, [sessionToken, url]);

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
        onMessage={handleMessage}
        injectedJavaScriptBeforeContentLoaded={FORCE_REDIRECT_AUTH_SCRIPT}
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

export default forwardRef(AppWebView);
