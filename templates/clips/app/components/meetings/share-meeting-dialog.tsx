import { appPath } from "@agent-native/core/client/api-path";
import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  CopyButton,
  GeneralAccessSelect,
  InvitePeopleField,
  PeopleAccessSection,
  ShareSectionLabel,
  nestedLayerDismissGuards,
  useResourceVisibilityMutation,
  type SharesQuery,
  type SharesResponse,
  type Visibility,
} from "@/components/sharing/share-ui";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export interface ShareMeetingPopoverProps {
  meetingId: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
  children: ReactNode;
}

export function ShareMeetingPopover({
  meetingId,
  shareTranscript,
  transcriptReady,
  children,
}: ShareMeetingPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        {...nestedLayerDismissGuards()}
        className="max-h-[calc(100vh-1rem)] w-[440px] max-w-[calc(100vw-1rem)] overflow-y-auto border-border p-0"
      >
        <ShareMeetingContent
          meetingId={meetingId}
          shareTranscript={shareTranscript}
          transcriptReady={transcriptReady}
        />
      </PopoverContent>
    </Popover>
  );
}

function ShareMeetingContent({
  meetingId,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
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
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "meeting",
    meetingId,
    sharesQuery,
  );
  const visibilityPending = isPending || sharesQuery.isLoading;

  return (
    <div className="min-w-0 px-4 py-3">
      <LinkTab
        meetingId={meetingId}
        shareUrl={shareUrl}
        sharesQuery={sharesQuery}
        canManage={canManage}
        visibility={visibility}
        visibilityPending={visibilityPending}
        onVisibilityChange={setResourceVisibility}
        shareTranscript={shareTranscript}
        transcriptReady={transcriptReady}
      />
    </div>
  );
}

function LinkTab({
  meetingId,
  shareUrl,
  sharesQuery,
  canManage,
  visibility,
  visibilityPending,
  onVisibilityChange,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  visibility: Visibility;
  visibilityPending: boolean;
  onVisibilityChange: (
    next: Visibility,
    options?: { onSuccess?: () => void },
  ) => void;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
  const t = useT();
  const updateMeeting = useActionMutation<
    unknown,
    { id: string; shareTranscript: boolean }
  >("update-meeting");
  const [includeTranscript, setIncludeTranscript] = useState(shareTranscript);
  const data = sharesQuery.data;
  const isPublic = visibility === "public";
  const sharesLoaded = data?.visibility != null;
  const createAgentLink = useActionMutation("create-agent-resource-link");
  const createAgentLinkAsyncRef = useRef(createAgentLink.mutateAsync);
  const agentLinkRequestIdRef = useRef(0);
  const [agentLink, setAgentLink] = useState("");
  const [agentLinkError, setAgentLinkError] = useState(false);

  useEffect(() => {
    createAgentLinkAsyncRef.current = createAgentLink.mutateAsync;
  });

  const loadAgentLink = useCallback(async () => {
    const requestId = agentLinkRequestIdRef.current + 1;
    agentLinkRequestIdRef.current = requestId;
    setAgentLink("");
    setAgentLinkError(false);

    try {
      const result = (await createAgentLinkAsyncRef.current({
        resourceType: "meeting",
        resourceId: meetingId,
      })) as { contextUrl?: string };
      if (agentLinkRequestIdRef.current !== requestId) return;
      if (result?.contextUrl) setAgentLink(result.contextUrl);
      else setAgentLinkError(true);
    } catch {
      if (agentLinkRequestIdRef.current === requestId) setAgentLinkError(true);
    }
  }, [meetingId]);

  useEffect(() => {
    setAgentLink("");
    setAgentLinkError(false);
    if (!sharesLoaded || isPublic) return;
    void loadAgentLink();

    return () => {
      agentLinkRequestIdRef.current += 1;
    };
  }, [isPublic, loadAgentLink, meetingId, sharesLoaded, visibility]);

  const agentShareDisabled =
    sharesQuery.isLoading ||
    !sharesLoaded ||
    (!isPublic && (createAgentLink.isPending || !agentLink));
  const visibleAgentLink = isPublic ? shareUrl : agentLink;

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
    <div className="space-y-3">
      {canManage ? (
        <InvitePeopleField
          resourceType="meeting"
          resourceId={meetingId}
          sharesQuery={sharesQuery}
          onError={(err) =>
            toast.error(
              err instanceof Error
                ? err.message
                : t("clipsFinalRaw.inviteFailed"),
            )
          }
        />
      ) : null}

      <div className="space-y-2">
        <ShareSectionLabel>{t("shareUi.whoHasAccess")}</ShareSectionLabel>
        <div className="flex flex-col gap-1">
          <PeopleAccessSection
            resourceType="meeting"
            resourceId={meetingId}
            sharesQuery={sharesQuery}
            canManage={canManage}
            onError={(err, action) =>
              toast.error(
                err instanceof Error
                  ? err.message
                  : action === "permission"
                    ? t("clipsFinalRaw.permissionUpdateFailed")
                    : t("clipsFinalRaw.removePersonFailed"),
              )
            }
          />
          <GeneralAccessSelect
            visibility={visibility}
            canManage={canManage}
            isPending={visibilityPending}
            onChange={onVisibilityChange}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
        <div className="min-w-0">
          <label
            htmlFor={`meeting-share-transcript-${meetingId}`}
            className="text-sm font-medium"
          >
            {t("shareMeeting.includeTranscript")}
          </label>
          <p
            id={`meeting-share-transcript-description-${meetingId}`}
            className="sr-only"
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
          disabled={!canManage || !transcriptReady || updateMeeting.isPending}
          aria-describedby={`meeting-share-transcript-description-${meetingId}`}
          className="shrink-0"
        />
      </div>

      <CopyButton value={shareUrl} disabled={!sharesLoaded}>
        {t("shareUi.copyLink")}
      </CopyButton>

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t("shareDialog.shareWithAgents")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("shareMeeting.agentLinkDescription")}
          </p>
        </div>
        {agentLinkError ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void loadAgentLink()}
            disabled={createAgentLink.isPending}
          >
            {t("shareDialog.retryAgentLink")}
          </Button>
        ) : (
          <CopyButton
            value={visibleAgentLink}
            disabled={agentShareDisabled}
            className="shrink-0"
          >
            {t("shareUi.copy")}
          </CopyButton>
        )}
      </div>
    </div>
  );
}
