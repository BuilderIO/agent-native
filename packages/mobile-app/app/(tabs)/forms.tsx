import { SafeAreaView, StyleSheet } from "react-native";
import AppWebView from "@/components/AppWebView";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

const forms = DEFAULT_APPS.find((a) => a.id === "forms")!;

export default function FormsTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView url={forms.url} color={forms.color} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
