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
import { DESIGN_LABS } from "@shared/labs";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";

import enUSMessages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: enUSMessages.routeTitles.settingsDesign }];
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
            label: t("routeTitles.agentObservability"),
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
  const labs = useMemo(
    () => [
      ...DESIGN_LABS.map((lab) => ({
        ...lab,
        displayName: t("settings.labTweaks"),
        description: t("settings.labTweaksDescription"),
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
        id: "design-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        extraTabs={settingsTabs}
        labs={labs}
        labsIntro={t("settings.labsIntro")}
        labsLabel={t("settings.labs")}
        generalSearchEntries={generalSearchEntries}
        general={
          <div className="mx-auto w-full max-w-2xl space-y-6">
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
            </SettingsGroup>
          </div>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("pages.teamCreateOrgDescription")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}
