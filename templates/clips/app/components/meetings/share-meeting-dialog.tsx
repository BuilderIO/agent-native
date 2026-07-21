import { appPath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconLink, IconMail } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  CopyField,
  GeneralAccessSelect,
  MakePublicCard,
  ShareCardHeader,
  SharePeopleTab,
  copyToClipboard,
  useResourceVisibilityMutation,
  type SharesQuery,
  type SharesResponse,
  type Visibility,
} from "@/components/sharing/share-ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ShareMeetingPopoverProps {
  meetingId: string;
  meetingTitle?: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
  children: ReactNode;
}

export function ShareMeetingPopover({
  meetingId,
  meetingTitle,
  shareTranscript,
  transcriptReady,
  children,
}: ShareMeetingPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[calc(100vh-1rem)] w-[440px] max-w-[calc(100vw-1rem)] overflow-y-auto border-border p-0"
      >
        <ShareMeetingContent
          meetingId={meetingId}
          meetingTitle={meetingTitle}
          shareTranscript={shareTranscript}
          transcriptReady={transcriptReady}
        />
      </PopoverContent>
    </Popover>
  );
}

function ShareMeetingContent({
  meetingId,
  meetingTitle,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  meetingTitle?: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
  const t = useT();
  const shareUrl = useMemo(
    () => `${window.location.origin}${appPath(`/share/meeting/${meetingId}`)}`,
    [meetingId],
  );

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "meeting",
    resourceId: meetingId,
  });

  const data = sharesQuery.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const titleText = meetingTitle
    ? t("clipsFinalRaw.shareNamedMeeting", { title: meetingTitle })
    : t("clipsFinalRaw.shareMeeting");

  return (
    <>
      <ShareCardHeader title={titleText} ownerEmail={data?.ownerEmail} />

      <Tabs defaultValue="link" className="min-w-0 px-4 py-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="link" className="gap-1.5">
            <IconLink size={14} />
            {t("clipsFinalRaw.link")}
          </TabsTrigger>
          <TabsTrigger value="invite" className="gap-1.5">
            <IconMail size={14} />
            {t("clipsFinalRaw.invite")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="mt-3">
          <LinkTab
            meetingId={meetingId}
            shareUrl={shareUrl}
            sharesQuery={sharesQuery}
            canManage={canManage}
            shareTranscript={shareTranscript}
            transcriptReady={transcriptReady}
          />
        </TabsContent>

        <TabsContent value="invite" className="mt-3">
          <SharePeopleTab
            resourceType="meeting"
            resourceId={meetingId}
            sharesQuery={sharesQuery}
            canManage={canManage}
            onError={(err, action) =>
              toast.error(
                err instanceof Error
                  ? err.message
                  : action === "invite"
                    ? t("clipsFinalRaw.inviteFailed")
                    : t("clipsFinalRaw.removePersonFailed"),
              )
            }
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LinkTab({
  meetingId,
  shareUrl,
  sharesQuery,
  canManage,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
  const t = useT();
  const updateMeeting = useActionMutation<
    unknown,
    { id: string; shareTranscript: boolean }
  >("update-meeting");
  const [includeTranscript, setIncludeTranscript] = useState(shareTranscript);
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "meeting",
    meetingId,
    sharesQuery,
  );
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const isPublic = visibility === "public";

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
    <div className="space-y-4">
      <GeneralAccessSelect
        visibility={visibility}
        canManage={canManage}
        isPending={isPending}
        onChange={(next) => setResourceVisibility(next)}
      />

      <div>
        <div className="mb-2 text-xs font-semibold">
          {t("shareMeeting.sharedContent")}
        </div>
        <div className="rounded-md border border-border">
          <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
            <span
              aria-hidden
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <IconCheck size={12} strokeWidth={2.5} />
            </span>
            <span className="text-sm">{t("shareMeeting.summaryIncluded")}</span>
          </div>
          <div className="flex items-start justify-between gap-4 px-3 py-2.5">
            <div className="min-w-0">
              <label
                htmlFor={`meeting-share-transcript-${meetingId}`}
                className="text-sm font-medium"
              >
                {t("shareMeeting.includeTranscript")}
              </label>
              <p
                id={`meeting-share-transcript-description-${meetingId}`}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                {transcriptReady
                  ? t("shareMeeting.includeTranscriptDescription")
                  : t("shareMeeting.transcriptUnavailable")}
              </p>
            </div>
            <Switch
              id={`meeting-share-transcript-${meetingId}`}
              checked={includeTranscript}
              onCheckedChange={handleTranscriptSharingChange}
              disabled={
                !canManage || !transcriptReady || updateMeeting.isPending
              }
              aria-describedby={`meeting-share-transcript-description-${meetingId}`}
              className="mt-0.5 shrink-0"
            />
          </div>
        </div>
      </div>

      <CopyField label={t("clipsFinalRaw.shareLink")} value={shareUrl} />

      {!isPublic && canManage ? (
        <MakePublicCard
          isPending={isPending}
          onMakePublic={() =>
            setResourceVisibility("public", {
              onSuccess: () => copyToClipboard(shareUrl),
            })
          }
        />
      ) : null}
    </div>
  );
}
