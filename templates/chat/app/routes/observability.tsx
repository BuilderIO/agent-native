import { ObservabilityDashboard, useT } from "@agent-native/core/client";

import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Agent Observability" }];
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
