import { appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconMail,
  IconPhoto,
} from "@tabler/icons-react";
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
  GeneralAccessRow,
  GeneralAccessSettingsBody,
  InvitePeopleField,
  MakePublicCard,
  PeopleAccessRow,
  PeopleAccessSettingsBody,
  ShareSectionLabel,
  ShareSettingsPanel,
  copyToClipboard,
  nestedLayerDismissGuards,
  useResourceVisibilityMutation,
  type ShareSettingsView,
  type SharesQuery,
  type SharesResponse,
  type Visibility,
} from "@/components/sharing/share-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatMs } from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

import { buildAgentApiUrls } from "../../../shared/agent-context";
import { buildEmailPreviewMarkup } from "../../../shared/email-preview";
import { isLoomEmbedUrl } from "../../../shared/loom";
import { withShareAttribution } from "../../../shared/share-attribution";
import { preferredThumbnailVariant } from "../../../shared/share-meta";

/** Compact pill tabs: active tab reads as a raised chip, inactive as plain text. */
const SHARE_TAB_CLASS =
  "h-7 rounded-md border border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors data-[state=active]:border-border data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none";

function absoluteAppUrl(path: string): string {
  if (typeof window === "undefined") return "";
  return new URL(appPath(path), window.location.origin).toString();
}

function absolutePublicAgentContextUrl(recordingId: string): string {
  if (typeof window === "undefined") return "";
  return buildAgentApiUrls(recordingId, {
    origin: window.location.origin,
    basePath: appPath("/").replace(/\/$/, ""),
  }).contextUrl;
}

