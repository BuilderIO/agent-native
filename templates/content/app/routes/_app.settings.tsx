import { ChangelogSettingsCard } from "@agent-native/toolkit/app/changelog";
import { useT } from "@agent-native/core/client/i18n";
import { AccountSettingsCard, SettingsTabsPage, useAgentSettingsTabs, type SettingsSearchEntry } from "@agent-native/toolkit/app/settings";
import {
  createCreativeContextAgentTab,
  type CreativeContextAgentTabFactory,
} from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  CONTENT_CREATIVE_CONTEXT,
  CONTENT_LABS,
  CONTENT_SLASH_ADVANCED_CODE,
  CONTENT_SLASH_DEVELOPER_DOCS,
  CONTENT_SLASH_LAYOUTS,
  CONTENT_SLASH_VISUALS,
} from "@shared/labs";
import { useMemo } from "react";

import {
  COMMENT_EMAILS_ROW_ID,
  NotificationSettings,
} from "@/components/settings/notification-settings";
import { useCreativeContextLab } from "@/hooks/use-creative-context-lab";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

// Settings gives the library its own page and header. The
// context is widened first so this compiles before and after the package
// accepts `variant`.
const createCreativeContextSettingsTab: CreativeContextAgentTabFactory = (
  context,
) => {
  const settingsContext = { ...context, variant: "settings" as const };
  return createCreativeContextAgentTab(settingsContext);
};

export default function SettingsRoute() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextLab();
  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextSettingsTab] : []),
    [creativeContextEnabled],
  );
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories,
  });
  useSetPageTitle(t("settings.title"));

  const labs = useMemo(
    () =>
      CONTENT_LABS.map((lab) => ({
        ...lab,
        ...(lab.key === CONTENT_CREATIVE_CONTEXT.key
          ? {
              displayName: t("settings.labCreativeContext"),
              description: t("settings.labCreativeContextDescription"),
            }
          : lab.key === CONTENT_SLASH_ADVANCED_CODE.key
            ? {
                displayName: t("settings.labSlashAdvancedCode"),
                description: t("settings.labSlashAdvancedCodeDescription"),
              }
            : lab.key === CONTENT_SLASH_LAYOUTS.key
              ? {
                  displayName: t("settings.labSlashLayouts"),
                  description: t("settings.labSlashLayoutsDescription"),
                }
              : lab.key === CONTENT_SLASH_VISUALS.key
                ? {
                    displayName: t("settings.labSlashVisuals"),
                    description: t("settings.labSlashVisualsDescription"),
                  }
                : lab.key === CONTENT_SLASH_DEVELOPER_DOCS.key
                  ? {
                      displayName: t("settings.labSlashDeveloperDocs"),
                      description: t(
                        "settings.labSlashDeveloperDocsDescription",
                      ),
                    }
                  : {}),
      })),
    [t],
  );

  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "content-comment-emails",
        label: t("settings.commentsRepliesMentions"),
        keywords: "email notifications document comments replies mentions",
        hash: COMMENT_EMAILS_ROW_ID,
      },
    ],
    [t],
  );

  // Language lives on Account › Preferences, comment emails on the
  // Notifications page, and the library on its own page, so Content adds no
  // groups to its General page.
  return (
    <div className="flex-1 overflow-auto">
      <SettingsTabsPage
        notifications={<NotificationSettings />}
        notificationsSearchEntries={notificationsSearchEntries}
        account={<AccountSettingsCard />}
        extraTabs={agentSettingsTabs}
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
    </div>
  );
}
