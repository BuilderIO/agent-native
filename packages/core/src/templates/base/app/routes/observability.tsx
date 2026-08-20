import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

export function meta() {
  return [{ title: "Agent Observability" }];
}

export default function ObservabilityPage() {
  useSetPageTitle("Agent Observability");
  return (
    <div className="p-6">
      <ObservabilityDashboard />
    </div>
  );
}
