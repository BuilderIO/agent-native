import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, Stack } from "expo-router";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  AppState,
} from "react-native";
import { WebView } from "react-native-webview";

import { getSessionToken } from "@/lib/session-token-store";
import { useApps } from "@/lib/use-apps";
import {
  isTrustedWebViewUrl,
  parseTrustedOrigin,
} from "@/lib/webview-security";

const OAUTH_STATE_KEY = "agent-native:oauth-state";

// Google blocks OAuth in embedded WebViews. Open Google auth URLs in the
// system browser (Safari) instead.
const EXTERNAL_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"];

function rememberOAuthState(url: string) {
  try {
    const state = new URL(url).searchParams.get("state");
    if (state) void AsyncStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    // Invalid URL — ignore
  }
}

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apps } = useApps();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const openedExternal = useRef(false);

  const app = apps.find((a) => a.id === id);
  const trustedOrigin = useMemo(
    () => parseTrustedOrigin(app?.url ?? ""),
    [app?.url],
  );
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Load stored session token on mount.
  useEffect(() => {
    void getSessionToken().then((token) => setSessionToken(token));
  }, []);

  // When the app returns to foreground after external OAuth, re-read the token
  // (it may have been set by oauth-complete) and reload the WebView.
  // Use a short delay to let oauth-complete store the token in SecureStore
  // before we read it — the deep link handler and AppState listener race.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && openedExternal.current) {
        openedExternal.current = false;
        setTimeout(() => {
          void getSessionToken().then((token) => {
            setSessionToken(token);
            webviewRef.current?.reload();
          });
        }, 500);
      }
    });
    return () => sub.remove();
  }, []);

  const handleReload = useCallback(() => {
    setError(false);
    setLoading(true);
    webviewRef.current?.reload();
  }, []);

  const handleShouldStartLoad = useCallback(
    (event: { url: string }) => {
      if (isTrustedWebViewUrl(event.url, trustedOrigin)) return true;
      try {
        const parsed = new URL(event.url);
        if (parsed.protocol === "about:") return true;
        parsed.searchParams.delete("_session");
        if (EXTERNAL_HOSTS.includes(parsed.hostname)) {
          openedExternal.current = true;
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

  if (!app) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>App not found</Text>
      </View>
    );
  }

  const baseUrl = app.url;

  // Append the session token as a query param so the server can promote it to
  // an httpOnly cookie. This bridges the Safari/WKWebView cookie jar gap.
  const url = (() => {
    if (!sessionToken) return baseUrl;
    try {
      const parsed = new URL(baseUrl);
      parsed.searchParams.set("_session", sessionToken);
      return parsed.toString();
    } catch {
      return baseUrl;
    }
  })();

  return (
    <>
      <Stack.Screen
        options={{
          title: app.name,
          headerStyle: { backgroundColor: "#111111" },
          headerTintColor: "#ffffff",
          headerRight: () => (
            <TouchableOpacity
              onPress={handleReload}
              style={styles.headerButton}
            >
              <Feather name="refresh-cw" size={20} color="#ffffff" />
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.container}>
        {error ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={48} color="#EF4444" />
            <Text style={styles.errorText}>Failed to load {app.name}</Text>
            <Text style={styles.errorUrl}>{baseUrl}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
              <Feather name="refresh-cw" size={16} color="#ffffff" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={webviewRef}
            source={{ uri: url }}
            style={styles.webview}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            onHttpError={(syntheticEvent) => {
              const { statusCode } = syntheticEvent.nativeEvent;
              if (statusCode >= 500) {
                setError(true);
              }
            }}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            startInLoadingState={false}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
          />
        )}

        {loading && !error && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111111",
    padding: 24,
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
  headerButton: {
    padding: 8,
  },
  errorText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 6,
  },
  errorUrl: {
    color: "#666666",
    fontSize: 13,
    marginBottom: 20,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  retryText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "600",
  },
});
