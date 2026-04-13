import { useActionQuery } from "@agent-native/core/client";
import { AgentsPanel, type ConnectedAgent } from "@/components/agents-panel";
import { DispatcherShell } from "@/components/dispatcher-shell";

export function meta() {
  return [{ title: "Agents — Dispatcher" }];
}

export default function AgentsRoute() {
  const { data, refetch } = useActionQuery("list-connected-agents", {});

  return (
    <DispatcherShell
      title="Agents"
      description="Built-in and external agents available for dispatcher to delegate work to."
    >
      <AgentsPanel
        agents={(data || []) as ConnectedAgent[]}
        onRefresh={refetch}
      />
    </DispatcherShell>
  );
}
