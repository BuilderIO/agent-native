import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Linking,
  AppState,
} from "react-native";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AppWebViewProps {
  url: string;
}

const SESSION_TOKEN_KEY = "agent-native:session-token";

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

export default function AppWebView({ url }: AppWebViewProps) {
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
        if (msg.type === "openUrl" && typeof msg.url === "string") {
          const parsed = new URL(msg.url);
          // Only open external hosts in Safari — anything else is ignored
          if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
            Linking.openURL(msg.url);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [],
  );

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
        onLoadEnd={() => setLoading(false)}
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111111",
  },
});
