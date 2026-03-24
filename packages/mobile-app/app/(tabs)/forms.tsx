import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { useApps } from "@/lib/use-apps";

export default function FormsTab() {
  const { apps } = useApps();
  const forms = apps.find((a) => a.id === "forms");
  const url = forms?.url || "https://forms.agentnative.app";

  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={url} color="#06B6D4" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
