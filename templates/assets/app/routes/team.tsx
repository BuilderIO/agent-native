import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Team - Assets" }];
}

export default function TeamRoute() {
  useSetPageTitle("Team");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <TeamPage createOrgDescription="Set up a team to share asset libraries and generated assets with your colleagues." />
    </main>
  );
}
