import "../global.css";
import { Stack, usePathname, useRootNavigationState } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Uniwind } from "uniwind";

import AppProviders from "@/components/AppProviders";
import MobileAnalyticsObserver from "@/components/MobileAnalyticsObserver";
import NativeSessionBootstrap from "@/components/NativeSessionBootstrap";
import OAuthDeepLinkHandler from "@/components/OAuthDeepLinkHandler";
import {
  acknowledgeIOSQuickAction,
  peekPendingIOSQuickAction,
  subscribeToIOSQuickActionAvailable,
} from "@/lib/ios-companion";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import {
  flushPendingNavigation,
  navigateToPath,
  NavigationPathProvider,
} from "@/lib/navigation";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const { background, foreground, theme } = useMobileThemeColors();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = useRef(false);
  const pendingQuickAction = useRef<{ id: string; path: string } | null>(null);
  const routedQuickActionId = useRef<string | null>(null);

  const routeQuickAction = useCallback(
    (action: { id: string; path: string }) => {
      const allowedPaths = [
        "/capture/audio",
        "/capture/video",
        "/capture/dictate",
      ];
      if (!allowedPaths.includes(action.path)) {
        const acknowledgment = acknowledgeIOSQuickAction(action.id);
        void acknowledgment?.catch((error) => {
          console.error(
            "[quick-action] Could not discard the pending route:",
            error,
          );
        });
        return;
      }
      if (!navigationReady.current) {
        pendingQuickAction.current = action;
        return;
      }
      if (routedQuickActionId.current !== action.id) {
        routedQuickActionId.current = action.id;
        navigateToPath(action.path, "replace");
      }
      pendingQuickAction.current = null;
      const acknowledgment = acknowledgeIOSQuickAction(action.id);
      void acknowledgment?.catch((error) => {
        console.error("[quick-action] Could not acknowledge the route:", error);
      });
    },
    [],
  );

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    navigationReady.current = true;
    flushPendingNavigation();
    if (pendingQuickAction.current)
      routeQuickAction(pendingQuickAction.current);
  }, [rootNavigationState?.key, routeQuickAction]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const consumePendingQuickAction = async () => {
      try {
        const action = await peekPendingIOSQuickAction();
        if (
          !action ||
          typeof action.id !== "string" ||
          typeof action.path !== "string"
        )
          return;
        routeQuickAction(action);
      } catch (error) {
        console.error(
          "[quick-action] Could not read the pending route:",
          error,
        );
      }
    };

    const unsubscribe = subscribeToIOSQuickActionAvailable(() => {
      void consumePendingQuickAction();
    });
    void consumePendingQuickAction();

    return unsubscribe;
  }, [routeQuickAction]);

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
    <AppProviders>
      <NavigationPathProvider pathname={pathname === "/" ? "/chat" : pathname}>
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
          <Stack.Screen name="app/[id]" options={{ headerBackTitle: "Apps" }} />
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
        </Stack>
      </NavigationPathProvider>
    </AppProviders>
  );
}
