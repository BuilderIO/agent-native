import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppWebView from "@/components/AppWebView";
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
