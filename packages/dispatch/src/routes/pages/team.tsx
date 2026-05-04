import { TeamPage } from "@agent-native/core/client/org";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "Team — Dispatch" }];
}

export default function TeamRoute() {
  return (
    <TeamPage
      title="Team"
      createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
      layout={(children) => (
        <DispatchShell
          title="Team"
          description="Workspace membership and approval ownership."
        >
          {children}
        </DispatchShell>
      )}
    />
  );
}
