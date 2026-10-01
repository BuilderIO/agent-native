import { useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/toolkit/app/settings";
import { CLIPS_LABS } from "@shared/labs";
import { useMemo } from "react";

import { useClipsSettingsRedesign } from "@/components/settings/clips-settings-redesign";
import "@/components/settings/slack-channel-extension";
import enMessages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: enMessages.settings.pageTitle }];
}

export default function SettingsIndexRoute() {
  const t = useT();
  const redesigned = useClipsSettingsRedesign();
  const labs = useMemo(
    () =>
      CLIPS_LABS.map((lab) => {
        if (lab.key === "clips.resilient-recording") {
          return {
            ...lab,
            displayName: t("settings.labResilientRecording"),
            description: t("settings.labResilientRecordingDescription"),
            inheritedMixedDescription: t(
              "settings.labResilientRecordingMixedDescription",
            ),
          };
        }
        if (lab.key === "clips.video-editing") {
          return {
            ...lab,
            displayName: t("settings.labVideoEditing"),
            description: t("settings.labVideoEditingDescription"),
          };
        }
        if (lab.key === "clips.meetings") {
          return {
            ...lab,
            displayName: t("settings.labMeetings"),
            description: t("settings.labMeetingsDescription"),
          };
        }
        return {
          ...lab,
          displayName: t("settings.labWisprFlow"),
          description: t("settings.labWisprFlowDescription"),
        };
      }),
    [t],
  );
  const agentSettingsTabs = useAgentSettingsTabs();
  const whatsNewMarkdown = useMemo(
    () =>
      changelog
        .split(
          "The no-comments sidebar gives viewers a concise reason to try Clips and a clear path to sign up.",
        )
        .join(t("settings.changelogCommentSignup"))
        .split(
          "The empty comments state now explains how screen recordings help AI agents.",
        )
        .join(t("settings.changelogCommentsEmptyState"))
        .split(
          'Signed-in viewers who hit an unavailable, expired, or private share link now land in their library instead of the public marketing page when they choose "Go home."',
        )
        .join(t("settings.changelogShareLink")),
    [t],
  );
  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      labs={labs}
      labsIntro={t("settings.labsIntro")}
      labsLabel={t("settings.labs")}
      whatsNewLabel={t("settings.whatsNew")}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={redesigned.generalSearchEntries}
      generalGroups={redesigned.generalGroups}
      appAreas={redesigned.appAreas}
      notifications={redesigned.notifications}
      notificationsSearchEntries={redesigned.notificationsSearchEntries}
      whatsNewMarkdown={whatsNewMarkdown}
    />
  );
}
