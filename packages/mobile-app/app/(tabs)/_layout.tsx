import { Tabs } from "expo-router";

import ChatFirstBottomTabs from "@/components/ChatFirstBottomTabs";
import { useMobileThemeColors } from "@/lib/mobile-colors";

const HIDDEN_APP_ROUTES = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "plan",
  "settings",
  "slides",
] as const;

export default function TabLayout() {
  const { background, border, foreground, mutedForeground } =
    useMobileThemeColors();

  return (
    <Tabs
      initialRouteName="chat"
      tabBar={(props) => <ChatFirstBottomTabs {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: foreground,
        tabBarInactiveTintColor: mutedForeground,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: background,
          borderTopColor: border,
          height: 82,
          paddingBottom: 22,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="clips"
        options={{
          title: "Clips",
          href: null,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
        }}
      />
      {HIDDEN_APP_ROUTES.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
