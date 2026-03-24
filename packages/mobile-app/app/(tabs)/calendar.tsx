import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { useApps } from "@/lib/use-apps";

export default function CalendarTab() {
  const { apps } = useApps();
  const calendar = apps.find((a) => a.id === "calendar");
  const url = calendar?.url || "https://calendar.agentnative.app";

  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={url} color="#8B5CF6" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
