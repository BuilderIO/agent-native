import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import AppWebView from "@/components/AppWebView";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppUrl } from "@/lib/get-app-url";

const analytics = TEMPLATE_APPS.find((a) => a.id === "analytics")!;

export default function AnalyticsTab() {
  return (
    <SafeAreaView className="flex-1 bg-background-dark">
      <AppWebView url={getAppUrl(analytics)} />
    </SafeAreaView>
  );
}
