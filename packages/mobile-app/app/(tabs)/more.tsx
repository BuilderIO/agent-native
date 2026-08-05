import { IconChevronRight, IconSettings } from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppCard from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useApps } from "@/lib/use-apps";

const APP_ID_TO_ROUTE: Record<string, string> = {
  analytics: "/analytics",
  brain: "/brain",
  calendar: "/calendar",
  chat: "/chat",
  clips: "/clips",
  content: "/content",
  design: "/design",
  dispatch: "/dispatch",
  forms: "/forms",
  mail: "/app/mail",
  slides: "/slides",
};

export default function AppsScreen() {
  const router = useRouter();
  const { enabledApps } = useApps();

  const openApp = useCallback(
    (id: string) => {
      router.push((APP_ID_TO_ROUTE[id] ?? `/app/${id}`) as never);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top"]} className="bg-background-dark flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <View className="items-center flex-row justify-between">
          <View>
            <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px]">
              YOUR WORKSPACE
            </Text>
            <Text className="text-foreground text-[34px] font-bold tracking-[-1px] mt-0.5">
              Apps
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Open app settings"
            accessibilityRole="button"
            onPress={() => router.push("/settings" as never)}
            className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
          >
            <IconSettings color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
        </View>
        <Text className="text-text-muted text-[15px] leading-[22px] mb-[18px] mt-[14px]">
          Open the full workspace apps when you need them. Capture and remote
          work stay native and one tap away from Home.
        </Text>
        <View className="flex-row flex-wrap -mx-[6px]">
          {enabledApps.map((app) => (
            <View key={app.id} className="w-[50%]">
              <AppCard app={app} onPress={() => openApp(app.id)} />
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/settings" as never)}
          className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row mt-[18px] p-[14px] active:opacity-75"
        >
          <View className="items-center bg-accent-green-dim rounded-xl h-[42px] w-[42px] justify-center">
            <IconSettings color="#c7f36b" size={20} strokeWidth={1.8} />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-text-light text-[15px] font-semibold">
              Manage mobile apps
            </Text>
            <Text className="text-status-gray text-xs leading-[17px] mt-0.5">
              Choose which workspace companions are available here.
            </Text>
          </View>
          <IconChevronRight color="#71717a" size={20} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
