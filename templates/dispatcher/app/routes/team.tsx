import { TeamPage } from "@agent-native/core/client/org";
import { DispatcherShell } from "@/components/dispatcher-shell";

export function meta() {
  return [{ title: "Team — Dispatcher" }];
}

export default function TeamRoute() {
  return (
    <TeamPage
      title="Team"
      createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
      layout={(children) => (
        <DispatcherShell
          title="Team"
          description="Workspace membership and approval ownership."
        >
          {children}
        </DispatcherShell>
      )}
    />
  );
}
