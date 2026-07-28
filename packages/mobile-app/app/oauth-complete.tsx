import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";

/**
 * Transient screen shown if the agentnative://oauth-complete deep link happens
 * to route here. The real work — applying the token and navigating back to the
 * originating app — is owned by OAuthDeepLinkHandler at the app root, so this
 * screen must not touch the stored token/state/return keys (that would race the
 * root handler and consume them first).
 */
export default function OAuthComplete() {
  useEffect(() => {
    console.log(
      "[oauth] oauth-complete ROUTE mounted (expo-router routed here)",
    );
  }, []);
  return (
    <View className="flex-1 justify-center items-center bg-background-dark">
      <ActivityIndicator size="large" color="#ffffff" />
    </View>
  );
}
