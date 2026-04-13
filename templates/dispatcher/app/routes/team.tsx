import { TeamPage } from "@agent-native/core/client/org";
import { DispatcherShell } from "@/components/dispatcher-shell";

export function meta() {
  return [{ title: "Team — Dispatcher" }];
}

export default function TeamRoute() {
  return (
    <TeamPage
      title="Team"
      layout={(children) => (
        <DispatcherShell
          title="Team and approval ownership"
          description="Dispatcher inherits workspace membership, active organization, and approver policy from the same shared auth layer as the rest of the workspace."
        >
          {children}
        </DispatcherShell>
      )}
    />
  );
}
