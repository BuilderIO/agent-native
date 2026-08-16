import {
  IconChevronRight,
  IconSettings,
  IconWorld,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppCard from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useApps } from "@/lib/use-apps";
import { useWorkspaceApps } from "@/lib/workspace-apps";

export default function AppsScreen() {
  const router = useRouter();
  const { enabledApps: localApps } = useApps();
  const workspace = useWorkspaceApps();
  const [scope, setScope] = useState<"workspace" | "local">("local");

  useEffect(() => {
    setScope(workspace.enabled ? "workspace" : "local");
  }, [workspace.enabled]);

  const showingWorkspace = workspace.enabled && scope === "workspace";
  const enabledApps = showingWorkspace ? workspace.apps : localApps;

  const openApp = useCallback(
    (id: string) => {
      router.push(getAppRoute(id) as never);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top"]} className="bg-background-dark flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <View className="items-center flex-row justify-between">
          <Text className="text-foreground text-[30px] font-bold tracking-[-1px]">
            Apps
          </Text>
          <Pressable
            accessibilityLabel="Settings"
            accessibilityRole="button"
            onPress={() => router.push("/settings" as never)}
            className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
          >
            <IconSettings color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
        </View>

        {workspace.enabled ? (
          <View className="mt-7 mb-1">
            <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5">
              APPS IN
            </Text>
            <View className="flex-row rounded-xl border border-border-dark bg-card-dark p-1">
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: showingWorkspace }}
                onPress={() => setScope("workspace")}
                className={`flex-1 flex-row items-center justify-center rounded-lg py-2 ${showingWorkspace ? "bg-gray-charcoal" : ""}`}
              >
                <IconWorld color="#d4d4d8" size={15} strokeWidth={1.8} />
                <Text className="text-text-light text-xs font-semibold ml-1.5">
                  Workspace
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: !showingWorkspace }}
                onPress={() => setScope("local")}
                className={`flex-1 rounded-lg py-2 items-center justify-center ${!showingWorkspace ? "bg-gray-charcoal" : ""}`}
              >
                <Text className="text-text-light text-xs font-semibold">
                  Local
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          {workspace.enabled && !showingWorkspace
            ? "LOCAL APPS"
            : "WORKSPACE APPS"}
        </Text>
        {enabledApps.length > 0 ? (
          <View className="flex-row flex-wrap -mx-[6px]">
            {enabledApps.map((app) => (
              <View key={app.id} className="w-[50%]">
                <AppCard app={app} onPress={() => openApp(app.id)} />
              </View>
            ))}
          </View>
        ) : showingWorkspace ? (
          <View className="rounded-2xl border border-border-dark bg-card-dark px-4 py-5">
            <Text className="text-text-light text-sm font-semibold">
              No workspace apps yet
            </Text>
            <Text className="text-status-gray text-xs mt-1">
              Apps added to this workspace will appear here.
            </Text>
          </View>
        ) : null}

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          TOOLS
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/settings" as never)}
          className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row p-[14px] active:opacity-75"
        >
          <View className="items-center bg-gray-charcoal rounded-xl h-[42px] w-[42px] justify-center">
            <IconSettings color="#d4d4d8" size={20} strokeWidth={1.8} />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-text-light text-[15px] font-semibold">
              Customize navigation
            </Text>
            <Text className="text-status-gray text-xs leading-[17px] mt-0.5">
              Choose which apps sit beside Chat.
            </Text>
          </View>
          <IconChevronRight color="#71717a" size={20} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
