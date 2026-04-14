import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team" }];
}

export default function TeamRoute() {
  return (
    <div className="p-8">
      <TeamPage createOrgDescription="Set up a team to share forms and view responses together." />
    </div>
  );
}
