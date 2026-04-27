import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";
import { getAppUrl } from "@/lib/get-app-url";

const dispatch = DEFAULT_APPS.find((a) => a.id === "dispatch")!;

export default function DispatchTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={getAppUrl(dispatch)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
