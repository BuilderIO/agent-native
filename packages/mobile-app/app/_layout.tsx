import "../global.css";
import {
  NavigationContainer,
  type LinkingOptions,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import TabLayout from "@/app/(tabs)/_layout";
import NotFoundScreen from "@/app/+not-found";
import AppScreen from "@/app/app/[id]";
import MeetingCaptureScreen from "@/app/capture/audio";
import DictationCaptureScreen from "@/app/capture/dictate";
import VideoCaptureScreen from "@/app/capture/video";
import OAuthComplete from "@/app/oauth-complete";
import CaptureSyncProvider from "@/components/CaptureSyncProvider";
import MobileAnalyticsObserver from "@/components/MobileAnalyticsObserver";
import NativeSessionBootstrap from "@/components/NativeSessionBootstrap";
import OAuthDeepLinkHandler from "@/components/OAuthDeepLinkHandler";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import {
  flushPendingNavigation,
  getCurrentPathname,
  navigationRef,
  NavigationPathProvider,
  type RootStackParamList,
} from "@/lib/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/"), "agentnative://"],
  config: {
    screens: {
      Tabs: {
        path: "",
        screens: {
          analytics: "analytics",
          assets: "assets",
          brain: "brain",
          calendar: "calendar",
          chat: "chat",
          clips: "clips",
          content: "content",
          design: "design",
          dispatch: "dispatch",
          forms: "forms",
          mail: "mail",
          more: "more",
          plan: "plan",
          sessions: "sessions",
          settings: "settings",
          slides: "slides",
        },
      },
      App: "app/:id",
      CaptureAudio: "capture/audio",
      CaptureDictate: "capture/dictate",
      CaptureVideo: "capture/video",
      OAuthComplete: "oauth-complete",
      NotFound: "*",
    },
  },
};

export default function RootLayout() {
  const { background, foreground, theme } = useMobileThemeColors();
  const [pathname, setPathname] = useState("/chat");
  const syncPathname = useCallback(() => {
    setPathname(getCurrentPathname());
  }, []);
  const handleNavigationReady = useCallback(() => {
    flushPendingNavigation();
    syncPathname();
  }, [syncPathname]);

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
          <NavigationPathProvider pathname={pathname}>
            <MobileAnalyticsObserver />
            <NativeSessionBootstrap />
            <OAuthDeepLinkHandler />
            <StatusBar style={theme === "dark" ? "light" : "dark"} />
            <NavigationContainer
              linking={linking}
              onReady={handleNavigationReady}
              onStateChange={syncPathname}
              ref={navigationRef}
            >
              <Stack.Navigator
                screenOptions={{
                  headerStyle: { backgroundColor: background },
                  headerTintColor: foreground,
                  headerTitleStyle: { fontWeight: "600" },
                  contentStyle: { backgroundColor: background },
                }}
              >
                <Stack.Screen
                  component={TabLayout}
                  name="Tabs"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  component={AppScreen}
                  name="App"
                  options={{ headerBackTitle: "Apps" }}
                />
                <Stack.Screen
                  component={MeetingCaptureScreen}
                  name="CaptureAudio"
                  options={{
                    gestureEnabled: false,
                    headerShown: false,
                    presentation: "fullScreenModal",
                  }}
                />
                <Stack.Screen
                  component={DictationCaptureScreen}
                  name="CaptureDictate"
                  options={{
                    gestureEnabled: false,
                    headerShown: false,
                    presentation: "fullScreenModal",
                  }}
                />
                <Stack.Screen
                  component={VideoCaptureScreen}
                  name="CaptureVideo"
                  options={{
                    gestureEnabled: false,
                    headerShown: false,
                    presentation: "fullScreenModal",
                  }}
                />
                <Stack.Screen
                  component={OAuthComplete}
                  name="OAuthComplete"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  component={NotFoundScreen}
                  name="NotFound"
                  options={{ headerShown: false }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </NavigationPathProvider>
        </CaptureSyncProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
