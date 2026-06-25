import { TeamPage } from "@agent-native/core/client/org";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.team }];
}

export default function TeamRoute() {
  useSetPageTitle("Team");
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <TeamPage createOrgDescription="Set up a team to share compositions and animations with your colleagues." />
    </main>
  );
}
