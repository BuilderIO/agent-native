import {
  appPath,
  useActionMutation,
  useActionQuery,
  useSession,
  useT,
} from "@agent-native/core/client";
import {
  IconCode,
  IconChevronDown,
  IconExternalLink,
  IconLink,
  IconMail,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
import { SlackShareHint } from "@/components/sharing/slack-share-hint";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { isLoomEmbedUrl } from "../../../shared/loom";
import { withShareAttribution } from "../../../shared/share-attribution";

function absoluteAppUrl(path: string): string {
  if (typeof window === "undefined") return "";
  return new URL(appPath(path), window.location.origin).toString();
}

export interface ShareRecordingPopoverProps {
  recordingId: string;
  recordingTitle?: string;
  initialVisibility?: Visibility | null;
  initialRole?: "owner" | "admin" | "editor" | "viewer";
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
  hasPassword?: boolean;
  /** Trigger element rendered as the popover anchor (usually the Share button). */
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ShareRecordingDialogProps = Omit<
  ShareRecordingPopoverProps,
  "children"
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Clips share popover — anchored to a trigger button, contains Link /
 * Invite / Embed tabs with the same functionality as the framework share
 * dialog, plus Clips-specific extras (GIF preview + MP4 download) and a
 * recording-aware embed configurator (autoplay, start time, responsive /
 * fixed size).
 */
export function ShareRecordingPopover({
  recordingId,
  recordingTitle,
  initialVisibility,
  initialRole,
  videoUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  children,
  open,
  onOpenChange,
}: ShareRecordingPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Keep the layer class in app source so Tailwind emits it for Clips. */}
      <PopoverContent
        align="end"
        className="z-[260] w-[440px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
      >
        <ShareRecordingContent
          recordingId={recordingId}
          recordingTitle={recordingTitle}
          initialVisibility={initialVisibility}
          initialRole={initialRole}
          videoUrl={videoUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
          isLoomRecording={isLoomRecording}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Dialog shell for menu-driven Share actions. Radix popovers need a real
 * anchor; opening one from a dropdown item with an invisible trigger can
 * be dismissed by the same click/focus cycle that closes the menu.
 */
export function ShareRecordingDialog({
  recordingId,
  recordingTitle,
  initialVisibility,
  initialRole,
  videoUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  open,
  onOpenChange,
}: ShareRecordingDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden border-border p-0 sm:max-w-[440px]">
        <DialogTitle className="sr-only">
          {recordingTitle
            ? t("shareDialog.sharePlainTitle", { title: recordingTitle })
            : t("shareDialog.shareRecording")}
        </DialogTitle>
        <ShareRecordingContent
          recordingId={recordingId}
          recordingTitle={recordingTitle}
          initialVisibility={initialVisibility}
          initialRole={initialRole}
          videoUrl={videoUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
          isLoomRecording={isLoomRecording}
          reserveCloseButton
        />
      </DialogContent>
    </Dialog>
  );
}

function ShareRecordingContent({
  recordingId,
  recordingTitle,
  initialVisibility,
  initialRole,
  videoUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  reserveCloseButton = false,
}: {
  recordingId: string;
  recordingTitle?: string;
  initialVisibility?: Visibility | null;
  initialRole?: "owner" | "admin" | "editor" | "viewer";
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
  reserveCloseButton?: boolean;
}) {
  const t = useT();
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "recording",
    resourceId: recordingId,
  });

  const data = sharesQuery.data;
  const role = data?.role ?? initialRole;
  const canManage = role === "owner" || role === "admin";
  const visibility =
    (data?.visibility as Visibility | null | undefined) ??
    initialVisibility ??
    null;

  // Attribution `via` must be a stable non-PII id, never an email. The only
  // owner id available client-side is the *current* session's userId, which is
  // the clip owner only when the viewer is the owner. Anyone else (e.g. a
  // share-admin) gets an untagged `via` so we never attribute the link to the
  // wrong person or leak the owner's email.
  const { session } = useSession();
  const ownerViaId =
    data?.role === "owner" ? (session?.userId ?? undefined) : undefined;

  const shareUrl =
    typeof window === "undefined"
      ? ""
      : withShareAttribution(
          absoluteAppUrl(`/share/${recordingId}`),
          ownerViaId,
        );
  const titleText = recordingTitle
    ? t("shareDialog.shareTitle", { title: recordingTitle })
    : t("shareDialog.shareRecording");

  return (
    <>
      <ShareCardHeader
        title={titleText}
        ownerEmail={data?.ownerEmail}
        reserveCloseButton={reserveCloseButton}
      />

      <Tabs defaultValue="link" className="min-w-0 px-4 py-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="link" className="gap-1.5">
            <IconLink size={14} />
            {t("shareDialog.link")}
          </TabsTrigger>
          <TabsTrigger value="invite" className="gap-1.5">
            <IconMail size={14} />
            {t("shareDialog.invite")}
          </TabsTrigger>
          <TabsTrigger value="embed" className="gap-1.5">
            <IconCode size={14} />
            {t("shareDialog.embed")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="mt-3">
          <LinkTab
            recordingId={recordingId}
            shareUrl={shareUrl}
            sharesQuery={sharesQuery}
            visibility={visibility}
            canManage={canManage}
            videoUrl={videoUrl}
            animatedThumbnailUrl={animatedThumbnailUrl}
            isLoomRecording={isLoomRecording}
          />
        </TabsContent>

        <TabsContent value="invite" className="mt-3">
          <SharePeopleTab
            resourceType="recording"
            resourceId={recordingId}
            resourceUrl={absoluteAppUrl(`/r/${recordingId}`)}
            sharesQuery={sharesQuery}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="embed" className="mt-3">
          <ClipsEmbedConfigurator
            recordingId={recordingId}
            sharesQuery={sharesQuery}
            visibility={visibility}
            canManage={canManage}
            ownerViaId={ownerViaId}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// Link tab — visibility + copy link + Clips extras (GIF / MP4)
// ---------------------------------------------------------------------------

function LinkTab({
  recordingId,
  shareUrl,
  sharesQuery,
  visibility,
  canManage,
  videoUrl,
  animatedThumbnailUrl,
  isLoomRecording: isLoomRecordingProp,
}: {
  recordingId: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  visibility: Visibility | null;
  canManage: boolean;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
}) {
  const t = useT();
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "recording",
    recordingId,
    sharesQuery,
  );
  const isPublic = visibility === "public";
  const sharesLoaded = visibility !== null;
  const visibilityPending = isPending || sharesQuery.isLoading;
  const isLoomRecording = isLoomRecordingProp || isLoomEmbedUrl(videoUrl);
  const createAgentLink = useActionMutation(
    "create-recording-agent-link" as any,
  );
  const createAgentLinkAsyncRef = useRef(createAgentLink.mutateAsync);
  const agentLinkRequestIdRef = useRef(0);
  const [agentContextUrl, setAgentContextUrl] = useState("");
  const [agentLinkError, setAgentLinkError] = useState(false);
  const [agentShareOpen, setAgentShareOpen] = useState(false);

  useEffect(() => {
    createAgentLinkAsyncRef.current = createAgentLink.mutateAsync;
  });

  const loadAgentContextUrl = useCallback(async () => {
    const requestId = agentLinkRequestIdRef.current + 1;
    agentLinkRequestIdRef.current = requestId;

    setAgentContextUrl("");
    setAgentLinkError(false);

    try {
      const result = (await createAgentLinkAsyncRef.current({
        recordingId,
      })) as { url?: string };
      if (agentLinkRequestIdRef.current !== requestId) return;
      if (result?.url) {
        setAgentContextUrl(result.url);
      } else {
        setAgentLinkError(true);
      }
    } catch {
      if (agentLinkRequestIdRef.current === requestId) {
        setAgentLinkError(true);
      }
    }
  }, [recordingId]);

  useEffect(() => {
    setAgentContextUrl("");
    setAgentLinkError(false);
    if (!sharesLoaded) return;

    if (!isPublic && agentShareOpen) {
      void loadAgentContextUrl();
    }

    return () => {
      agentLinkRequestIdRef.current += 1;
    };
  }, [
    agentShareOpen,
    isPublic,
    loadAgentContextUrl,
    recordingId,
    sharesLoaded,
    visibility,
  ]);

  const agentShareDisabled =
    isPending || createAgentLink.isPending || !agentContextUrl;
  const agentPrompt = agentContextUrl
    ? t("shareDialog.agentPrompt", { agentContextUrl })
    : "";

  return (
    <div className="space-y-4">
      {visibility ? (
        <GeneralAccessSelect
          visibility={visibility}
          canManage={canManage}
          isPending={visibilityPending}
          onChange={(next) => setResourceVisibility(next)}
          publicDescription={t("shareDialog.publicDescription")}
        />
      ) : (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-12 w-full animate-pulse rounded bg-muted" />
        </div>
      )}

      <CopyField
        label={t("shareDialog.shareLink")}
        value={shareUrl}
        disabled={
          visibilityPending || !sharesLoaded || (!isPublic && canManage)
        }
      />

      {/* Public links unfurl into a playable video in Slack; surface that here
          (and a connect link) instead of leaving it buried in Settings. */}
      {isPublic ? <SlackShareHint canManage={canManage} /> : null}

      {sharesLoaded && !isPublic ? (
        <Collapsible open={agentShareOpen} onOpenChange={setAgentShareOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between px-0 py-1 text-left hover:bg-transparent"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">
                  {t("shareDialog.shareWithAgents")}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {t("shareDialog.agentTokenDescription")}
                </span>
              </span>
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  agentShareOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <CopyField
                label={t("shareDialog.shareWithAgents")}
                value={agentContextUrl}
                disabled={agentShareDisabled}
              />
              {agentLinkError ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {t("shareDialog.agentLinkUnavailable")}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => void loadAgentContextUrl()}
                    disabled={createAgentLink.isPending}
                  >
                    {t("shareDialog.retryAgentLink")}
                  </Button>
                </div>
              ) : null}
              <CopyField
                label={t("shareDialog.copyAgentPrompt")}
                value={agentPrompt}
                disabled={agentShareDisabled}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {sharesLoaded && !isPublic && canManage ? (
        <MakePublicCard
          isPending={isPending}
          onMakePublic={() =>
            setResourceVisibility("public", {
              onSuccess: () => copyToClipboard(shareUrl),
            })
          }
        />
      ) : null}

      {videoUrl || animatedThumbnailUrl ? (
        <div className="flex flex-wrap gap-2">
          {animatedThumbnailUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(animatedThumbnailUrl, "_blank")}
            >
              {t("shareDialog.gifPreview")}
            </Button>
          ) : null}
          {videoUrl ? (
            <Button
              variant="outline"
              size="sm"
              className={isLoomRecording ? "gap-1.5" : undefined}
              onClick={() =>
                window.open(videoUrl, "_blank", "noopener,noreferrer")
              }
            >
              {isLoomRecording ? (
                <>
                  <IconExternalLink className="h-4 w-4" />
                  {t("shareDialog.openPlayer")}
                </>
              ) : (
                t("recordRoute.downloadRecording")
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embed tab — Clips-specific configurator
// ---------------------------------------------------------------------------

function ClipsEmbedConfigurator({
  recordingId,
  sharesQuery,
  visibility,
  canManage,
  ownerViaId,
}: {
  recordingId: string;
  sharesQuery: SharesQuery;
  visibility: Visibility | null;
  canManage: boolean;
  ownerViaId?: string;
}) {
  const t = useT();
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);

  const isPublic = visibility === "public";
  const visibilityLabel = visibility
    ? t(`shareUi.visibility.${visibility}.label`)
    : "";
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "recording",
    recordingId,
    sharesQuery,
  );
  const makePublic = () => setResourceVisibility("public");

  const src = useMemo(() => {
    const params: string[] = [];
    if (autoplay) params.push("autoplay=1");
    if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    // Keep autoplay/t intact and also self-attribute the embed.
    return withShareAttribution(
      absoluteAppUrl(`/embed/${recordingId}${qs}`),
      ownerViaId,
    );
  }, [recordingId, autoplay, startMs, ownerViaId]);

  const code =
    mode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0;background:#000;overflow:hidden"><iframe src="${src}" title="${t("shareDialog.embedIframeTitle")}" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;overflow:hidden"></iframe></div>`
      : `<iframe src="${src}" title="${t("shareDialog.embedIframeTitle")}" width="${width}" height="${height}" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" style="display:block;max-width:100%;border:0;background:#000;overflow:hidden"></iframe>`;

  if (!visibility) {
    return (
      <div className="space-y-2" aria-hidden>
        <div className="h-16 w-full animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!isPublic ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs">
          <div className="font-medium text-foreground">
            {t("shareDialog.embedsNeedPublic")}
          </div>
          <p className="mt-0.5 text-muted-foreground">
            {t("shareDialog.embedPublicDescription", {
              visibility: visibilityLabel,
            })}
          </p>
          {canManage ? (
            <Button
              size="sm"
              className="mt-2 h-7"
              onClick={makePublic}
              disabled={isPending}
            >
              {isPending
                ? t("shareDialog.makingPublic")
                : t("shareDialog.makePublic")}
            </Button>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {t("shareDialog.askOwnerPublic")}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "responsive"}
            onChange={() => setMode("responsive")}
          />
          {t("shareDialog.responsive")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "fixed"}
            onChange={() => setMode("fixed")}
          />
          {t("shareDialog.fixedSize")}
        </label>
      </div>

      {mode === "fixed" ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">{t("shareDialog.width")}</Label>
            <Input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">{t("shareDialog.height")}</Label>
            <Input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 360)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("shareDialog.autoplay")}</Label>
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
      </div>

      <div>
        <Label className="text-xs">{t("shareDialog.startAt")}</Label>
        <Input
          type="number"
          min={0}
          value={Math.round(startMs / 1000)}
          onChange={(e) => setStartMs((parseInt(e.target.value) || 0) * 1000)}
        />
      </div>

      <div>
        <Label className="text-xs mb-1 block">
          {t("shareDialog.embedCode")}
        </Label>
        <textarea
          readOnly
          value={code}
          className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-none"
        />
      </div>
    </div>
  );
}
