import {
  CHAT_FIRST_DEFAULT_APP_IDS,
  type AppConfig,
} from "@agent-native/shared-app-config";
import {
  IconChevronDown,
  IconHistory,
  IconSettings,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, PlatformColor, Pressable, Text, View } from "react-native";

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
    Platform.OS === "web"
      ? "rgba(244, 244, 245, 0.92)"
      : Platform.OS === "ios"
        ? PlatformColor("labelColor")
        : Platform.OS === "android"
          ? PlatformColor("?android:attr/textColorPrimary")
          : "currentColor",
  muted:
    Platform.OS === "web"
      ? "rgba(161, 161, 170, 0.88)"
      : Platform.OS === "ios"
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
  const [showMore, setShowMore] = useState(false);
  const orderedApps = [...apps].sort((a, b) => {
    const aIndex = CHAT_FIRST_DEFAULT_APP_IDS.indexOf(
      a.id as (typeof CHAT_FIRST_DEFAULT_APP_IDS)[number],
    );
    const bIndex = CHAT_FIRST_DEFAULT_APP_IDS.indexOf(
      b.id as (typeof CHAT_FIRST_DEFAULT_APP_IDS)[number],
    );
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  const primaryApps = orderedApps.slice(0, 5);
  const secondaryApps = orderedApps.slice(5);
  const visibleApps = showMore ? orderedApps : primaryApps;

  return (
    <View className="bg-background-dark px-3 pb-2">
      <View className="flex-row items-center justify-between py-1">
        <Text className="text-status-gray text-[11px] font-medium tracking-[0.2px]">
          Apps
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
      <View className="gap-0.5">
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
            className="h-8 flex-row items-center gap-2 rounded-md px-2 active:bg-white/5"
          >
            <View className="h-6 w-6 items-center justify-center">
              <AppIcon
                iconName={app.icon}
                size={14}
                color={MOBILE_COLORS.bright}
              />
            </View>
            <Text
              className="flex-1 text-text-light text-[13px] font-medium"
              numberOfLines={1}
            >
              {app.name}
            </Text>
          </Pressable>
        ))}
      </View>
      {secondaryApps.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showMore ? "Show fewer apps" : "Show more apps"}
          onPress={() => setShowMore((value) => !value)}
          className="mt-0.5 flex-row items-center gap-2 rounded-md px-2 py-1.5 active:bg-white/5"
        >
          <IconChevronDown
            color={MOBILE_COLORS.muted}
            size={14}
            style={{ transform: [{ rotate: showMore ? "180deg" : "0deg" }] }}
          />
          <Text className="text-status-gray text-[12px]">
            {showMore ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
