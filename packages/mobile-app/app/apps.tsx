import {
  IconChevronLeft,
  IconChevronRight,
  IconMicrophone,
  IconSettings,
  IconTerminal2,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppCard from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useApps } from "@/lib/use-apps";

/** Apps with a native screen — everything else opens in the shared webview. */
const NATIVE_APP_ROUTES: Record<string, string> = {
  chat: "/chat",
  clips: "/clips",
};

export default function AppsScreen() {
  const router = useRouter();
  const { enabledApps } = useApps();

  const openApp = useCallback(
    (id: string) => {
      router.push((NATIVE_APP_ROUTES[id] ?? `/app/${id}`) as never);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top"]} className="bg-background-dark flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <View className="items-center flex-row justify-between">
          <View className="items-center flex-row gap-2.5">
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
            >
              <IconChevronLeft color="#f4f4f5" size={22} strokeWidth={1.8} />
            </Pressable>
            <View>
              <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px]">
                YOUR WORKSPACE
              </Text>
              <Text className="text-foreground text-[30px] font-bold tracking-[-1px] mt-0.5">
                Apps
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="Settings"
            accessibilityRole="button"
            onPress={() => router.push("/settings" as never)}
            className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
          >
            <IconSettings color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
        </View>

        <Text className="text-text-muted text-[15px] leading-5.5 mb-4.5 mt-3.5">
          Open the full workspace apps when you need them. Capture and remote
          work stay native and one tap away from Home.
        </Text>
        <View className="flex-row flex-wrap -mx-1.5">
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
            onPress={() => router.push("/home" as never)}
            className="flex-row items-center px-3.5 py-3.5 border-b border-border-dark active:bg-white/5"
          >
            <View className="items-center justify-center bg-accent-green-dim rounded-xl h-10 w-10">
              <IconMicrophone color="#9ad6b0" size={19} strokeWidth={1.8} />
            </View>
            <Text className="text-text-light text-[15px] font-semibold flex-1 ml-3">
              Capture
            </Text>
            <IconChevronRight color="#71717a" size={19} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/sessions" as never)}
            className="flex-row items-center px-3.5 py-3.5 active:bg-white/5"
          >
            <View className="items-center justify-center bg-accent-orange rounded-xl h-10 w-10">
              <IconTerminal2 color="#0b0b0c" size={19} strokeWidth={1.8} />
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
          className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row mt-4.5 p-3.5 active:opacity-75"
        >
          <View className="items-center bg-accent-green-dim rounded-xl h-10.5 w-10.5 justify-center">
            <IconSettings color="#c7f36b" size={20} strokeWidth={1.8} />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-text-light text-[15px] font-semibold">
              Customize navigation
            </Text>
            <Text className="text-status-gray text-xs leading-4.25 mt-0.5">
              Choose which workspace companions are available here.
            </Text>
          </View>
          <IconChevronRight color="#71717a" size={20} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
