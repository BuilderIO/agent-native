import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { getAppUrl } from "@/lib/get-app-url";

const chat = TEMPLATE_APPS.find((a) => a.id === "chat")!;

export default function ChatTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(chat)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
