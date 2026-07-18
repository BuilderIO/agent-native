import { IconChevronRight, IconSettings } from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppCard from "@/components/AppCard";
import { useApps } from "@/lib/use-apps";

const APP_ID_TO_ROUTE: Record<string, string> = {
  analytics: "/analytics",
  brain: "/brain",
  calendar: "/calendar",
  chat: "/chat",
  clips: "/clips",
  content: "/content",
  design: "/design",
  dispatch: "/dispatch",
  forms: "/forms",
  mail: "/app/mail",
  slides: "/slides",
};

export default function AppsScreen() {
  const router = useRouter();
  const { enabledApps } = useApps();

  const openApp = useCallback(
    (id: string) => {
      router.push((APP_ID_TO_ROUTE[id] ?? `/app/${id}`) as never);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>YOUR WORKSPACE</Text>
            <Text style={styles.title}>Apps</Text>
          </View>
          <Pressable
            accessibilityLabel="Open app settings"
            accessibilityRole="button"
            onPress={() => router.push("/settings" as never)}
            style={styles.settingsButton}
          >
            <IconSettings color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
        </View>
        <Text style={styles.description}>
          Open the full workspace apps when you need them. Capture and remote
          work stay native and one tap away from Home.
        </Text>
        <View style={styles.grid}>
          {enabledApps.map((app) => (
            <View key={app.id} style={styles.cardCell}>
              <AppCard app={app} onPress={() => openApp(app.id)} />
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/settings" as never)}
          style={styles.manageRow}
        >
          <View style={styles.manageIcon}>
            <IconSettings color="#c7f36b" size={20} strokeWidth={1.8} />
          </View>
          <View style={styles.manageCopy}>
            <Text style={styles.manageTitle}>Manage mobile apps</Text>
            <Text style={styles.manageDescription}>
              Choose which workspace companions are available here.
            </Text>
          </View>
          <IconChevronRight color="#71717a" size={20} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#0b0b0c", flex: 1 },
  content: { padding: 20, paddingBottom: 36 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: "#fafafa",
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1,
    marginTop: 3,
  },
  settingsButton: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  description: {
    color: "#a1a1aa",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
    marginTop: 14,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  cardCell: { width: "50%" },
  manageRow: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 18,
    padding: 14,
  },
  manageIcon: {
    alignItems: "center",
    backgroundColor: "#22251d",
    borderRadius: 11,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  manageCopy: { flex: 1, marginLeft: 12 },
  manageTitle: { color: "#f4f4f5", fontSize: 15, fontWeight: "600" },
  manageDescription: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});
