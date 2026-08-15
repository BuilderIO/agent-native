import {
  IconChevronRight,
  IconSettings,
  IconTerminal2,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppCard from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useApps } from "@/lib/use-apps";

export default function AppsScreen() {
  const router = useRouter();
  const { enabledApps } = useApps();

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

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          WORKSPACE APPS
        </Text>
        <View className="flex-row flex-wrap -mx-[6px]">
          {enabledApps.map((app) => (
            <View key={app.id} className="w-[50%]">
              <AppCard app={app} onPress={() => openApp(app.id)} />
            </View>
          ))}
        </View>

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          NATIVE TOOLS
        </Text>
        <View className="bg-card-dark border border-border-dark rounded-2xl overflow-hidden">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/sessions" as never)}
            className="flex-row items-center px-3.5 py-3.5 active:bg-white/5"
          >
            <View className="items-center justify-center bg-gray-charcoal rounded-xl h-10 w-10">
              <IconTerminal2 color="#d4d4d8" size={19} strokeWidth={1.8} />
            </View>
            <Text className="text-text-light text-[15px] font-semibold flex-1 ml-3">
              Sessions
            </Text>
            <IconChevronRight color="#71717a" size={19} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/settings" as never)}
          className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row mt-4 p-[14px] active:opacity-75"
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
