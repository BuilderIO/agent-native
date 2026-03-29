import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";
import { getAppUrl } from "@/lib/get-app-url";

const content = DEFAULT_APPS.find((a) => a.id === "content")!;

export default function ContentTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(content)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
