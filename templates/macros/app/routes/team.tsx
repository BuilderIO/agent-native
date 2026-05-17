import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Team - Macros" }];
}

export default function TeamRoute() {
  useSetPageTitle("Team");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <TeamPage createOrgDescription="Set up a team to share nutrition logs and analytics with your colleagues." />
    </main>
  );
}
