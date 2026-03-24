import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { useApps } from "@/lib/use-apps";

export default function ContentTab() {
  const { apps } = useApps();
  const content = apps.find((a) => a.id === "content");
  const url = content?.url || "https://content.agentnative.app";

  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={url} color="#10B981" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
