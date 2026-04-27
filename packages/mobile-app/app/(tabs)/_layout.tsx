import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useApps } from "../../lib/use-apps";

/** Map tab file names to app IDs in the config */
const TAB_TO_APP_ID: Record<string, string> = {
  index: "mail",
  calendar: "calendar",
  slides: "slides",
  content: "content",
  analytics: "analytics",
  videos: "videos",
  forms: "forms",
  clips: "clips",
  design: "design",
  dispatch: "dispatch",
  starter: "starter",
};

export default function TabLayout() {
  const { enabledApps, loading } = useApps();

  const enabledIds = new Set(enabledApps.map((a) => a.id));

  /** Returns `undefined` (show tab) or `null` (hide tab) */
  const hrefFor = (tabName: string) => {
    const appId = TAB_TO_APP_ID[tabName];
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
        name="slides"
        options={{
          title: "Slides",
          headerShown: false,
          href: hrefFor("slides"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="airplay" size={size} color={color} />
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
        name="analytics"
        options={{
          title: "Analytics",
          headerShown: false,
          href: hrefFor("analytics"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="bar-chart-2" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="videos"
        options={{
          title: "Video",
          headerShown: false,
          href: hrefFor("videos"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="film" size={size} color={color} />
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
        name="clips"
        options={{
          title: "Clips",
          headerShown: false,
          href: hrefFor("clips"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="cast" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="design"
        options={{
          title: "Design",
          headerShown: false,
          href: hrefFor("design"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="edit-2" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dispatch"
        options={{
          title: "Dispatch",
          headerShown: false,
          href: hrefFor("dispatch"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="message-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="starter"
        options={{
          title: "Starter",
          headerShown: false,
          href: hrefFor("starter"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="code" size={size} color={color} />
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
