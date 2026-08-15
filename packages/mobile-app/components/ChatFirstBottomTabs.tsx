import type { AppConfig } from "@agent-native/shared-app-config";
import { IconDots, IconMessageCircle } from "@tabler/icons-react-native";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { Pressable, Text, View } from "react-native";

import {
  appAccentBackgroundColor,
  appAccentColor,
  AppIcon,
} from "@/components/AppCard";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useMobileTabLayout } from "@/lib/mobile-tab-layout";
import { useApps } from "@/lib/use-apps";

const ICON_COLOR = "#d4d4d8";
const MUTED_COLOR = "#71717a";

type TabItem = {
  key: string;
  label: string;
  routeName: string;
  app?: AppConfig;
};

function routeNameForApp(appId: string): string {
  return getAppRoute(appId).replace(/^\//, "");
}

function TabButton({
  item,
  active,
  onPress,
}: {
  item: TabItem;
  active: boolean;
  onPress: () => void;
}) {
  const accentColor = item.app ? appAccentColor(item.app) : ICON_COLOR;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      className="min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xl py-1 active:opacity-70"
      style={{ flexBasis: 0 }}
      onPress={onPress}
    >
      <View
        className="h-7 w-9 items-center justify-center rounded-lg"
        style={{
          backgroundColor: active
            ? item.app
              ? appAccentBackgroundColor(accentColor)
              : "#27272a"
            : item.app
              ? appAccentBackgroundColor(accentColor)
              : "transparent",
        }}
      >
        {item.app ? (
          <AppIcon iconName={item.app.icon} size={18} color={accentColor} />
        ) : item.key === "more" ? (
          <IconDots
            color={active ? "#fafafa" : ICON_COLOR}
            size={20}
            strokeWidth={active ? 2.1 : 1.8}
          />
        ) : (
          <IconMessageCircle
            color={active ? "#fafafa" : ICON_COLOR}
            size={19}
            strokeWidth={active ? 2.1 : 1.8}
          />
        )}
      </View>
      <Text
        className={`max-w-full text-[10px] font-semibold ${active ? "text-foreground" : "text-status-gray"}`}
        numberOfLines={1}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

function navigateToTab({
  item,
  state,
  navigation,
}: {
  item: TabItem;
  state: BottomTabBarProps["state"];
  navigation: BottomTabBarProps["navigation"];
}) {
  const route = state.routes.find(
    (candidate) => candidate.name === item.routeName,
  );
  if (!route) return;
  const event = navigation.emit({
    type: "tabPress",
    target: route.key,
    canPreventDefault: true,
  });
  if (state.index !== state.routes.indexOf(route) && !event.defaultPrevented) {
    navigation.navigate(route.name);
  }
}

export default function ChatFirstBottomTabs({
  state,
  navigation,
  insets,
}: BottomTabBarProps) {
  const { enabledApps } = useApps();
  const { selectedAppIds } = useMobileTabLayout(enabledApps);
  const selectedApps = selectedAppIds
    .map((id) => enabledApps.find((app) => app.id === id))
    .filter((app): app is AppConfig => Boolean(app));
  const items: TabItem[] = [
    { key: "chat", label: "Chat", routeName: "chat" },
    ...selectedApps.map((app) => ({
      key: app.id,
      label: app.name,
      routeName: routeNameForApp(app.id),
      app,
    })),
    { key: "more", label: "More", routeName: "more" },
  ];
  const currentRouteName = state.routes[state.index]?.name;

  return (
    <View
      accessibilityLabel="Primary navigation"
      className="border-border-dark bg-background-dark border-t"
      style={{ paddingBottom: insets.bottom, width: "100%" }}
    >
      <View
        className="min-h-[62px] min-w-0 w-full flex-row items-start px-1 pt-1.5"
        style={{ flexBasis: 0 }}
      >
        {items.map((item) => {
          const active =
            currentRouteName === item.routeName ||
            (item.routeName === "more" &&
              currentRouteName !== "chat" &&
              !selectedApps.some(
                (app) => routeNameForApp(app.id) === currentRouteName,
              ));
          return (
            <TabButton
              key={item.key}
              active={active}
              item={item}
              onPress={() => navigateToTab({ item, navigation, state })}
            />
          );
        })}
        {items.length === 2 ? (
          <View className="flex-1 items-center justify-center" />
        ) : null}
      </View>
    </View>
  );
}

export function MoreTabIcon({ color = MUTED_COLOR }: { color?: string }) {
  return <IconDots color={color} size={20} strokeWidth={1.8} />;
}
