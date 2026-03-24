import { useState, useRef } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

interface AppWebViewProps {
  url: string;
  color?: string;
}

export default function AppWebView({
  url,
  color = "#3B82F6",
}: AppWebViewProps) {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
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
