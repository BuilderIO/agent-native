import { useActionQuery } from "@agent-native/core/client";
import { AgentsPanel, type ConnectedAgent } from "@/components/agents-panel";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "Agents — Dispatch" }];
}

export default function AgentsRoute() {
  const { data, refetch } = useActionQuery("list-connected-agents", {});

  return (
    <DispatchShell
      title="Agents"
      description="Built-in and external agents available for dispatch to delegate work to."
    >
      <AgentsPanel
        agents={(data || []) as ConnectedAgent[]}
        onRefresh={refetch}
      />
    </DispatchShell>
  );
}
