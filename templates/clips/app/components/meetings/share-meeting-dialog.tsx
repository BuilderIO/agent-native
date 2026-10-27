import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useShareButtonController,
  type ShareButtonController,
} from "@agent-native/core/client/sharing/useShareButtonController";
import {
  ShareGeneralAccessRow,
  SharePeopleInvite,
  SharePeopleList,
} from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  JoinedShareControl,
  ShareModeTabs,
} from "@agent-native/toolkit/sharing";
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
  ShareAdvancedPopover,
  ShareSectionLabel,
  nestedLayerDismissGuards,
} from "@/components/sharing/share-ui";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const t = useT();
  const shareUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}${appPath(`/share/meeting/${meetingId}`)}`,
    [meetingId],
  );

  const copyShareLink = async () => {
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
  };

  return (
    <Popover>
      <PopoverAnchor asChild>
        <JoinedShareControl
          className="clips-share-control"
          trigger={<PopoverTrigger asChild>{children}</PopoverTrigger>}
          copyLabel={t("recordRoute.copyLinkAction")}
          copiedLabel={t("recordRoute.linkCopied")}
          disabled={!shareUrl}
          onCopy={copyShareLink}
        />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        {...nestedLayerDismissGuards()}
        className="max-h-[calc(100vh-1rem)] w-[360px] max-w-[calc(100vw-1rem)] overflow-y-auto border-border p-0"
      >
        <ShareMeetingContent
          meetingId={meetingId}
          shareUrl={shareUrl}
          shareTranscript={shareTranscript}
          transcriptReady={transcriptReady}
        />
      </PopoverContent>
    </Popover>
  );
}

function ShareMeetingContent({
  meetingId,
  shareUrl,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  shareUrl: string;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
  const t = useT();
  const [tab, setTab] = useState<"people" | "agents">("people");
  const controller = useShareButtonController({
    resourceType: "meeting",
    resourceId: meetingId,
    defaultOpen: true,
  });

  useEffect(() => {
    setTab("people");
  }, [meetingId]);

  return (
    <div className="min-w-0 px-3 py-2">
      <ShareModeTabs
        value={tab}
        onValueChange={(value) => setTab(value as "people" | "agents")}
        peopleLabel={t("shareDialog.people")}
        agentsLabel={t("shareDialog.agents")}
        people={
          <PeopleTab
            meetingId={meetingId}
            controller={controller}
            shareTranscript={shareTranscript}
            transcriptReady={transcriptReady}
          />
        }
        agents={
          <AgentTab
            meetingId={meetingId}
            shareUrl={shareUrl}
            controller={controller}
          />
        }
      />
    </div>
  );
}

function PeopleTab({
  meetingId,
  controller,
  shareTranscript,
  transcriptReady,
}: {
  meetingId: string;
  controller: ShareButtonController;
  shareTranscript: boolean;
  transcriptReady: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <SharePeopleInvite controller={controller} />

      <div className="flex flex-col gap-1.5">
        <ShareSectionLabel>{t("shareUi.whoHasAccess")}</ShareSectionLabel>
        <div className="flex flex-col gap-0.5">
          <div className="max-h-72 overflow-y-auto">
            <SharePeopleList controller={controller} />
          </div>
          <ShareGeneralAccessRow controller={controller} sentenceTrigger>
            <TranscriptAccess
              meetingId={meetingId}
              shareTranscript={shareTranscript}
              transcriptReady={transcriptReady}
              canManage={controller.canManage}
            />
          </ShareGeneralAccessRow>
        </div>
      </div>
    </div>
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

function AgentTab({
  meetingId,
  shareUrl,
  controller,
}: {
  meetingId: string;
  shareUrl: string;
  controller: ShareButtonController;
}) {
  const t = useT();
  const { sharesQuery, data, visibility } = controller;
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

  if (agentLinkError) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full justify-start px-1.5 text-sm font-normal"
        onClick={() => void loadAgentLink()}
        disabled={createAgentLink.isPending}
      >
        {t("shareDialog.retryAgentLink")}
      </Button>
    );
  }

  return (
    <CopyButton
      value={visibleAgentLink}
      disabled={agentShareDisabled}
      variant="ghost"
      className="h-9 w-full justify-start px-1.5 text-sm font-normal"
      resourceType="meeting"
      resourceId={meetingId}
      linkType="agent_context"
    >
      {t("shareMeeting.copyAgentLink")}
    </CopyButton>
  );
}
