import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { useOrg } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  createCreativeContextAgentTab,
  useCreativeContextLab,
  type CreativeContextAgentTabFactory,
} from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { SLIDES_LABS } from "@shared/labs";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";

import {
  COMMENT_EMAILS_ROW_ID,
  NotificationSettings,
} from "@/components/settings/notification-settings";
import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.raw.routeSettingsTitle }];
}

// Settings gives the library its own page and header.
const createCreativeContextSettingsTab: CreativeContextAgentTabFactory = (
  context,
) => createCreativeContextAgentTab({ ...context, variant: "settings" });

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
      ? [createCreativeContextSettingsTab]
      : [],
  });
  const observabilityBasePath = buildSettingsRoute("observability");
  // Observability is a Slides page at its Settings path, so its nav item must
  // not carry `href`: that renders it as a link out of Settings.
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

  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "slides-comment-emails",
        label: t("settings.commentsAndReplies"),
        keywords: "email notifications deck comments replies alerts",
        hash: COMMENT_EMAILS_ROW_ID,
      },
    ],
    [t],
  );

  // Language lives on Account › Preferences, comment emails on the
  // Notifications page, and the library on its own page, so Slides adds no
  // groups to its General page.
  return (
    <SettingsTabsPage
      notifications={<NotificationSettings />}
      notificationsSearchEntries={notificationsSearchEntries}
      account={<AccountSettingsCard />}
      extraTabs={settingsTabs}
      labs={labs}
      labsIntro={t("settings.labsIntro")}
      labsLabel={t("settings.labs")}
      mcpAbout={t("settings.mcpAbout")}
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
