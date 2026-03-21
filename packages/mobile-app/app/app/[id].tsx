import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { useApps } from "@/lib/use-apps";

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apps } = useApps();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const app = apps.find((a) => a.id === id);

  const handleReload = useCallback(() => {
    setError(false);
    setLoading(true);
    webviewRef.current?.reload();
  }, []);

  if (!app) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>App not found</Text>
      </View>
    );
  }

  const url = app.url;

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
            <Text style={styles.errorUrl}>{url}</Text>
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
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
          />
        )}

        {loading && !error && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={app.color} />
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
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: "#3B82F6",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
