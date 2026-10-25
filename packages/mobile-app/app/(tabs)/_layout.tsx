import { Tabs } from "expo-router";

import ChatFirstBottomTabs from "@/components/ChatFirstBottomTabs";
import { TabBarMinimizeProvider } from "@/components/TabBarEffects";
import { useMobileThemeColors } from "@/lib/mobile-colors";

const tabNames = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "clips",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "plan",
  "sessions",
  "settings",
  "slides",
] as const;

export default function TabLayout() {
  const { foreground, mutedForeground } = useMobileThemeColors();

  return (
    <TabBarMinimizeProvider>
      <Tabs
        tabBar={(props) => <ChatFirstBottomTabs {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: foreground,
          tabBarInactiveTintColor: mutedForeground,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          tabBarStyle: {
            backgroundColor: "transparent",
            borderTopWidth: 0,
            elevation: 0,
            position: "absolute",
          },
        }}
      >
        <Tabs.Screen name="chat" options={{ title: "Chat" }} />
        <Tabs.Screen name="more" options={{ title: "More" }} />
        {tabNames.map((name) => (
          <Tabs.Screen key={name} name={name} />
        ))}
      </Tabs>
    </TabBarMinimizeProvider>
  );
}
