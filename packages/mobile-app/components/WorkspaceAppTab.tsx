import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { Text, View } from "react-native";

import AppWebView from "@/components/AppWebView";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppUrl } from "@/lib/get-app-url";
import { SESSION_TOKEN_KEY } from "@/lib/session-token-store";
import { useTabBarLayout } from "@/lib/tab-bar-layout";

export default function WorkspaceAppTab({
  appId,
  captureSessionToken = true,
}: {
  appId: string;
  captureSessionToken?: boolean;
}) {
  const { contentInset } = useTabBarLayout();
  const app = TEMPLATE_APPS.find((candidate) => candidate.id === appId);

  if (!app) {
    return (
      <SafeAreaView className="flex-1 bg-background-dark">
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-foreground text-base font-semibold">
            App unavailable
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      className="flex-1 bg-background-dark"
      style={{ paddingBottom: contentInset }}
    >
      <AppWebView
        url={getAppUrl(app)}
        captureSessionToken={captureSessionToken}
        workspaceAppId={appId}
        parentSessionTokenKey={SESSION_TOKEN_KEY}
      />
    </SafeAreaView>
  );
}
