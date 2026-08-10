import {
  IconApps,
  IconHome,
  IconMessageCircle,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react-native";
import { Tabs } from "expo-router";

const HIDDEN_APP_ROUTES = [
  "analytics",
  "brain",
  "calendar",
  "content",
  "design",
  "dispatch",
  "forms",
  "settings",
  "slides",
] as const;

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#f4f4f5",
        tabBarInactiveTintColor: "#71717a",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: "#0b0b0c",
          borderTopColor: "#27272a",
          height: 82,
          paddingBottom: 22,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <IconHome color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: "Clips",
          tabBarIcon: ({ color, size }) => (
            <IconSparkles color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <IconMessageCircle color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color, size }) => (
            <IconTerminal2 color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "Apps",
          tabBarIcon: ({ color, size }) => (
            <IconApps color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />
      {HIDDEN_APP_ROUTES.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
