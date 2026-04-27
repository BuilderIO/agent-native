import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";
import { getAppUrl } from "@/lib/get-app-url";

const starter = DEFAULT_APPS.find((a) => a.id === "starter")!;

export default function StarterTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(starter)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
