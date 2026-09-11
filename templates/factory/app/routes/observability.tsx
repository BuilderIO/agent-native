import { useT } from "@agent-native/core/client/i18n";
import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.pages.observabilityPageTitle }];
}

export default function ObservabilityPage() {
  const t = useT();
  useSetPageTitle(t("pages.observabilityPageTitle"));
  return (
    <div className="p-6">
      <ObservabilityDashboard />
    </div>
  );
}
