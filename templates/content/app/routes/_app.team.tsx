import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Team — Content" }];
}

export default function TeamRoute() {
  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">Team</h1>,
  );
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto p-8">
        <TeamPage createOrgDescription="Set up a team to share documents and collaborate with your colleagues." />
      </div>
    </div>
  );
}
