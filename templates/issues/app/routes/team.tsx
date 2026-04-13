import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Issues" }];
}

export default function TeamRoute() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <TeamPage createOrgDescription="Set up a team to share projects and issues with your colleagues." />
    </div>
  );
}
