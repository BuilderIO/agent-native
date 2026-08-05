import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import AppWebView from "@/components/AppWebView";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppUrl } from "@/lib/get-app-url";

const forms = TEMPLATE_APPS.find((a) => a.id === "forms")!;

export default function FormsTab() {
  return (
    <SafeAreaView className="flex-1 bg-background-dark">
      <AppWebView url={getAppUrl(forms)} />
    </SafeAreaView>
  );
}
