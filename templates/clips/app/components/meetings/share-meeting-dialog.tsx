import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ShareAdvancedPopover } from "@/components/sharing/share-ui";
import { Switch } from "@/components/ui/switch";

export interface ShareMeetingPopoverProps {
  meetingId: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
  children?: ReactNode;
}

export function ShareMeetingPopover({
  meetingId,
  shareTranscript,
  transcriptReady,
}: ShareMeetingPopoverProps) {
  const t = useT();
  const shareUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}${appPath(`/share/meeting/${meetingId}`)}`,
    [meetingId],
  );

  return (
    <ShareButton
      resourceType="meeting"
      resourceId={meetingId}
      shareUrl={shareUrl}
      agentShareLabel={t("shareMeeting.copyAgentLink")}
      quickCopy={{
        label: t("recordRoute.copyLinkAction"),
        copiedLabel: t("recordRoute.linkCopied"),
        className: "clips-share-control",
        onCopy: async () => {
          const copied = await writeClipboardText(shareUrl);
          if (!copied) return false;
          trackEvent("share_link_copied", {
            app_name: "clips",
            template_name: "clips",
            output_id: meetingId,
            resource_type: "meeting",
            resource_id: meetingId,
            link_type: "share",
          });
          return true;
        },
      }}
      generalAccessExtras={(controller) => (
        <TranscriptAccess
          meetingId={meetingId}
          shareTranscript={shareTranscript}
          transcriptReady={transcriptReady}
          canManage={controller.canManage}
        />
      )}
    />
  );
}

function TranscriptAccess({
  meetingId,
  shareTranscript,
  transcriptReady,
  canManage,
}: {
  meetingId: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
  canManage: boolean;
}) {
  const t = useT();
  const updateMeeting = useActionMutation<
    unknown,
    { id: string; shareTranscript: boolean }
  >("update-meeting");
  const [includeTranscript, setIncludeTranscript] = useState(shareTranscript);
  const switchId = `meeting-share-transcript-${meetingId}`;

  useEffect(() => {
    setIncludeTranscript(shareTranscript);
  }, [shareTranscript]);

  const handleTranscriptSharingChange = (next: boolean) => {
    const previous = includeTranscript;
    setIncludeTranscript(next);
    updateMeeting.mutate(
      { id: meetingId, shareTranscript: next },
      {
        onError: (error: unknown) => {
          setIncludeTranscript(previous);
          toast.error(
            error instanceof Error
              ? error.message
              : t("shareMeeting.updateTranscriptSharingFailed"),
          );
        },
      },
    );
  };

  return (
    <ShareAdvancedPopover
      disabled={!canManage}
      summary={
        includeTranscript
          ? t("shareMeeting.linkShowsTranscript")
          : t("shareMeeting.linkShowsNotesOnly")
      }
    >
      <div className="flex min-h-8 items-center gap-2">
        <label
          htmlFor={switchId}
          className="min-w-0 flex-1 cursor-pointer text-sm"
        >
          {t("shareMeeting.transcriptOnShareLink")}
        </label>
        <p id={`${switchId}-description`} className="sr-only">
          {transcriptReady
            ? t("shareMeeting.transcriptOnShareLinkDescription")
            : t("shareMeeting.transcriptUnavailable")}
        </p>
        <Switch
          id={switchId}
          checked={includeTranscript}
          onCheckedChange={handleTranscriptSharingChange}
          disabled={!canManage || !transcriptReady || updateMeeting.isPending}
          aria-describedby={`${switchId}-description`}
          className="shrink-0"
        />
      </div>
    </ShareAdvancedPopover>
  );
}
