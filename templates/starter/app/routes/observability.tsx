import { ObservabilityDashboard } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Agent Observability" }];
}

export default function ObservabilityPage() {
  return (
    <div className="p-6">
      <ObservabilityDashboard />
    </div>
  );
}
