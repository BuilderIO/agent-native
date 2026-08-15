import { Tabs } from "expo-router";

import ChatFirstBottomTabs from "@/components/ChatFirstBottomTabs";
import { useChatFirstMode } from "@/lib/chat-first-mode";

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
  const { enabled: chatFirstMode } = useChatFirstMode();

  return (
    <Tabs
      initialRouteName={chatFirstMode ? "chat" : "index"}
      tabBar={
        chatFirstMode
          ? (props) => <ChatFirstBottomTabs {...props} />
          : undefined
      }
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
          href: chatFirstMode ? null : undefined,
        }}
      />
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen
        name="clips"
        options={{
          title: "Clips",
          href: chatFirstMode ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Sessions",
          href: chatFirstMode ? null : undefined,
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
