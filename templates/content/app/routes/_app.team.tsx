import { useT } from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].team.metaTitle }];
}

export default function TeamRoute() {
  const t = useT();
  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      {t("team.pageTitle")}
    </h1>,
  );
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
        <div className="mb-6 space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("team.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("team.description")}
          </p>
        </div>
        <TeamPage
          title={t("team.peopleTitle")}
          createOrgDescription={t("team.createOrgDescription")}
          className="max-w-3xl"
        />
      </div>
    </div>
  );
}
