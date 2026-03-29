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
  color?: string;
}

const SESSION_TOKEN_KEY = "agent-native:session-token";

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

export default function AppWebView({
  url,
  color = "#ffffff",
}: AppWebViewProps) {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const openedExternal = useRef(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Load stored session token on mount
  useEffect(() => {
    AsyncStorage.getItem(SESSION_TOKEN_KEY).then((t) => setSessionToken(t));
  }, []);

  // When the app returns to foreground after external OAuth, re-read the token
  // (it may have been set by oauth-complete) and reload the WebView.
  // Use a short delay to let oauth-complete store the token in AsyncStorage
  // before we read it — the deep link handler and AppState listener race.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && openedExternal.current) {
        openedExternal.current = false;
        setTimeout(() => {
          AsyncStorage.getItem(SESSION_TOKEN_KEY).then((t) => {
            setSessionToken(t);
            webviewRef.current?.reload();
          });
        }, 500);
      }
    });
    return () => sub.remove();
  }, []);

  const handleShouldStartLoad = useCallback((event: { url: string }) => {
    try {
      const parsed = new URL(event.url);
      if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
        openedExternal.current = true;
        Linking.openURL(event.url);
        return false;
      }
    } catch {
      // Invalid URL — let WebView handle it
    }
    return true;
  }, []);

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
          <ActivityIndicator size="large" color={color} />
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
