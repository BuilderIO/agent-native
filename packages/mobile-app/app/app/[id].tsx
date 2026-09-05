import { Feather } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect, useRef } from "react";
import { ActivityIndicator, View, Text, TouchableOpacity } from "react-native";

import AppWebView, { type AppWebViewHandle } from "@/components/AppWebView";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { useMobileNavigation, type RootStackParamList } from "@/lib/navigation";
import { SESSION_TOKEN_KEY } from "@/lib/session-token-store";
import { useApps } from "@/lib/use-apps";
import { useWorkspaceApps } from "@/lib/workspace-apps";

export default function AppScreen() {
  const { id } = useRoute<RouteProp<RootStackParamList, "App">>().params;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "App">>();
  const mobileNavigation = useMobileNavigation();
  const {
    apps,
    error: appsError,
    loading: appsLoading,
    reload: reloadApps,
  } = useApps();
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

  useLayoutEffect(() => {
    navigation.setOptions({
      title: app?.name ?? "App",
      headerStyle: { backgroundColor: background },
      headerTintColor: foreground,
      headerRight: app
        ? () => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Refresh ${app.name}`}
              onPress={() => webviewRef.current?.reload()}
              className="p-2 active:opacity-75"
            >
              <Feather name="refresh-cw" size={20} color={foreground} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [app, background, foreground, navigation]);

  if (appsLoading || workspace.loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: background }}
      >
        <ActivityIndicator color={foreground} />
      </View>
    );
  }

  if (appsError && !isWorkspaceApp) {
    return (
      <View
        className="flex-1 justify-center items-center p-6"
        style={{ backgroundColor: background }}
      >
        <Text
          className="text-lg font-semibold mt-4 mb-1.5"
          style={{ color: foreground }}
        >
          Unable to load apps
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry loading apps"
          onPress={() => void reloadApps()}
          className="mt-4 rounded-lg bg-primary px-4 py-2 active:opacity-75"
        >
          <Text className="font-medium text-white">Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to apps"
          onPress={() => mobileNavigation.replace("/more")}
          className="mt-3 rounded-lg px-4 py-2 active:opacity-75"
        >
          <Text className="font-medium" style={{ color: foreground }}>
            Back to apps
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!app) {
    return (
      <View
        className="flex-1 justify-center items-center p-6"
        style={{ backgroundColor: background }}
      >
        <Text
          className="text-lg font-semibold mt-4 mb-1.5"
          style={{ color: foreground }}
        >
          App not found
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to apps"
          onPress={() => mobileNavigation.replace("/more")}
          className="mt-4 rounded-lg bg-primary px-4 py-2 active:opacity-75"
        >
          <Text className="font-medium text-white">Back to apps</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const usesWorkspaceEmbed =
    isWorkspaceApp || (app.isBuiltIn && app.mode !== "dev");

  return (
    <AppWebView
      ref={webviewRef}
      url={app.url}
      appName={app.name}
      captureSessionToken
      parentSessionTokenKey={SESSION_TOKEN_KEY}
      workspaceAppId={usesWorkspaceEmbed ? app.id : undefined}
    />
  );
}
