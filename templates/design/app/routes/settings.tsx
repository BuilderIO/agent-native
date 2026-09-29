import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { useOrg } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
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

const OBSERVABILITY_KEYWORDS =
  "observability traces conversations evals experiments feedback review";

export function meta() {
  return [{ title: enUSMessages.routeTitles.settingsDesign }];
}

export default function SettingsRoute() {
  const t = useT();
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
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
  const canViewObservability =
    !orgLoading &&
    !orgError &&
    Boolean(activeOrg?.orgId) &&
    (activeOrg?.role === "owner" || activeOrg?.role === "admin");
  const observabilityBasePath = buildSettingsRoute("observability");
  // Today's tabs link the nav item to the dashboard's first tab. In the
  // redesigned Settings it is a Design page at that same path, so its nav
  // item must not carry `href`: that renders it as a link out of Settings.
  const observabilityTabs: SettingsTabItem[] = canViewObservability
    ? [
        {
          id: "observability",
          label: t("routeTitles.agentObservability"),
          icon: IconActivity,
          group: "agent",
          keywords: OBSERVABILITY_KEYWORDS,
          href: redesign ? undefined : `${observabilityBasePath}/overview`,
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

  const whatsNew = (
    <div className="mx-auto w-full max-w-2xl">
      <ChangelogSettingsCard markdown={changelog} />
    </div>
  );

  if (redesign) {
    // Language is on Account › Preferences, and the creative-context library
    // is its own page in the Design group while its lab is on.
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <SettingsTabsPage
          account={<AccountSettingsCard />}
          extraTabs={settingsTabs}
          labs={labs}
          mcpAbout={t("settings.mcpAbout")}
          whatsNew={whatsNew}
        />
      </div>
    );
  }

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
        whatsNew={whatsNew}
      />
    </div>
  );
}
