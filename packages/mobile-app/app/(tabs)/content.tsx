import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import AppWebView from "@/components/AppWebView";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppUrl } from "@/lib/get-app-url";

const content = TEMPLATE_APPS.find((a) => a.id === "content")!;

export default function ContentTab() {
  return (
    <SafeAreaView className="flex-1 bg-background-dark">
      <AppWebView url={getAppUrl(content)} />
    </SafeAreaView>
  );
}
