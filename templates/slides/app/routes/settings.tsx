import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { TeamPage, useOrg } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  CreativeContextSettingsLink,
  createCreativeContextAgentTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { SLIDES_LABS } from "@shared/labs";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useSlidesPrefs } from "@/hooks/use-slides-prefs";
import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.raw.routeSettingsTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextLab();
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories: creativeContextEnabled
      ? [createCreativeContextAgentTab]
      : [],
  });
  const observabilityBasePath = buildSettingsRoute("observability");
  const observabilityTabs =
    !orgLoading &&
    !orgError &&
    activeOrg?.orgId &&
    (activeOrg.role === "owner" || activeOrg.role === "admin")
      ? [
          {
            id: "observability",
            label: t("settings.agentObservability"),
            icon: IconActivity,
            group: "agent",
            href: `${observabilityBasePath}/overview`,
            content: (
              <ObservabilityDashboard
                routeBasePath={observabilityBasePath}
                showHumanReview
              />
            ),
          },
        ]
      : [];
  const settingsTabs = [...agentSettingsTabs, ...observabilityTabs];
  useSetPageTitle(t("settings.title"));
  const { prefs, loading: prefsLoading, save: savePrefs } = useSlidesPrefs();
  const labs = useMemo(
    () => [
      ...SLIDES_LABS.map((lab) => ({
        ...lab,
        displayName: t("deckEditor.layoutOverflowWarning"),
        description: t("settings.labLayoutOverflowWarningDescription"),
      })),
      {
        ...CREATIVE_CONTEXT_LIBRARY_LAB,
        displayName: t("creativeContext.share.title"),
        description: t("creativeContext.description"),
      },
    ],
    [t],
  );

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "slides-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "slides-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notifications comments replies alerts",
        hash: "notifications",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel={t("navigation.team")}
      extraTabs={settingsTabs}
      labs={labs}
      labsIntro={t("settings.labsIntro")}
      labsLabel={t("settings.labs")}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          {creativeContextEnabled ? <CreativeContextSettingsLink /> : null}

          <SettingsGroup>
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              description={t("settings.languageDescription")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
            <SettingsRow
              id="notifications"
              label={t("settings.emailNotifications")}
              description={t("settings.emailNotificationsDescription")}
              control={
                <Switch
                  aria-label={t("settings.emailNotifications")}
                  checked={prefs.emailNotifications !== false}
                  disabled={prefsLoading}
                  onCheckedChange={(checked) => {
                    savePrefs({ emailNotifications: checked }).catch((err) => {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : t("settings.saveFailed"),
                      );
                    });
                  }}
                />
              }
            />
          </SettingsGroup>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription={t("raw.teamDescription")}
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
