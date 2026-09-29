import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import {
  CreativeContextSettingsLink,
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
  LegacyEmailNotificationsRow,
  NotificationSettings,
} from "@/components/settings/notification-settings";
import { useCreativeContextLab } from "@/hooks/use-creative-context-lab";
import { useSettingsRedesign } from "@/hooks/use-settings-redesign";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

// The redesigned Settings gives the library its own page and header. The
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
  const redesign = useSettingsRedesign().enabled;
  const creativeContextEnabled = useCreativeContextLab();
  const agentAdditionalTabFactories = useMemo(
    () =>
      creativeContextEnabled
        ? [
            redesign
              ? createCreativeContextSettingsTab
              : createCreativeContextAgentTab,
          ]
        : [],
    [creativeContextEnabled, redesign],
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

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "content-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "content-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notifications comments replies mentions alerts",
        hash: "notifications",
      },
    ],
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

  // With the flag on, language lives on Account › Preferences, comment emails
  // on the Notifications page, and the library on its own page, so Content
  // adds no groups to its General page. With it off, today's General tab
  // stays as it was.
  const appSettings = redesign
    ? {
        notifications: <NotificationSettings />,
        notificationsSearchEntries,
      }
    : {
        generalSearchEntries,
        general: (
          <main className="mx-auto w-full max-w-2xl space-y-6">
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
              <LegacyEmailNotificationsRow />
            </SettingsGroup>
          </main>
        ),
      };

  return (
    <div className="flex-1 overflow-auto">
      <SettingsTabsPage
        {...appSettings}
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
