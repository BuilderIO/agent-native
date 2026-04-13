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
          title="Team"
          description="Workspace membership and approval ownership."
        >
          {children}
        </DispatcherShell>
      )}
    />
  );
}
