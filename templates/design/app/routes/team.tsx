import { useT } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.teamDesign }];
}

export default function TeamRoute() {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <TeamPage createOrgDescription={t("pages.teamCreateOrgDescription")} />
      </main>
    </div>
  );
}
