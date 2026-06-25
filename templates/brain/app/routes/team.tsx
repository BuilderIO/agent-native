import { useT } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.team }];
}

export default function TeamRoute() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <TeamPage createOrgDescription={t("team.createOrgDescription")} />
    </main>
  );
}
