import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { View, ActivityIndicator, Linking, AppState } from "react-native";
import type { WebView as WebViewRef } from "react-native-webview";

import { WebView } from "@/components/uniwind-interop";
import { clipsSessionOwnerKey } from "@/lib/clips-session";
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
}

const OAUTH_STATE_KEY = "agent-native:oauth-state";

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];
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

export default function AppWebView({
  url,
  captureSessionToken = false,
  sessionTokenKey = SESSION_TOKEN_KEY,
  sessionOwnerKey,
}: AppWebViewProps) {
  const webviewRef = useRef<WebViewRef>(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);
  const trustedOrigin = useMemo(() => parseTrustedOrigin(url), [url]);

  // Load stored session token on mount.
  useEffect(() => {
    void getSessionToken(sessionTokenKey).then((token) => {
      lastTokenRef.current = token;
      setSessionToken(token);
    });
  }, [sessionTokenKey]);

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

  const handleShouldStartLoad = useCallback(
    (event: { url: string }) => {
      if (isTrustedWebViewUrl(event.url, trustedOrigin)) return true;
      try {
        const parsed = new URL(event.url);
        if (parsed.protocol === "about:") return true;
        parsed.searchParams.delete("_session");
        if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
          rememberOAuthState(parsed.toString());
        }
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          void Linking.openURL(parsed.toString());
        }
      } catch {
        // Invalid and non-web URLs do not belong in the authenticated WebView.
      }
      return false;
    },
    [trustedOrigin],
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
  // an httpOnly cookie. This bridges the Safari/WKWebView cookie jar gap.
  const webviewUrl = useMemo(() => {
    if (!sessionToken) return url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("_session", sessionToken);
      return parsed.toString();
    } catch {
      return url;
    }
  }, [sessionToken, url]);

  return (
    <View className="flex-1 bg-background-pure">
      <WebView
        ref={webviewRef}
        source={{ uri: webviewUrl }}
        className="flex-1 bg-background-pure"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={handleLoadEnd}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        startInLoadingState={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
      />
      {loading && (
        <View className="absolute inset-0 justify-center items-center bg-background-pure">
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </View>
  );
}
