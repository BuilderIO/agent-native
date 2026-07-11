import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppWebView from "@/components/AppWebView";
import { getAppUrl } from "@/lib/get-app-url";

const calendar = TEMPLATE_APPS.find((a) => a.id === "calendar")!;

export default function CalendarTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(calendar)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
