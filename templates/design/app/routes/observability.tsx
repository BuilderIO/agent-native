import { ObservabilityDashboard } from "@agent-native/core/client/observability";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.agentObservability }];
}

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
