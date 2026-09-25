import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Settings - {{APP_TITLE}}" }];
}

export default function SettingsPage() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  const settingsRedesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);

  // The redesigned Settings brings its own Back link, title, and navigation,
  // and core Preferences owns the interface language. While the flag loads,
  // SettingsTabsPage shows the shell's skeleton, which needs the full height.
  if (settingsRedesign.enabled || settingsRedesign.status === "loading") {
    return (
      <div className="h-dvh">
        <SettingsTabsPage extraTabs={agentSettingsTabs} />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <Link
            to="/home"
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

        <SettingsTabsPage
          account={<AccountSettingsCard />}
          extraTabs={agentSettingsTabs}
          general={
            <section className="mx-auto w-full max-w-2xl rounded-lg border border-border/50 bg-card px-4 py-4">
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
          }
        />
      </div>
    </main>
  );
}
