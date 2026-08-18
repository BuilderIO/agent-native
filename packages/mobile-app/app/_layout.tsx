import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import CaptureSyncProvider from "@/components/CaptureSyncProvider";
import MobileAnalyticsObserver from "@/components/MobileAnalyticsObserver";
import NativeSessionBootstrap from "@/components/NativeSessionBootstrap";
import OAuthDeepLinkHandler from "@/components/OAuthDeepLinkHandler";
import { useMobileThemeColors } from "@/lib/mobile-colors";

export default function RootLayout() {
  const { background, foreground, theme } = useMobileThemeColors();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      Uniwind.setTheme(media.matches ? "dark" : "light");
    };

    syncTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncTheme);
    } else {
      media.addListener(syncTheme);
    }

    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", syncTheme);
      } else {
        media.removeListener(syncTheme);
      }
    };
  }, []);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <CaptureSyncProvider>
          <MobileAnalyticsObserver />
          <NativeSessionBootstrap />
          <OAuthDeepLinkHandler />
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: background },
              headerTintColor: foreground,
              headerTitleStyle: { fontWeight: "600" },
              contentStyle: { backgroundColor: background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="app/[id]"
              options={{
                headerShown: true,
                headerBackTitle: "Apps",
              }}
            />
            <Stack.Screen
              name="capture/audio"
              options={{
                gestureEnabled: false,
                headerShown: false,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="capture/dictate"
              options={{
                gestureEnabled: false,
                headerShown: false,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="capture/video"
              options={{
                gestureEnabled: false,
                headerShown: false,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="oauth-complete"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="+not-found" options={{ headerShown: false }} />
          </Stack>
        </CaptureSyncProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
