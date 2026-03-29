import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";
import { getAppUrl } from "@/lib/get-app-url";

const mail = DEFAULT_APPS.find((a) => a.id === "mail")!;

export default function MailTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(mail)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
