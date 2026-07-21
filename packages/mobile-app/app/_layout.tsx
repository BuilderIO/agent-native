import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import CaptureSyncProvider from "@/components/CaptureSyncProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CaptureSyncProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#111111" },
            headerTintColor: "#ffffff",
            headerTitleStyle: { fontWeight: "600" },
            contentStyle: { backgroundColor: "#111111" },
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
        </Stack>
      </CaptureSyncProvider>
    </SafeAreaProvider>
  );
}
