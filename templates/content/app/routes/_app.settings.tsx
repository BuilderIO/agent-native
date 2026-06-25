import {
  ChangelogSettingsCard,
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { Link } from "react-router";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  useSetPageTitle(t("settings.title"));

  return (
    <div className="flex-1 overflow-auto">
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">
              {t("settings.languageTitle")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.languageDescription")}
            </p>
          </div>
          <div className="mt-4 max-w-xs space-y-1.5">
            <Label>{t("settings.languageLabel")}</Label>
            <LanguagePicker label={t("settings.languageLabel")} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">
              {t("settings.workspaceTitle")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.workspaceDescription")}
            </p>
          </div>
          <Button className="mt-4" variant="outline" asChild>
            <Link to="/team">{t("settings.openTeamSettings")}</Link>
          </Button>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">
              {t("settings.agentTitle")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.agentDescription")}
            </p>
          </div>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => openAgentSettings()}
          >
            {t("settings.openAgentSettings")}
          </Button>
        </section>

        <ChangelogSettingsCard markdown={changelog} />
      </main>
    </div>
  );
}
