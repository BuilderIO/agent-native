import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, Stack } from "expo-router";
import { useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import AppWebView, { type AppWebViewHandle } from "@/components/AppWebView";
import { useApps } from "@/lib/use-apps";

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apps } = useApps();
  const webviewRef = useRef<AppWebViewHandle>(null);

  const app = apps.find((a) => a.id === id);

  if (!app) {
    return (
      <View className="flex-1 justify-center items-center bg-background-dark p-6">
        <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
          App not found
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: app.name,
          headerStyle: { backgroundColor: "#111111" },
          headerTintColor: "#ffffff",
          headerRight: () => (
            <TouchableOpacity
              onPress={() => webviewRef.current?.reload()}
              className="p-2 active:opacity-75"
            >
              <Feather name="refresh-cw" size={20} color="#ffffff" />
            </TouchableOpacity>
          ),
        }}
      />
      <AppWebView ref={webviewRef} url={app.url} appName={app.name} />
    </>
  );
}
