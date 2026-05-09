import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { AppConfig } from "@agent-native/shared-app-config";
import { useApps } from "../../lib/use-apps";

/** Map app IDs in the config to their tab file name. */
const APP_ID_TO_TAB: Record<string, string> = {
  mail: "index",
  calendar: "calendar",
  content: "content",
  slides: "slides",
  clips: "clips",
  analytics: "analytics",
  forms: "forms",
  design: "design",
  dispatch: "dispatch",
  starter: "starter",
};

/** Built-in app icon used both in the tab bar and the More sheet. */
const APP_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  mail: "mail",
  calendar: "calendar",
  content: "file-text",
  slides: "airplay",
  clips: "cast",
  analytics: "bar-chart-2",
  dispatch: "message-circle",
  forms: "clipboard",
  design: "edit-2",
  starter: "code",
};

const MAX_VISIBLE_APPS = 4;

export default function TabLayout() {
  const { enabledApps } = useApps();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  const enabledIds = useMemo(
    () => new Set(enabledApps.map((a) => a.id)),
    [enabledApps],
  );

  /** First N enabled apps that have a tab route → shown in the bar. */
  const visibleAppIds = useMemo(() => {
    const ids: string[] = [];
    for (const a of enabledApps) {
      if (APP_ID_TO_TAB[a.id]) {
        ids.push(a.id);
        if (ids.length >= MAX_VISIBLE_APPS) break;
      }
    }
    return new Set(ids);
  }, [enabledApps]);

  /** All enabled apps not in the bar → shown in the More sheet. */
  const overflowApps = useMemo(
    () => enabledApps.filter((a) => !visibleAppIds.has(a.id)),
    [enabledApps, visibleAppIds],
  );

  const hrefFor = useCallback(
    (appId: string) => (enabledIds.has(appId) ? undefined : null),
    [enabledIds],
  );

  /** Hide enabled-but-overflow tabs from the bar while keeping them routable. */
  const itemStyleFor = useCallback(
    (appId: string) =>
      enabledIds.has(appId) && !visibleAppIds.has(appId)
        ? { display: "none" as const }
        : undefined,
    [enabledIds, visibleAppIds],
  );

  const openOverflowApp = useCallback(
    (app: AppConfig) => {
      setMoreOpen(false);
      const tab = APP_ID_TO_TAB[app.id];
      if (tab) {
        router.push(tab === "index" ? "/" : (`/${tab}` as never));
      } else {
        router.push(`/app/${app.id}` as never);
      }
    },
    [router],
  );

  return (
    <>
      <Tabs
        initialRouteName="calendar"
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
          name="calendar"
          options={{
            title: "Calendar",
            headerShown: false,
            href: hrefFor("calendar"),
            tabBarItemStyle: itemStyleFor("calendar"),
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
            tabBarItemStyle: itemStyleFor("content"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="file-text" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="slides"
          options={{
            title: "Slides",
            headerShown: false,
            href: hrefFor("slides"),
            tabBarItemStyle: itemStyleFor("slides"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="airplay" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="clips"
          options={{
            title: "Clips",
            headerShown: false,
            href: hrefFor("clips"),
            tabBarItemStyle: itemStyleFor("clips"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="cast" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: "Analytics",
            headerShown: false,
            href: hrefFor("analytics"),
            tabBarItemStyle: itemStyleFor("analytics"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="bar-chart-2" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: "Mail",
            headerShown: false,
            href: hrefFor("mail"),
            tabBarItemStyle: itemStyleFor("mail"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="mail" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="dispatch"
          options={{
            title: "Dispatch",
            headerShown: false,
            href: hrefFor("dispatch"),
            tabBarItemStyle: itemStyleFor("dispatch"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="message-circle" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="forms"
          options={{
            title: "Forms",
            headerShown: false,
            href: hrefFor("forms"),
            tabBarItemStyle: itemStyleFor("forms"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="clipboard" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="design"
          options={{
            title: "Design",
            headerShown: false,
            href: hrefFor("design"),
            tabBarItemStyle: itemStyleFor("design"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="edit-2" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="starter"
          options={{
            title: "Starter",
            headerShown: false,
            href: hrefFor("starter"),
            tabBarItemStyle: itemStyleFor("starter"),
            tabBarIcon: ({ color, size }) => (
              <Feather name="code" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="videos"
          options={{
            title: "Video",
            headerShown: false,
            href: null,
            tabBarIcon: ({ color, size }) => (
              <Feather name="film" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: "More",
            tabBarItemStyle:
              overflowApps.length === 0 ? { display: "none" } : undefined,
            tabBarIcon: ({ color, size }) => (
              <Feather name="more-horizontal" size={size} color={color} />
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setMoreOpen(true);
            },
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

      <Modal
        visible={moreOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setMoreOpen(false)}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>More Apps</Text>
            <ScrollView>
              {overflowApps.length === 0 ? (
                <Text style={styles.emptyText}>
                  No additional apps. Enable more apps in Settings.
                </Text>
              ) : (
                overflowApps.map((app) => {
                  const iconName = APP_ICON[app.id] ?? "globe";
                  return (
                    <TouchableOpacity
                      key={app.id}
                      style={styles.row}
                      onPress={() => openOverflowApp(app)}
                    >
                      <View
                        style={[
                          styles.iconWrap,
                          { backgroundColor: `${app.color}33` },
                        ]}
                      >
                        <Feather
                          name={iconName}
                          size={18}
                          color={app.color}
                        />
                      </View>
                      <Text style={styles.rowText}>{app.name}</Text>
                      <Feather
                        name="chevron-right"
                        size={18}
                        color="#555555"
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 32,
    paddingHorizontal: 8,
    maxHeight: "70%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333333",
    marginBottom: 12,
  },
  sheetTitle: {
    color: "#999999",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
  },
  emptyText: {
    color: "#666666",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 24,
    textAlign: "center",
  },
});
