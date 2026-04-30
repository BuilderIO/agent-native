import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, ActivityIndicator, StyleSheet } from "react-native";

const SESSION_TOKEN_KEY = "agent-native:session-token";
const OAUTH_STATE_KEY = "agent-native:oauth-state";

/**
 * Handles the agentnative://oauth-complete?token=xyz deep link after Google OAuth.
 * Stores the session token so the WebView can inject it as a cookie, then
 * redirects back to the main tabs.
 */
export default function OAuthComplete() {
  const { token, state } = useLocalSearchParams<{
    token?: string;
    state?: string;
  }>();

  useEffect(() => {
    (async () => {
      if (token) {
        const expectedState = await AsyncStorage.getItem(OAUTH_STATE_KEY);
        await AsyncStorage.removeItem(OAUTH_STATE_KEY);
        if (expectedState && state === expectedState) {
          await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
        }
      }
      router.replace("/(tabs)");
    })();
  }, [state, token]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#ffffff" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111111",
  },
});
