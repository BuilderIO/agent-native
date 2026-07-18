import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppWebView from "@/components/AppWebView";
import {
  CLIPS_SESSION_OWNER_KEY,
  CLIPS_SESSION_TOKEN_KEY,
} from "@/lib/clips-session";
import { getAppUrl } from "@/lib/get-app-url";

const clips = TEMPLATE_APPS.find((a) => a.id === "clips")!;

export default function ClipsTab() {
  return (
    <SafeAreaView style={styles.container}>
      <AppWebView
        url={getAppUrl(clips)}
        captureSessionToken
        sessionOwnerKey={CLIPS_SESSION_OWNER_KEY}
        sessionTokenKey={CLIPS_SESSION_TOKEN_KEY}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
});
