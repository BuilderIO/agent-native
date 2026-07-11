import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppWebView from "@/components/AppWebView";
import { getAppUrl } from "@/lib/get-app-url";

const design = TEMPLATE_APPS.find((a) => a.id === "design")!;

export default function DesignTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(design)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
