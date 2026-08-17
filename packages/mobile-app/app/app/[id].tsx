import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, Stack } from "expo-router";
import { useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import AppWebView, { type AppWebViewHandle } from "@/components/AppWebView";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { SESSION_TOKEN_KEY } from "@/lib/session-token-store";
import { useApps } from "@/lib/use-apps";
import { useWorkspaceApps } from "@/lib/workspace-apps";

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apps } = useApps();
  const workspace = useWorkspaceApps();
  const webviewRef = useRef<AppWebViewHandle>(null);
  const { background, foreground } = useMobileThemeColors();

  const app =
    (workspace.enabled &&
      workspace.apps.find((candidate) => candidate.id === id)) ||
    apps.find((candidate) => candidate.id === id);
  const isWorkspaceApp =
    workspace.enabled &&
    workspace.apps.some((candidate) => candidate.id === id);

  if (!app) {
    return (
      <View className="flex-1 justify-center items-center bg-background-dark p-6">
        <Text className="text-white text-lg font-semibold mt-4 mb-1.5">
          App not found
        </Text>
      </View>
    );
  }

  const usesWorkspaceEmbed =
    isWorkspaceApp || (app.isBuiltIn && app.mode !== "dev");

  return (
    <>
      <Stack.Screen
        options={{
          title: app.name,
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => webviewRef.current?.reload()}
              className="p-2 active:opacity-75"
            >
              <Feather name="refresh-cw" size={20} color={foreground} />
            </TouchableOpacity>
          ),
        }}
      />
      <AppWebView
        ref={webviewRef}
        url={app.url}
        appName={app.name}
        captureSessionToken
        parentSessionTokenKey={SESSION_TOKEN_KEY}
        workspaceAppId={usesWorkspaceEmbed ? app.id : undefined}
      />
    </>
  );
}
