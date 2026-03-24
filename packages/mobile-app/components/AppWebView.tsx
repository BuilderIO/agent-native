import { useState, useRef, useCallback } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";

interface AppWebViewProps {
  url: string;
  color?: string;
}

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead, which completes the OAuth flow and
// redirects back to the app's callback URL.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

export default function AppWebView({
  url,
  color = "#3B82F6",
}: AppWebViewProps) {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  const handleNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      // When the WebView returns from OAuth (callback URL), reload to pick up the session
      if (navState.url?.includes("/api/google/callback")) {
        // The callback will set cookies — after redirect, reload the app
        setTimeout(() => webviewRef.current?.reload(), 1000);
      }
    },
    [],
  );

  const handleShouldStartLoad = useCallback((event: { url: string }) => {
    try {
      const parsed = new URL(event.url);
      if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
        // Open in system browser instead of WebView
        WebBrowser.openBrowserAsync(event.url).then(() => {
          // When browser closes, reload the WebView to check for new session
          webviewRef.current?.reload();
        });
        return false; // Block the WebView from navigating
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
        onNavigationStateChange={handleNavigationStateChange}
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
