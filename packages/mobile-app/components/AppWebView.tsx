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
  color?: string;
}

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

  // When the app returns to foreground after external OAuth, reload the WebView
  // to pick up the new session cookie.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && openedExternal.current) {
        openedExternal.current = false;
        webviewRef.current?.reload();
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

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: url }}
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
