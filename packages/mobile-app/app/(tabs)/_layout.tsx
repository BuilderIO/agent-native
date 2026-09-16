import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import AnalyticsTab from "@/app/(tabs)/analytics";
import AssetsTab from "@/app/(tabs)/assets";
import BrainTab from "@/app/(tabs)/brain";
import CalendarTab from "@/app/(tabs)/calendar";
import ChatTab from "@/app/(tabs)/chat";
import ClipsTab from "@/app/(tabs)/clips";
import ContentTab from "@/app/(tabs)/content";
import DesignTab from "@/app/(tabs)/design";
import DispatchTab from "@/app/(tabs)/dispatch";
import FormsTab from "@/app/(tabs)/forms";
import MailTab from "@/app/(tabs)/mail";
import AppsScreen from "@/app/(tabs)/more";
import PlanTab from "@/app/(tabs)/plan";
import SessionsScreen from "@/app/(tabs)/sessions";
import SettingsScreen from "@/app/(tabs)/settings";
import SlidesTab from "@/app/(tabs)/slides";
import ChatFirstBottomTabs from "@/components/ChatFirstBottomTabs";
import { TabBarMinimizeProvider } from "@/components/TabBarEffects";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import type { MobileTabParamList } from "@/lib/navigation";

const Tab = createBottomTabNavigator<MobileTabParamList>();

const screens = [
  ["analytics", AnalyticsTab],
  ["assets", AssetsTab],
  ["brain", BrainTab],
  ["calendar", CalendarTab],
  ["clips", ClipsTab],
  ["content", ContentTab],
  ["design", DesignTab],
  ["dispatch", DispatchTab],
  ["forms", FormsTab],
  ["mail", MailTab],
  ["plan", PlanTab],
  ["sessions", SessionsScreen],
  ["settings", SettingsScreen],
  ["slides", SlidesTab],
] as const;

export default function TabLayout() {
  const { foreground, mutedForeground } = useMobileThemeColors();

  return (
    <TabBarMinimizeProvider>
      <Tab.Navigator
        initialRouteName="chat"
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
        <Tab.Screen
          component={ChatTab}
          name="chat"
          options={{ title: "Chat" }}
        />
        <Tab.Screen
          component={AppsScreen}
          name="more"
          options={{ title: "More" }}
        />
        {screens.map(([name, component]) => (
          <Tab.Screen component={component} key={name} name={name} />
        ))}
      </Tab.Navigator>
    </TabBarMinimizeProvider>
  );
}
