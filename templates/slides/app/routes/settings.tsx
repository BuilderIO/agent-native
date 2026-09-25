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
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  CreativeContextSettingsLink,
  createCreativeContextAgentTab,
  useCreativeContextLab,
  type CreativeContextAgentTabFactory,
} from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { SLIDES_LABS } from "@shared/labs";
import { useMemo } from "react";

import {
  COMMENT_EMAILS_ROW_ID,
  LegacyEmailNotificationsRow,
  NotificationSettings,
} from "@/components/settings/notification-settings";
import { useSettingsRedesign } from "@/hooks/use-settings-redesign";
import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.raw.routeSettingsTitle }];
}

// The redesigned Settings gives the library its own page and header.
const createCreativeContextSettingsTab: CreativeContextAgentTabFactory = (
  context,
) => createCreativeContextAgentTab({ ...context, variant: "settings" });

export default function SettingsRoute() {
  const t = useT();
  const redesign = useSettingsRedesign().enabled;
  const creativeContextEnabled = useCreativeContextLab();
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories: creativeContextEnabled
      ? [
          redesign
            ? createCreativeContextSettingsTab
            : createCreativeContextAgentTab,
        ]
      : [],
  });
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

  // With the flag on, language lives on Account › Preferences, comment emails
  // on the Notifications page, and the library on its own page, so Slides
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
              <LegacyEmailNotificationsRow />
            </SettingsGroup>
          </div>
        ),
      };

  return (
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
  );
}
