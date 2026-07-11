import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppWebView from "@/components/AppWebView";
import { getAppUrl } from "@/lib/get-app-url";

const dispatch = TEMPLATE_APPS.find((a) => a.id === "dispatch")!;

export default function DispatchTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(dispatch)} captureSessionToken />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
