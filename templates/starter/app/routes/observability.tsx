import { ObservabilityDashboard } from "@agent-native/core/client/observability";

export function meta() {
  return [{ title: "Agent Observability" }];
}

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
