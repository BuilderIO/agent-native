import {
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Settings - {{APP_TITLE}}" }];
}

export default function SettingsPage() {
  const t = useT();

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="space-y-2">
          <Link
            to="/"
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            {t("settings.backHome")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("settings.title")}
          </h1>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        <section className="rounded-lg border border-border/50 bg-card px-4 py-4">
          <div className="space-y-1">
            <h2 className="text-[15px] font-semibold text-foreground">
              {t("settings.languageTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("settings.languageDescription")}
            </p>
          </div>
          <div className="mt-4 max-w-xs">
            <LanguagePicker label={t("settings.languageLabel")} />
          </div>
        </section>

        <section className="rounded-lg border border-border/50 bg-card px-4 py-4">
          <div className="space-y-1">
            <h2 className="text-[15px] font-semibold text-foreground">
              {t("settings.agentTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("settings.agentDescription")}
            </p>
          </div>
          <button
            type="button"
            className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/50"
            onClick={() => openAgentSettings()}
          >
            {t("settings.openAgentSettings")}
          </button>
        </section>
      </div>
    </main>
  );
}
