import { McpIntegrationsLanding } from "@agent-native/core/client/integrations";

import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "Integrations — Dispatch" }];
}

export default function AgentIntegrationsRoute() {
  return (
    <DispatchShell
      title="Integrations"
      description="Connect the tools and services available to your agent."
    >
      <div className="mx-auto w-full max-w-5xl">
        <McpIntegrationsLanding showTitle={false} showDescription={false} />
      </div>
    </DispatchShell>
  );
}
