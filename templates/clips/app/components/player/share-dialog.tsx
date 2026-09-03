import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBrandFacebook,
  IconBrandLinkedin,
  IconBrandX,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconLink,
  IconMail,
  IconMessage,
  IconPhoto,
  IconRefresh,
  IconShare3,
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
import { ButtonGroup } from "@/components/ui/button-group";
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
  PopoverAnchor,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { buildAgentApiUrls } from "../../../shared/agent-context";
import { buildEmailPreviewMarkup } from "../../../shared/email-preview";
import { withShareAttribution } from "../../../shared/share-attribution";
import { preferredThumbnailVariant } from "../../../shared/share-meta";
import { buildSocialShareUrl } from "../../lib/social-share";
import { ViewerSwitch } from "./viewer-controls";

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
  hasPassword?: boolean;
  expiresAt?: string | null;
  /**
   * Restricts the dialog to a bare copy-link control for viewers who can
   * reshare a public/org clip's link but have no edit access: it skips
   * `list-resource-shares` (which returns every individually-shared
   * principal's email to any reader) and hides access management entirely.
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
 * Clips share popover — anchored to a trigger button. The default view keeps
 * copy, invite, and access together; secondary destinations replace the body
 * so advanced controls never compete with the primary sharing path.
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
  hasPassword,
  expiresAt,
  viewerReshareOnly = false,
  children,
  open,
  onOpenChange,
}: ShareRecordingPopoverProps) {
  const t = useT();
  const { session } = useSession();
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerViaId =
    initialRole === "owner" ? (session?.userId ?? undefined) : undefined;
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : withShareAttribution(
          absoluteAppUrl(`/share/${recordingId}`),
          ownerViaId,
        );

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyShareLink = async () => {
    const didCopy = await writeClipboardText(shareUrl);
    if (!didCopy) return;
    trackEvent("share_link_copied", {
      resource_type: "recording",
      resource_id: recordingId,
      link_type: "share",
    });
    setCopied(true);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <ButtonGroup className="clips-share-trigger shrink-0">
          <PopoverTrigger asChild>{children}</PopoverTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                className="size-8 shrink-0 shadow-none"
                aria-label={
                  copied
                    ? t("recordRoute.linkCopied")
                    : t("recordRoute.copyLinkAction")
                }
                disabled={!shareUrl}
                onClick={() => void copyShareLink()}
              >
                {copied ? (
                  <IconCheck className="size-4" />
                ) : (
                  <IconLink className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {copied
                ? t("recordRoute.linkCopied")
                : t("recordRoute.copyLinkAction")}
            </TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </PopoverAnchor>
      {/* Keep the layer class in app source so Tailwind emits it for Clips. */}
      <PopoverContent
        align="end"
        {...nestedLayerDismissGuards()}
        className="z-[260] w-[400px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
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
          hasPassword={hasPassword}
          expiresAt={expiresAt}
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
  open,
  onOpenChange,
  hasPassword,
  expiresAt,
  viewerReshareOnly = false,
}: ShareRecordingDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden border-border p-0 sm:max-w-[400px]">
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
          hasPassword={hasPassword}
          expiresAt={expiresAt}
          viewerReshareOnly={viewerReshareOnly}
          reserveCloseButton
          showHeaderCopy
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
  thumbnailUrl,
  animatedThumbnailUrl,
  reserveCloseButton = false,
  showHeaderCopy = false,
  hasPassword,
  expiresAt,
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
  reserveCloseButton?: boolean;
  showHeaderCopy?: boolean;
  hasPassword?: boolean;
  expiresAt?: string | null;
  viewerReshareOnly?: boolean;
}) {
  const t = useT();
  const [view, setView] = useState<"main" | "social" | "embed">("main");
  const [passwordProtected, setPasswordProtected] = useState(
    Boolean(hasPassword),
  );
  const [currentExpiry, setCurrentExpiry] = useState(expiresAt ?? null);

  useEffect(() => {
    setPasswordProtected(Boolean(hasPassword));
  }, [hasPassword]);

  useEffect(() => {
    setCurrentExpiry(expiresAt ?? null);
  }, [expiresAt]);
  const sharesQuery = useActionQuery<SharesResponse>(
    "list-resource-shares",
    { resourceType: "recording", resourceId: recordingId },
    { enabled: !viewerReshareOnly },
  );

  const data = viewerReshareOnly ? undefined : sharesQuery.data;
  const role = data?.role ?? initialRole;
  const canManage = role === "owner" || role === "admin";
  // Editors could always see (read-only) who a clip is shared with; only
  // gate invite mutations behind canManage. Commenters are
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
  const sharesLoaded = visibility !== null;
  const viewTitle =
    view === "social"
      ? t("shareDialog.social")
      : view === "embed"
        ? t("shareDialog.embed")
        : t("shareDialog.shareRecording");

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex h-10 items-center gap-2 border-b border-border px-3",
          reserveCloseButton && "pe-10",
        )}
      >
        {view === "main" ? (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {viewTitle}
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-1 h-7 min-w-0 gap-1.5 px-1.5"
            onClick={() => setView("main")}
          >
            <IconArrowLeft className="size-3.5 shrink-0" />
            <span className="truncate font-semibold">{viewTitle}</span>
          </Button>
        )}
        {view === "main" && showHeaderCopy ? (
          <CopyButton
            value={shareUrl}
            disabled={visibilityPending || !sharesLoaded}
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs text-primary hover:text-primary"
            resourceType="recording"
            resourceId={recordingId}
            linkType="share"
          >
            {t("shareUi.copyLink")}
          </CopyButton>
        ) : null}
      </div>

      <div className="px-3 py-2">
        {view === "main" ? (
          <LinkTab
            recordingId={recordingId}
            sharesQuery={sharesQuery}
            visibility={visibility}
            visibilityPending={visibilityPending}
            onVisibilityChange={setResourceVisibility}
            canManage={canManage}
            hasPassword={passwordProtected}
            expiresAt={currentExpiry}
            onPasswordChange={setPasswordProtected}
            onExpiryChange={setCurrentExpiry}
            canViewShares={canViewShares}
            viewerReshareOnly={viewerReshareOnly}
            canEmbed={canEmbed}
            onOpenSocial={() => setView("social")}
            onOpenEmbed={() => setView("embed")}
          />
        ) : view === "social" ? (
          <SocialTab
            shareUrl={shareUrl}
            recordingId={recordingId}
            recordingTitle={recordingTitle}
            thumbnailUrl={thumbnailUrl}
            animatedThumbnailUrl={animatedThumbnailUrl}
            visibility={visibility}
            hasPassword={passwordProtected}
          />
        ) : (
          <ClipsEmbedConfigurator
            recordingId={recordingId}
            sharesQuery={sharesQuery}
            visibility={visibility}
            canManage={canManage}
            ownerViaId={ownerViaId}
          />
        )}
      </div>
    </div>
  );
}

function ShareOptionRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-8 w-full justify-start gap-2 px-1.5 text-sm font-normal"
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Primary view — invite, access, and progressively disclosed destinations
// ---------------------------------------------------------------------------

function LinkTab({
  recordingId,
  sharesQuery,
  visibility,
  visibilityPending,
  onVisibilityChange,
  canManage,
  hasPassword,
  expiresAt,
  onPasswordChange,
  onExpiryChange,
  canViewShares,
  viewerReshareOnly,
  canEmbed,
  onOpenSocial,
  onOpenEmbed,
}: {
  recordingId: string;
  sharesQuery: SharesQuery;
  visibility: Visibility | null;
  visibilityPending: boolean;
  onVisibilityChange: (
    next: Visibility,
    options?: { onSuccess?: () => void },
  ) => void;
  canManage: boolean;
  hasPassword?: boolean;
  expiresAt: string | null;
  onPasswordChange: (hasPassword: boolean) => void;
  onExpiryChange: (expiresAt: string | null) => void;
  canViewShares: boolean;
  viewerReshareOnly: boolean;
  canEmbed: boolean;
  onOpenSocial: () => void;
  onOpenEmbed: () => void;
}) {
  const t = useT();
  const isPublic = visibility === "public";
  const sharesLoaded = visibility !== null;
  const needsScopedAgentContext = !isPublic || hasPassword !== false;
  const publicAgentContextUrl = useMemo(
    () =>
      isPublic && hasPassword === false
        ? absolutePublicAgentContextUrl(recordingId)
        : "",
    [hasPassword, isPublic, recordingId],
  );
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
    if (!sharesLoaded || !agentShareOpen) return;

    if (needsScopedAgentContext) {
      void loadAgentContextUrl();
    }

    return () => {
      agentLinkRequestIdRef.current += 1;
    };
  }, [
    loadAgentContextUrl,
    needsScopedAgentContext,
    agentShareOpen,
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

  if (viewerReshareOnly) return null;

  return (
    <div className="space-y-3">
      {/* `share-resource` requires owner/admin, so anyone else would only get
          a rejected submission. */}
      {canManage ? (
        <InvitePeopleField
          resourceType="recording"
          resourceId={recordingId}
          resourceUrl={absoluteAppUrl(`/r/${recordingId}`)}
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

      {canViewShares ? (
        visibility ? (
          <div className="space-y-1.5">
            <ShareSectionLabel>{t("shareUi.whoHasAccess")}</ShareSectionLabel>
            <div className="flex flex-col gap-0.5">
              <PeopleAccessSection
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
              <RecordingAccessControls
                recordingId={recordingId}
                hasPassword={Boolean(hasPassword)}
                expiresAt={expiresAt}
                canEdit={canViewShares}
                onPasswordChange={onPasswordChange}
                onExpiryChange={onExpiryChange}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5" aria-hidden>
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
          </div>
        )
      ) : null}

      <div className="-mx-1.5 border-t border-border pt-1.5">
        <ShareOptionRow
          icon={<IconShare3 className="size-3.5" />}
          label={t("shareDialog.social")}
          onClick={onOpenSocial}
        />
        {canEmbed ? (
          <ShareOptionRow
            icon={<IconExternalLink className="size-3.5" />}
            label={t("shareDialog.embed")}
            onClick={onOpenEmbed}
          />
        ) : null}
      </div>

      <Collapsible open={agentShareOpen} onOpenChange={setAgentShareOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-between px-1.5 text-sm font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconMessage className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {t("shareDialog.shareWithAgents")}
              </span>
            </span>
            <IconChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                agentShareOpen && "rotate-180",
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-1.5 pb-1 pt-1.5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {/* A public, unprotected clip hands agents its permanent public
                  context URL; everything else gets a short-lived scoped token. */}
              {needsScopedAgentContext
                ? t("shareDialog.agentTokenDescription")
                : t("shareDialog.agentPublicDescription")}
            </p>
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
                resourceType="recording"
                resourceId={recordingId}
                linkType="agent_context"
              >
                {t("shareUi.copy")}
              </CopyButton>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function RecordingAccessControls({
  recordingId,
  hasPassword,
  expiresAt,
  canEdit,
  onPasswordChange,
  onExpiryChange,
}: {
  recordingId: string;
  hasPassword: boolean;
  expiresAt: string | null;
  canEdit: boolean;
  onPasswordChange: (hasPassword: boolean) => void;
  onExpiryChange: (expiresAt: string | null) => void;
}) {
  const t = useT();
  const updateRecording = useActionMutation("update-recording");
  const [passwordEnabled, setPasswordEnabled] = useState(hasPassword);
  const [password, setPassword] = useState("");
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [expiryDraft, setExpiryDraft] = useState(expiresAt ?? "");

  useEffect(() => {
    setPasswordEnabled(hasPassword);
  }, [hasPassword]);

  useEffect(() => {
    setExpiryDraft(expiresAt ?? "");
  }, [expiresAt]);

  const setPasswordRequired = (enabled: boolean) => {
    setPasswordEnabled(enabled);
    if (enabled || !hasPassword) return;

    setPassword("");
    updateRecording.mutate({ id: recordingId, password: null } as any, {
      onSuccess: () => onPasswordChange(false),
      onError: () => setPasswordEnabled(true),
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="rounded-md px-1.5 py-1">
        <div className="flex min-h-8 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ViewerSwitch
              id="share-password-required"
              checked={passwordEnabled}
              disabled={!canEdit || updateRecording.isPending}
              onCheckedChange={setPasswordRequired}
            />
            <Label
              htmlFor="share-password-required"
              className="cursor-pointer text-sm font-normal"
            >
              {t("embedRoute.passwordRequired")}
            </Label>
          </div>
          {passwordEnabled && canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-xs"
              onClick={() => setPassword(generateSecurePassword())}
            >
              <IconRefresh className="size-3.5" />
              {t("playerSettings.generatePassword")}
            </Button>
          ) : null}
        </div>

        {passwordEnabled ? (
          <div className="grid gap-2 pt-2">
            <div className="flex gap-2">
              <Input
                type="text"
                value={password}
                disabled={!canEdit}
                onChange={(event) => setPassword(event.target.value)}
                aria-label={t("playerSettings.passwordProtection")}
                placeholder={
                  hasPassword
                    ? t("playerSettings.passwordSetPlaceholder")
                    : t("playerSettings.passwordInputPlaceholder")
                }
                className="h-8 min-w-0"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0"
                disabled={
                  !canEdit || updateRecording.isPending || !password.trim()
                }
                onClick={() => {
                  updateRecording.mutate(
                    { id: recordingId, password: password.trim() } as any,
                    {
                      onSuccess: () => {
                        onPasswordChange(true);
                        setPassword("");
                      },
                    },
                  );
                }}
              >
                {t("common.save")}
              </Button>
            </div>
            {password.length > 0 && !password.trim() ? (
              <p className="text-xs text-muted-foreground">
                {t("playerSettings.passwordWhitespaceOnly")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Collapsible open={expiryOpen} onOpenChange={setExpiryOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-1.5 text-sm font-normal"
          >
            <span className="min-w-0 flex-1 text-start">
              {t("playerSettings.expiry")}
            </span>
            <span className="max-w-44 truncate text-xs text-muted-foreground">
              {formatExpiry(expiresAt)}
            </span>
            <IconChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expiryOpen && "rotate-180",
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-1 pb-1 pt-2">
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              value={toDatetimeLocal(expiryDraft)}
              disabled={!canEdit}
              aria-label={t("playerSettings.expiry")}
              onChange={(event) =>
                setExpiryDraft(fromDatetimeLocal(event.target.value))
              }
              className="h-8 min-w-0"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0"
              disabled={!canEdit || updateRecording.isPending}
              onClick={() => {
                const nextExpiry = expiryDraft || null;
                updateRecording.mutate(
                  { id: recordingId, expiresAt: nextExpiry } as any,
                  {
                    onSuccess: () => {
                      onExpiryChange(nextExpiry);
                      setExpiryOpen(false);
                    },
                  },
                );
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function generateSecurePassword(length = 20): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-._~";
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const bytes = new Uint8Array(length * 2);
  let password = "";

  while (password.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }

  return password;
}

// ---------------------------------------------------------------------------
// Social tab — destination-first share intents, no provider account required
// ---------------------------------------------------------------------------

function SocialTab({
  shareUrl,
  recordingId,
  recordingTitle,
  thumbnailUrl,
  animatedThumbnailUrl,
  visibility,
  hasPassword,
}: {
  shareUrl: string;
  recordingId: string;
  recordingTitle?: string;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  visibility: Visibility | null;
  hasPassword?: boolean;
}) {
  const t = useT();
  const title = recordingTitle?.trim() || t("recordingPage.untitledClip");
  const emailPreviewThumbnailUrl = useMemo(() => {
    if (visibility !== "public" || hasPassword !== false) return null;
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
    recordingId,
    thumbnailUrl,
    visibility,
  ]);
  const copyEmailPreview = useCallback(async () => {
    if (!emailPreviewThumbnailUrl || !shareUrl) return;

    try {
      const markup = buildEmailPreviewMarkup({
        title,
        shareUrl,
        thumbnailUrl: emailPreviewThumbnailUrl,
      });
      const copied = await writeClipboardText(markup.plainText, {
        html: markup.html,
      });
      toast[copied ? "success" : "error"](
        copied
          ? t("shareDialog.emailPreviewCopied")
          : t("shareDialog.emailPreviewCopyFailed"),
      );
    } catch {
      toast.error(t("shareDialog.emailPreviewCopyFailed"));
    }
  }, [emailPreviewThumbnailUrl, shareUrl, t, title]);
  const destinations = [
    {
      key: "linkedin" as const,
      label: t("shareDialog.shareOnLinkedIn"),
      icon: IconBrandLinkedin,
    },
    {
      key: "x" as const,
      label: t("shareDialog.shareOnX"),
      icon: IconBrandX,
    },
    {
      key: "facebook" as const,
      label: t("shareDialog.shareOnFacebook"),
      icon: IconBrandFacebook,
    },
    {
      key: "email" as const,
      label: t("shareDialog.shareByEmail"),
      icon: IconMail,
    },
  ];

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {destinations.map((destination) => (
        <button
          key={destination.key}
          type="button"
          className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => {
            const url = buildSocialShareUrl(destination.key, shareUrl, title);
            if (destination.key === "email") {
              window.location.href = url;
              return;
            }
            window.open(
              url,
              "_blank",
              "noopener,noreferrer,width=720,height=640",
            );
          }}
        >
          <destination.icon className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{destination.label}</span>
          <IconShare3 className="h-4 w-4 text-muted-foreground" />
        </button>
      ))}
      {emailPreviewThumbnailUrl ? (
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => void copyEmailPreview()}
        >
          <IconMail className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {t("shareDialog.copyEmailPreview")}
          </span>
        </button>
      ) : null}
      {animatedThumbnailUrl ? (
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => window.open(animatedThumbnailUrl, "_blank")}
        >
          <IconPhoto className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {t("shareDialog.gifPreview")}
          </span>
          <IconExternalLink className="size-4 text-muted-foreground" />
        </button>
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
  const [customizeOpen, setCustomizeOpen] = useState(false);

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
      ? `<div style="position:relative;padding-bottom:56.25%;height:0;background:#000;overflow:hidden"><iframe src="${src}" title="${t("shareDialog.embedIframeTitle")}" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; tools" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;overflow:hidden"></iframe></div>` // guard:allow-raw-color - generated embeds use the black player backdrop; i18n-ignore - generated markup uses a localized title
      : `<iframe src="${src}" title="${t("shareDialog.embedIframeTitle")}" width="${width}" height="${height}" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; tools" style="display:block;max-width:100%;border:0;background:#000;overflow:hidden"></iframe>`; // guard:allow-raw-color - generated embeds use the black player backdrop; i18n-ignore - generated markup uses a localized title

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

      <CopyButton value={code} className="w-full" variant="default">
        {t("shareDialog.copyEmbedCode")}
      </CopyButton>

      <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-between px-2 text-sm font-medium"
          >
            {t("shareDialog.customizeEmbed")}
            <IconChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                customizeOpen && "rotate-180",
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-2 pb-1 pt-2">
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as typeof mode)}
          >
            <TabsList className="grid h-8 w-full grid-cols-2">
              <TabsTrigger value="responsive" className="text-xs">
                {t("shareDialog.responsive")}
              </TabsTrigger>
              <TabsTrigger value="fixed" className="text-xs">
                {t("shareDialog.fixedSize")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "fixed" ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">{t("shareDialog.width")}</Label>
                <Input
                  className="h-8"
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">{t("shareDialog.height")}</Label>
                <Input
                  className="h-8"
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(parseInt(e.target.value) || 360)}
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <Label className="text-sm">{t("shareDialog.autoplay")}</Label>
            <ViewerSwitch checked={autoplay} onCheckedChange={setAutoplay} />
          </div>

          <div>
            <Label className="text-xs">{t("shareDialog.startAt")}</Label>
            <Input
              className="h-8"
              type="number"
              min={0}
              value={Math.round(startMs / 1000)}
              onChange={(e) =>
                setStartMs((parseInt(e.target.value) || 0) * 1000)
              }
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
