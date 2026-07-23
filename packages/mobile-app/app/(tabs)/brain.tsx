import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import AppWebView from "@/components/AppWebView";
import { SafeAreaView } from "@/components/uniwind-interop";
import { getAppUrl } from "@/lib/get-app-url";

const brain = TEMPLATE_APPS.find((a) => a.id === "brain")!;

export default function BrainTab() {
  return (
    <SafeAreaView className="flex-1 bg-background-dark">
      <AppWebView url={getAppUrl(brain)} />
    </SafeAreaView>
  );
}
