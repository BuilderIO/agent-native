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
      description="Dispatch can delegate to the built-in app suite over A2A by default. Add extra agents here only if you want to route work to apps outside that built-in set."
    >
      <AgentsPanel
        agents={(data || []) as ConnectedAgent[]}
        onRefresh={refetch}
      />
    </DispatchShell>
  );
}
