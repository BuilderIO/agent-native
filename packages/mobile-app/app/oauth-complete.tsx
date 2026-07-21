import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";

import { saveSessionToken } from "@/lib/session-token-store";

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
    void (async () => {
      if (token) {
        const expectedState = await AsyncStorage.getItem(OAUTH_STATE_KEY);
        await AsyncStorage.removeItem(OAUTH_STATE_KEY);
        if (expectedState && state === expectedState) {
          await saveSessionToken(token);
        }
      }
      router.replace("/(tabs)");
    })();
  }, [state, token]);

  return (
    <View className="flex-1 justify-center items-center bg-background-dark">
      <ActivityIndicator size="large" color="#ffffff" />
    </View>
  );
}
