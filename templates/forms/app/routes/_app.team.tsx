import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Team" }];
}

export default function TeamRoute() {
  useSetPageTitle("Team");
  return (
    <div className="p-8">
      <TeamPage createOrgDescription="Set up a team to share forms and view responses together." />
    </div>
  );
}
