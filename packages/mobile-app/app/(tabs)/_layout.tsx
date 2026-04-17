import { Tabs } from "expo-router";
import { Feather, FontAwesome5 } from "@expo/vector-icons";
import { useApps } from "../../lib/use-apps";

/** Map tab file names to app IDs in the config */
const TAB_TO_APP_ID: Record<string, string> = {
  index: "mail",
  calendar: "calendar",
  content: "content",
  clips: "clips",
  forms: "forms",
  issues: "issues",
  recruiting: "recruiting",
};

export default function TabLayout() {
  const { enabledApps, loading } = useApps();

  const enabledIds = new Set(enabledApps.map((a) => a.id));

  /** Returns `undefined` (show tab) or `null` (hide tab) */
  const hrefFor = (tabName: string) => {
    const appId = TAB_TO_APP_ID[tabName];
    // Settings tab is always visible; unknown tabs default to visible
    if (!appId) return undefined;
    return enabledIds.has(appId) ? undefined : null;
  };

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#111111",
          borderTopColor: "#222222",
        },
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "#666666",
        headerStyle: { backgroundColor: "#111111" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mail",
          headerShown: false,
          href: hrefFor("index"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="mail" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          headerShown: false,
          href: hrefFor("calendar"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: "Content",
          headerShown: false,
          href: hrefFor("content"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="file-text" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: "Clips",
          headerShown: false,
          href: hrefFor("clips"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="video" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="forms"
        options={{
          title: "Forms",
          headerShown: false,
          href: hrefFor("forms"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="clipboard" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="issues"
        options={{
          title: "Issues",
          headerShown: false,
          href: hrefFor("issues"),
          tabBarIcon: ({ color, size }) => (
            <FontAwesome5 name="jira" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="recruiting"
        options={{
          title: "Recruiting",
          headerShown: false,
          href: hrefFor("recruiting"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
