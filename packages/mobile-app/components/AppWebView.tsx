import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Linking,
  AppState,
} from "react-native";
import { WebView } from "react-native-webview";

interface AppWebViewProps {
  url: string;
  captureSessionToken?: boolean;
}

const SESSION_TOKEN_KEY = "agent-native:session-token";
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
          if (data && typeof data.token === 'string' && data.token.length > 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'agent-native-session',
              token: data.token
            }));
          }
        })
        .catch(function () {});
    };
    postToken();
    setTimeout(postToken, 1000);
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
}: AppWebViewProps) {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  // Load stored session token on mount
  useEffect(() => {
    AsyncStorage.getItem(SESSION_TOKEN_KEY).then((t) => {
      lastTokenRef.current = t;
      setSessionToken(t);
    });
  }, []);

  // When the app returns to foreground, check if the session token was updated
  // (e.g. by the oauth-complete deep link handler storing a new token in
  // AsyncStorage). If it changed, update state — the resulting URL change
  // causes the WebView to navigate to the new URL with ?_session automatically.
  // No explicit reload() needed; changing source.uri triggers navigation.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setTimeout(() => {
          AsyncStorage.getItem(SESSION_TOKEN_KEY).then((t) => {
            if (t && t !== lastTokenRef.current) {
              lastTokenRef.current = t;
              setSessionToken(t);
            }
          });
        }, 1000);
      }
    });
    return () => sub.remove();
  }, []);

  const handleShouldStartLoad = useCallback((event: { url: string }) => {
    try {
      const parsed = new URL(event.url);
      if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
        rememberOAuthState(event.url);
        Linking.openURL(event.url);
        return false;
      }
    } catch {
      // Invalid URL — let WebView handle it
    }
    return true;
  }, []);

  // Handle messages from the web app (e.g. open a URL in the system browser)
  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (
          captureSessionToken &&
          msg.type === "agent-native-session" &&
          typeof msg.token === "string" &&
          msg.token.length > 0
        ) {
          void AsyncStorage.setItem(SESSION_TOKEN_KEY, msg.token);
          if (msg.token !== lastTokenRef.current) {
            lastTokenRef.current = msg.token;
            setSessionToken(msg.token);
          }
          return;
        }
        if (msg.type === "openUrl" && typeof msg.url === "string") {
          const parsed = new URL(msg.url);
          // Only open external hosts in Safari — anything else is ignored
          if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
            rememberOAuthState(msg.url);
            Linking.openURL(msg.url);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [captureSessionToken],
  );

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (captureSessionToken) {
      webviewRef.current?.injectJavaScript(SESSION_BRIDGE_SCRIPT);
    }
  }, [captureSessionToken]);

  // Append the session token as a query param so the server can promote it to
  // an httpOnly cookie. This bridges the Safari/WKWebView cookie jar gap.
  const webviewUrl = sessionToken
    ? `${url}${url.includes("?") ? "&" : "?"}_session=${sessionToken}`
    : url;

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: webviewUrl }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={handleLoadEnd}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        injectedJavaScript={
          captureSessionToken ? SESSION_BRIDGE_SCRIPT : undefined
        }
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        startInLoadingState={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  webview: {
    flex: 1,
    backgroundColor: "#111111",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111111",
  },
});
