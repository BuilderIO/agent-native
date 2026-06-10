import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Team — Slides" }];
}

export default function TeamRoute() {
  useSetPageTitle("Team");
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TeamPage createOrgDescription="Set up a team to share presentations with your colleagues." />
      </main>
    </div>
  );
}
