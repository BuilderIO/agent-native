import { useT } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.raw.routeTeamTitle }];
}

export default function TeamRoute() {
  const t = useT();
  useSetPageTitle(t("navigation.team"));
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TeamPage createOrgDescription={t("raw.teamDescription")} />
      </main>
    </div>
  );
}
