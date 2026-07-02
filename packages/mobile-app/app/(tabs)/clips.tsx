import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { SafeAreaView, StyleSheet } from "react-native";

import AppWebView from "@/components/AppWebView";
import { getAppUrl } from "@/lib/get-app-url";

const clips = TEMPLATE_APPS.find((a) => a.id === "clips")!;

export default function ClipsTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(clips)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
