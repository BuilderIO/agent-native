import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

const mail = DEFAULT_APPS.find((a) => a.id === "mail")!;

export default function MailTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={mail.url} color={mail.color} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
