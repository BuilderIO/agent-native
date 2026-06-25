import { useT } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.team }];
}

export default function TeamRoute() {
  const t = useT();
  useSetPageTitle(t("team.title"));
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <TeamPage createOrgDescription={t("team.createOrgDescription")} />
    </main>
  );
}
