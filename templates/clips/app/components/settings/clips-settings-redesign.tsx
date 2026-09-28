import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import {
  SettingsGroup,
  type SettingsAppArea,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { CLIPS_MEETINGS } from "@shared/labs";
import { useMemo } from "react";

import { ClipsMeetingsArea } from "./meetings-area";
import { NotificationSettings } from "./notification-settings";
import { ClipsRecordingsArea } from "./recordings-area";
import { ClipsSharingGroup } from "./sharing-group";
import {
  UploadWorkspaceRow,
  useHasUploadWorkspaces,
} from "./upload-workspace-row";
import { useCanManageClipsWorkspace } from "./use-clips-organization";

/** Clips' own groups on its General page, between core's Agent and This browser. */
function ClipsGeneralGroups() {
  const t = useT();
  const hasWorkspaces = useHasUploadWorkspaces();
  return (
    <>
      <ClipsSharingGroup />
      {hasWorkspaces ? (
        <SettingsGroup id="uploads" title={t("settings.uploadWorkspaceTitle")}>
          <UploadWorkspaceRow
            description={t("settings.uploadWorkspaceDescription")}
          />
        </SettingsGroup>
      ) : null}
    </>
  );
}

/**
 * What Clips passes the redesigned Settings shell: General's groups, the
 * Recordings and Meetings tabs, and the Notifications page. Storage lives in
 * Organization › Infrastructure, AI keys in Agent › Model, and Slack link
 * previews in Channels › Slack.
 */
export function useClipsSettingsRedesign() {
  const t = useT();
  const canManage = useCanManageClipsWorkspace();
  const meetingsLab = useLab(CLIPS_MEETINGS);

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "clips-logo",
        label: t("brandingEditor.logo"),
        keywords: "sharing branding logo share email public page",
        hash: "logo",
      },
      {
        id: "clips-brand-color",
        label: t("brandingEditor.brandColor"),
        keywords: "sharing branding brand color colour",
        hash: "brand-color",
      },
      {
        id: "clips-upload-workspace",
        label: t("settings.uploadWorkspaceTitle"),
        keywords:
          "upload recordings desktop destination organization workspace",
        hash: "upload-workspace",
      },
    ],
    [t],
  );

  const appAreas = useMemo<SettingsAppArea[]>(
    () => [
      {
        id: "recordings",
        label: t("clipsSettings.recordingsTab"),
        keywords: "recordings defaults playback visibility transcript",
        content: <ClipsRecordingsArea canManage={canManage} />,
        searchEntries: [
          {
            id: "clips-playback",
            label: t("clipsSettings.playbackSpeed"),
            keywords: "default playback speed video",
            hash: "playback",
          },
          {
            id: "clips-visibility",
            label: t("clipsSettings.visibility"),
            keywords: "default visibility sharing private public organization",
            hash: "visibility",
          },
          ...(canManage
            ? [
                {
                  id: "clips-organization-visibility",
                  label: t("brandingEditor.defaultVisibility"),
                  keywords: "organization default visibility",
                  hash: "organization-visibility",
                },
                {
                  id: "clips-transcript-export",
                  label: t("clipsSettings.transcriptExport"),
                  keywords: "brain ingest url token transcript export",
                  hash: "transcript-export",
                },
              ]
            : []),
        ],
      },
      {
        id: "meetings",
        label: t("clipsSettings.meetingsTab"),
        visible: meetingsLab,
        keywords: "meetings google calendar desktop capture",
        content: <ClipsMeetingsArea canManage={canManage} />,
        searchEntries: [
          {
            id: "clips-google-calendar",
            label: t("clipsSettings.googleCalendar"),
            keywords: "google calendar connect meetings",
            hash: "google-calendar",
          },
          {
            id: "clips-meeting-capture",
            label: t("clipsSettings.meetingCapture"),
            keywords: "meeting capture notes auto-start desktop",
            hash: "meeting-capture",
          },
          ...(canManage
            ? [
                {
                  id: "clips-calendar-app",
                  label: t("clipsSettings.calendarApp"),
                  keywords: "google client id secret oauth calendar keys",
                  hash: "calendar-app",
                },
              ]
            : []),
        ],
      },
    ],
    [canManage, meetingsLab, t],
  );

  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "clips-email-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notifications views comments reactions monthly recap",
        hash: "all-email-notifications",
      },
    ],
    [t],
  );

  return {
    generalGroups: <ClipsGeneralGroups />,
    generalSearchEntries,
    appAreas,
    notifications: (
      <NotificationSettings title={t("clipsSettings.emailGroup")} />
    ),
    notificationsSearchEntries,
  };
}
