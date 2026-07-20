import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, Stack } from "expo-router";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  AppState,
} from "react-native";
import type { WebView as WebViewRef } from "react-native-webview";

import { WebView } from "@/components/uniwind-interop";
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
  const webviewRef = useRef<WebViewRef>(null);
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
      <View className="flex-1 justify-center items-center bg-background-dark p-6">
        <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
          App not found
        </Text>
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
              className="p-2 active:opacity-75"
            >
              <Feather name="refresh-cw" size={20} color="#ffffff" />
            </TouchableOpacity>
          ),
        }}
      />

      <View className="flex-1 bg-background-dark">
        {error ? (
          <View className="flex-1 justify-center items-center bg-background-dark p-6">
            <Feather name="alert-circle" size={48} color="#EF4444" />
            <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
              Failed to load {app.name}
            </Text>
            <Text className="text-gray-medium text-xs mb-5">{baseUrl}</Text>
            <TouchableOpacity
              className="flex-row items-center bg-white px-5 py-2.5 rounded-lg gap-2 active:opacity-75"
              onPress={handleReload}
            >
              <Feather name="refresh-cw" size={16} color="#ffffff" />
              <Text className="text-background-dark text-sm font-semibold">
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={webviewRef}
            source={{ uri: url }}
            className="flex-1 bg-background-dark"
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
          <View className="absolute top-0 right-0 bottom-0 left-0 justify-center items-center bg-background-dark">
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
      </View>
    </>
  );
}
