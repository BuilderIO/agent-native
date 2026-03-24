import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

const content = DEFAULT_APPS.find((a) => a.id === "content")!;

export default function ContentTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={content.url} color={content.color} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
