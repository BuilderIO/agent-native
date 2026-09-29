import { ChangelogSettingsCard } from "@agent-native/toolkit/app/changelog";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { ObservabilityDashboard } from "@agent-native/toolkit/app/observability";
import { useOrg } from "@agent-native/core/client/org";
import { AccountSettingsCard, SettingsTabsPage, useAgentSettingsTabs, type SettingsTabItem } from "@agent-native/toolkit/app/settings";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
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
  // Observability is a Design page at its Settings path, so its nav item must
  // not carry `href`: that renders it as a link out of Settings.
  const observabilityTabs: SettingsTabItem[] = canViewObservability
    ? [
        {
          id: "observability",
          label: t("routeTitles.agentObservability"),
          icon: IconActivity,
          group: "agent",
          keywords: OBSERVABILITY_KEYWORDS,
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

  // Language is on Account › Preferences, and the creative-context library is
  // its own page in the Design group while its lab is on.
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        extraTabs={settingsTabs}
        labs={labs}
        mcpAbout={t("settings.mcpAbout")}
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}
