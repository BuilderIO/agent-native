import { NewWorkspaceAppFlow } from "@agent-native/core/client";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "New App — Dispatch" }];
}

export default function NewAppRoute() {
  return (
    <DispatchShell
      title="New App"
      description="Create a workspace app from a prompt and grant it selected vault keys."
    >
      <NewWorkspaceAppFlow sourceApp="dispatch" className="px-0 py-0" />
    </DispatchShell>
  );
}