export interface ShareRecordingPopoverProps {
  recordingId: string;
  recordingTitle?: string;
  initialVisibility?: Visibility | null;
  initialRole?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
  currentMs?: number;
  hasPassword?: boolean;
  /**
   * Restricts the dialog to a bare copy-link control for viewers who can
   * reshare a public/org clip's link but have no edit access: it skips
   * `list-resource-shares` (which returns every individually-shared
   * principal's email to any reader) and hides the Invite tab entirely.
   */
  viewerReshareOnly?: boolean;
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
  thumbnailUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  currentMs,
  hasPassword,
  viewerReshareOnly = false,
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
        {...nestedLayerDismissGuards()}
        className="z-[260] w-[440px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
      >
        <ShareRecordingContent
          recordingId={recordingId}
          recordingTitle={recordingTitle}
          initialVisibility={initialVisibility}
          initialRole={initialRole}
          videoUrl={videoUrl}
          thumbnailUrl={thumbnailUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
          isLoomRecording={isLoomRecording}
          currentMs={currentMs}
          hasPassword={hasPassword}
          viewerReshareOnly={viewerReshareOnly}
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
  thumbnailUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  currentMs,
  open,
  onOpenChange,
  hasPassword,
  viewerReshareOnly = false,
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
          thumbnailUrl={thumbnailUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
          isLoomRecording={isLoomRecording}
          currentMs={currentMs}
          hasPassword={hasPassword}
          viewerReshareOnly={viewerReshareOnly}
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
  thumbnailUrl,
  animatedThumbnailUrl,
  isLoomRecording = false,
  currentMs,
  reserveCloseButton = false,
  hasPassword,
  viewerReshareOnly = false,
}: {
  recordingId: string;
  recordingTitle?: string;
  initialVisibility?: Visibility | null;
  initialRole?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
  currentMs?: number;
  reserveCloseButton?: boolean;
  hasPassword?: boolean;
  viewerReshareOnly?: boolean;
}) {
  const t = useT();
  const sharesQuery = useActionQuery<SharesResponse>(
    "list-resource-shares",
    { resourceType: "recording", resourceId: recordingId },
    { enabled: !viewerReshareOnly },
  );

  const data = viewerReshareOnly ? undefined : sharesQuery.data;
  const role = data?.role ?? initialRole;
  const canManage = role === "owner" || role === "admin";
  // Editors could always see (read-only) who a clip is shared with; only
  // gate the Invite tab's mutation controls behind canManage. Commenters are
  // grouped with plain viewers here -- neither can manage shares.
  const canViewShares =
    role === "owner" || role === "admin" || role === "editor";
  const visibility =
    (data?.visibility as Visibility | null | undefined) ??
    initialVisibility ??
    null;
  // A plain viewer/commenter can't produce a working embed for a non-public
  // clip (they have no way to make it public), so don't dangle the tab in
  // front of them only to show an "ask the owner" dead end. Owner/admin/
  // editor keep it regardless of visibility since they can flip to public
  // from inside it.
  const canEmbed = canViewShares || visibility === "public";
  const tabCount = 1 + (canEmbed ? 1 : 0);

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

  const { setResourceVisibility, isPending: visibilityMutationPending } =
    useResourceVisibilityMutation("recording", recordingId, sharesQuery);
  const visibilityPending = visibilityMutationPending || sharesQuery.isLoading;
  const [settingsView, setSettingsView] = useState<ShareSettingsView>(null);
  const closeSettings = () => setSettingsView(null);

  return (
    <div className={cn("min-w-0 px-4 py-3", reserveCloseButton && "pe-12")}>
      {settingsView && visibility ? (
        <ShareSettingsPanel
          onBack={closeSettings}
          footer={
            <Button type="button" size="sm" onClick={closeSettings}>
              {t("shareUi.done")}
            </Button>
          }
        >
          {settingsView === "people" ? (
            <PeopleAccessSettingsBody
              resourceType="recording"
              resourceId={recordingId}
              sharesQuery={sharesQuery}
              canManage={canManage}
              roleCopy={{
                commenter: {
                  label: t("shareUi.recordingCommenter.label"),
                  description: t("shareUi.recordingCommenter.description"),
                },
              }}
            />
          ) : (
            <GeneralAccessSettingsBody
              visibility={visibility}
              canManage={canManage}
              isPending={visibilityPending}
              onChange={(next) => setResourceVisibility(next)}
            />
          )}
        </ShareSettingsPanel>
      ) : (
        <Tabs defaultValue="link">
          {tabCount > 1 ? (
            <TabsList className="inline-flex h-auto w-auto justify-start gap-1 rounded-none bg-transparent p-0">
              <TabsTrigger value="link" className={SHARE_TAB_CLASS}>
                {t("shareDialog.link")}
              </TabsTrigger>
              {canEmbed ? (
                <TabsTrigger value="embed" className={SHARE_TAB_CLASS}>
                  {t("shareDialog.embed")}
                </TabsTrigger>
              ) : null}
            </TabsList>
          ) : null}

          <TabsContent value="link" className="mt-3">
            <LinkTab
              recordingId={recordingId}
              recordingTitle={recordingTitle}
              shareUrl={shareUrl}
              sharesQuery={sharesQuery}
              visibility={visibility}
              visibilityPending={visibilityPending}
              onVisibilityChange={setResourceVisibility}
              canManage={canManage}
              videoUrl={videoUrl}
              thumbnailUrl={thumbnailUrl}
              animatedThumbnailUrl={animatedThumbnailUrl}
              isLoomRecording={isLoomRecording}
              currentMs={currentMs}
              hasPassword={hasPassword}
              canViewShares={canViewShares}
              onOpenPeopleSettings={() => setSettingsView("people")}
              onOpenAccessSettings={() => setSettingsView("access")}
            />
          </TabsContent>

          {canEmbed ? (
            <TabsContent value="embed" className="mt-3">
              <ClipsEmbedConfigurator
                recordingId={recordingId}
                sharesQuery={sharesQuery}
                visibility={visibility}
                canManage={canManage}
                ownerViaId={ownerViaId}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link tab — visibility + copy link + Clips extras (GIF / MP4)
// ---------------------------------------------------------------------------

function LinkTab({
  recordingId,
  recordingTitle,
  shareUrl,
  sharesQuery,
  visibility,
  visibilityPending,
  onVisibilityChange,
  canManage,
  videoUrl,
  thumbnailUrl,
  animatedThumbnailUrl,
  isLoomRecording: isLoomRecordingProp,
  currentMs = 0,
  hasPassword,
  canViewShares,
  onOpenPeopleSettings,
  onOpenAccessSettings,
}: {
  recordingId: string;
  recordingTitle?: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  visibility: Visibility | null;
  visibilityPending: boolean;
  onVisibilityChange: (
    next: Visibility,
    options?: { onSuccess?: () => void },
  ) => void;
  canManage: boolean;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  isLoomRecording?: boolean;
  currentMs?: number;
  hasPassword?: boolean;
  canViewShares: boolean;
  onOpenPeopleSettings: () => void;
  onOpenAccessSettings: () => void;
}) {
  const t = useT();
  const isPublic = visibility === "public";
  const sharesLoaded = visibility !== null;
  const timestampMs = Number.isFinite(currentMs)
    ? Math.max(0, Math.floor(currentMs! / 1000) * 1000)
    : 0;
  const [shareFromTimestamp, setShareFromTimestamp] = useState(false);
  const linkUrl = useMemo(() => {
    if (!shareFromTimestamp || timestampMs === 0) return shareUrl;
    const url = new URL(shareUrl);
    url.searchParams.set("at", String(timestampMs / 1000));
    return url.toString();
  }, [shareFromTimestamp, shareUrl, timestampMs]);
  const isLoomRecording = isLoomRecordingProp || isLoomEmbedUrl(videoUrl);
  const needsScopedAgentContext = !isPublic || hasPassword !== false;
  const publicAgentContextUrl = useMemo(
    () =>
      isPublic && hasPassword === false
        ? absolutePublicAgentContextUrl(recordingId)
        : "",
    [hasPassword, isPublic, recordingId],
  );
  const emailPreviewThumbnailUrl = useMemo(() => {
    if (!isPublic || hasPassword !== false || !sharesLoaded) return null;
    const variant = preferredThumbnailVariant({
      thumbnailUrl,
      animatedThumbnailUrl,
    });
    if (!variant) return null;

    const query = variant === "animated" ? "?animated=1" : "";
    return absoluteAppUrl(
      `/api/thumbnail/${encodeURIComponent(recordingId)}${query}`,
    );
  }, [
    animatedThumbnailUrl,
    hasPassword,
    isPublic,
    recordingId,
    sharesLoaded,
    thumbnailUrl,
  ]);
  const copyEmailPreview = useCallback(async () => {
    if (!emailPreviewThumbnailUrl || !shareUrl) return;

    try {
      const markup = buildEmailPreviewMarkup({
        title: recordingTitle?.trim() || t("recordingPage.untitledClip"),
        shareUrl,
        thumbnailUrl: emailPreviewThumbnailUrl,
      });
      const copied = await writeClipboardText(markup.plainText, {
        html: markup.html,
      });
      if (copied) {
        toast.success(t("shareDialog.emailPreviewCopied"));
      } else {
        toast.error(t("shareDialog.emailPreviewCopyFailed"));
      }
    } catch {
      toast.error(t("shareDialog.emailPreviewCopyFailed"));
    }
  }, [emailPreviewThumbnailUrl, recordingTitle, shareUrl, t]);
  const createAgentLink = useActionMutation(
    "create-recording-agent-link" as any,
  );
  const createAgentLinkAsyncRef = useRef(createAgentLink.mutateAsync);
  const agentLinkRequestIdRef = useRef(0);
  const [agentContextUrl, setAgentContextUrl] = useState("");
  const [agentLinkError, setAgentLinkError] = useState(false);

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
      })) as { contextUrl?: string };
      if (agentLinkRequestIdRef.current !== requestId) return;
      if (result?.contextUrl) {
        setAgentContextUrl(result.contextUrl);
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

    if (needsScopedAgentContext) {
      void loadAgentContextUrl();
    }

    return () => {
      agentLinkRequestIdRef.current += 1;
    };
  }, [
    loadAgentContextUrl,
    needsScopedAgentContext,
    recordingId,
    sharesLoaded,
    visibility,
  ]);

  const agentLink = isPublic
    ? publicAgentContextUrl || agentContextUrl
    : agentContextUrl;
  const agentShareDisabled =
    visibilityPending ||
    !sharesLoaded ||
    !agentLink ||
    (needsScopedAgentContext &&
      (createAgentLink.isPending || !agentContextUrl));
  const agentCopyValue = agentLink
    ? t("shareDialog.agentPrompt", { agentContextUrl: agentLink })
    : "";
  const showMakePublic = sharesLoaded && !isPublic && canManage;
  const moreMenuItems = [
    isLoomRecording && videoUrl
      ? {
          key: "open-player",
          label: t("shareDialog.openPlayer"),
          icon: IconExternalLink,
          onSelect: () =>
            window.open(videoUrl, "_blank", "noopener,noreferrer"),
        }
      : videoUrl
        ? {
            key: "download",
            label: t("recordRoute.downloadRecording"),
            icon: IconDownload,
            onSelect: () =>
              window.open(videoUrl, "_blank", "noopener,noreferrer"),
          }
        : null,
    animatedThumbnailUrl
      ? {
          key: "gif-preview",
          label: t("shareDialog.gifPreview"),
          icon: IconPhoto,
          onSelect: () => window.open(animatedThumbnailUrl, "_blank"),
        }
      : null,
    emailPreviewThumbnailUrl
      ? {
          key: "email-preview",
          label: t("shareDialog.copyEmailPreview"),
          icon: IconMail,
          onSelect: () => void copyEmailPreview(),
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="space-y-4">
      <InvitePeopleField
        resourceType="recording"
        resourceId={recordingId}
        resourceUrl={absoluteAppUrl(`/r/${recordingId}`)}
        sharesQuery={sharesQuery}
        onError={(err) =>
          toast.error(err instanceof Error ? err.message : t("shareUi.remove"))
        }
      />

      {canViewShares ? (
        visibility ? (
          <div className="space-y-2">
            <ShareSectionLabel>{t("shareUi.whoHasAccess")}</ShareSectionLabel>
            <div className="flex flex-col gap-1">
              <PeopleAccessRow
                sharesQuery={sharesQuery}
                onOpenSettings={onOpenPeopleSettings}
              />
              <GeneralAccessRow
                visibility={visibility}
                isPending={visibilityPending}
                onOpenSettings={onOpenAccessSettings}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2" aria-hidden>
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
          </div>
        )
      ) : null}

      {showMakePublic ? (
        <MakePublicCard
          isPending={visibilityPending}
          onMakePublic={() =>
            onVisibilityChange("public", {
              onSuccess: () => copyToClipboard(linkUrl),
            })
          }
        />
      ) : null}

      <Label
        className="flex items-center gap-2 text-sm font-normal"
        htmlFor="share-from-timestamp"
      >
        <Checkbox
          id="share-from-timestamp"
          checked={shareFromTimestamp}
          onCheckedChange={(checked) => setShareFromTimestamp(checked === true)}
        />
        {t("shareDialog.startAtTimestamp", {
          time: formatMs(timestampMs),
        })}
      </Label>

      <div className="flex items-center gap-2">
        <CopyButton
          value={linkUrl}
          disabled={visibilityPending || !sharesLoaded}
        >
          {t("shareUi.copyLink")}
        </CopyButton>
        {moreMenuItems.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="gap-1">
                {t("shareDialog.more")}
                <IconChevronDown size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {moreMenuItems.map((item) => (
                <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                  <item.icon size={16} aria-hidden />
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t("shareDialog.shareWithAgents")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("shareDialog.agentTokenDescription")}
          </p>
        </div>
        {agentLinkError ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void loadAgentContextUrl()}
            disabled={createAgentLink.isPending}
          >
            {t("shareDialog.retryAgentLink")}
          </Button>
        ) : (
          <CopyButton
            value={agentCopyValue}
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
