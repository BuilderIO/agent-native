import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconChevronRight,
  IconHistory,
  IconSettings,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import {
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppCard";

const APP_ID_TO_ROUTE: Record<string, string> = {
  analytics: "/analytics",
  brain: "/brain",
  calendar: "/calendar",
  clips: "/clips",
  content: "/content",
  design: "/design",
  dispatch: "/dispatch",
  forms: "/forms",
  mail: "/app/mail",
  slides: "/slides",
};

const MOBILE_COLORS = {
  bright:
    Platform.OS === "ios"
      ? PlatformColor("labelColor")
      : Platform.OS === "android"
        ? PlatformColor("?android:attr/textColorPrimary")
        : "currentColor",
  muted:
    Platform.OS === "ios"
      ? PlatformColor("secondaryLabelColor")
      : Platform.OS === "android"
        ? PlatformColor("?android:attr/textColorSecondary")
        : "currentColor",
};

export function ChatFirstMobileRail({
  apps,
  onHistory,
  onSettings,
}: {
  apps: AppConfig[];
  onHistory: () => void;
  onSettings: () => void;
}) {
  const router = useRouter();
  const visibleApps = apps.slice(0, 6);

  return (
    <View className="border-b border-border-dark bg-background-dark px-3 pb-2">
      <View className="flex-row items-center justify-between py-1">
        <Text className="text-status-gray text-[11px] font-bold uppercase tracking-[1.1px]">
          Workspace
        </Text>
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat history"
            onPress={onHistory}
            className="flex-row items-center gap-1 rounded-full px-2 py-1 active:bg-white/5"
          >
            <IconHistory color={MOBILE_COLORS.muted} size={15} />
            <Text className="text-text-muted text-xs">Chats</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat settings"
            onPress={onSettings}
            className="rounded-full p-1.5 active:bg-white/5"
          >
            <IconSettings color={MOBILE_COLORS.muted} size={15} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {visibleApps.map((app) => (
          <Pressable
            key={app.id}
            accessibilityRole="button"
            accessibilityLabel={"Open " + app.name}
            onPress={() =>
              router.push(
                (APP_ID_TO_ROUTE[app.id] ?? "/app/" + app.id) as never,
              )
            }
            className="flex-row items-center gap-2 rounded-xl border border-border-dark bg-card-dark px-2.5 py-2 active:opacity-75"
          >
            <View className="h-6 w-6 items-center justify-center rounded-lg bg-gray-medium-dark">
              <AppIcon
                iconName={app.icon}
                size={14}
                color={MOBILE_COLORS.bright}
              />
            </View>
            <Text
              className="max-w-[110px] text-text-light text-xs font-semibold"
              numberOfLines={1}
            >
              {app.name}
            </Text>
            <IconChevronRight color={MOBILE_COLORS.muted} size={13} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
