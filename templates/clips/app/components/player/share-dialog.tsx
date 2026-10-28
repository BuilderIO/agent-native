import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useActionMutation, useSession } from "@agent-native/core/client/hooks";
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
  AgentDestinationActions,
  JoinedShareControl,
  ShareTabs,
} from "@agent-native/toolkit/sharing";
import {
  IconBrandFacebook,
  IconBrandLinkedin,
  IconBrandX,
  IconChevronDown,
  IconExternalLink,
  IconMail,
  IconPhoto,
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
  ClaudeCodeLogo,
  ClaudeLogo,
  CodexLogo,
} from "@/components/agent-destination-logos";
import {
  CopyButton,
  ShareAdvancedPopover,
  ShareSectionLabel,
  nestedLayerDismissGuards,
  type Visibility,
} from "@/components/sharing/share-ui";
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
  PopoverAnchor,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { buildAgentApiUrls } from "../../../shared/agent-context";
import { buildEmailPreviewMarkup } from "../../../shared/email-preview";
import { withShareAttribution } from "../../../shared/share-attribution";
import { preferredThumbnailVariant } from "../../../shared/share-meta";
import {
  buildAgentShareDeepLink,
  type AgentShareDestination,
} from "../../lib/agent-share";
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
  viewerReshareOnly?: boolean;
  pendingRedactions?: number;
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
  pendingRedactions = 0,
  children,
  open,
  onOpenChange,
}: ShareRecordingPopoverProps) {
  const t = useT();
  const { session } = useSession();
  const ownerViaId =
    initialRole === "owner" ? (session?.userId ?? undefined) : undefined;
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : withShareAttribution(
          absoluteAppUrl(`/share/${recordingId}`),
          ownerViaId,
        );

  const copyShareLink = async () => {
    if (pendingRedactions > 0) {
      toast.warning(t("shareDialog.redactionsPendingTitle"), {
        description: t("shareDialog.redactionsPendingBody", {
          count: pendingRedactions,
        }),
      });
      return false;
    }
    const didCopy = await writeClipboardText(shareUrl);
    if (!didCopy) return false;
    trackEvent("share_link_copied", {
      app_name: "clips",
      template_name: "clips",
      output_id: recordingId,
      resource_type: "recording",
      resource_id: recordingId,
      link_type: "share",
      ...(initialVisibility ? { link_scope: initialVisibility } : {}),
    });
    return true;
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <JoinedShareControl
          className="clips-share-control"
          trigger={<PopoverTrigger asChild>{children}</PopoverTrigger>}
          copyLabel={t("recordRoute.copyLinkAction")}
          copiedLabel={t("recordRoute.linkCopied")}
          disabled={!shareUrl}
          blocked={pendingRedactions > 0}
          onCopy={copyShareLink}
        />
      </PopoverAnchor>
      {/* Keep the layer class in app source so Tailwind emits it for Clips. */}
      <PopoverContent
        align="end"
        {...nestedLayerDismissGuards()}
        className="z-[260] w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
      >
        {pendingRedactions > 0 ? (
          <div className="space-y-2 p-4">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {t("shareDialog.redactionsPendingTitle")}
            </p>
            <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
              {t("shareDialog.redactionsPendingBody", {
                count: pendingRedactions,
              })}
            </p>
          </div>
        ) : (
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
        )}
      </PopoverContent>
    </Popover>
  );
}

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
  pendingRedactions = 0,
}: ShareRecordingDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden border-border p-0 sm:max-w-[360px] [&>button]:top-1.5">
        <DialogTitle className="sr-only">
          {recordingTitle
            ? t("shareDialog.sharePlainTitle", { title: recordingTitle })
            : t("shareDialog.shareRecording")}
        </DialogTitle>
        {pendingRedactions > 0 ? (
          <div className="space-y-2 p-4">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {t("shareDialog.redactionsPendingTitle")}
            </p>
            <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
              {t("shareDialog.redactionsPendingBody", {
                count: pendingRedactions,
              })}
            </p>
          </div>
        ) : (
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
        )}
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
  const [tab, setTab] = useState<ShareTab | null>(null);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
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

  useEffect(() => {
    setTab(null);
  }, [recordingId]);

  const controller = useShareButtonController({
    resourceType: "recording",
    resourceId: recordingId,
    defaultOpen: !viewerReshareOnly,
    shareUrl: absoluteAppUrl(`/r/${recordingId}`),
  });
  const sharesQuery = controller.sharesQuery;
  const data = viewerReshareOnly ? undefined : controller.data;
  const role = data?.role ?? initialRole;
  const canManage = !viewerReshareOnly && controller.canManage;
  const canViewShares =
    role === "owner" || role === "admin" || role === "editor";
  const visibility =
    (viewerReshareOnly
      ? null
      : (controller.visibilityOverride ?? data?.visibility)) ??
    initialVisibility ??
    null;
  const canEmbed = canViewShares || visibility === "public";

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

  const visibilityPending =
    controller.visibilityTransition.submitting || sharesQuery.isLoading;
  const sharesLoaded = visibility !== null;

  const shown: Record<ShareTab, boolean> = {
    people: !viewerReshareOnly,
    // An agent link from a viewer would skip the clip's password.
    agents: !(viewerReshareOnly && passwordProtected),
    embed: canEmbed,
    social: true,
  };
  const available = SHARE_TABS.filter((value) => shown[value]);
  const activeTab = tab && shown[tab] ? tab : available[0]!;
  const labels: Record<ShareTab, string> = {
    people: t("shareDialog.people"),
    agents: t("shareDialog.agents"),
    embed: t("shareDialog.embed"),
    social: t("shareDialog.social"),
  };
  const panels: Record<ShareTab, ReactNode> = {
    people: (
      <PeopleTab
        recordingId={recordingId}
        controller={controller}
        visibility={visibility}
        hasPassword={passwordProtected}
        expiresAt={currentExpiry}
        onPasswordChange={setPasswordProtected}
        onExpiryChange={setCurrentExpiry}
        canViewShares={canViewShares}
        accessMenuOpen={accessMenuOpen}
        onAccessMenuOpenChange={setAccessMenuOpen}
      />
    ),
    agents: (
      <AgentTab
        recordingId={recordingId}
        visibility={visibility}
        hasPassword={passwordProtected}
        active={activeTab === "agents"}
      />
    ),
    embed: (
      <ClipsEmbedConfigurator
        recordingId={recordingId}
        visibility={visibility}
        canManage={canManage}
        ownerViaId={ownerViaId}
        onChangeAccess={() => {
          setTab("people");
          setAccessMenuOpen(true);
        }}
      />
    ),
    social: (
      <SocialTab
        shareUrl={shareUrl}
        recordingId={recordingId}
        recordingTitle={recordingTitle}
        thumbnailUrl={thumbnailUrl}
        animatedThumbnailUrl={animatedThumbnailUrl}
        visibility={visibility}
        hasPassword={passwordProtected}
      />
    ),
  };

  return (
    <div className="min-w-0">
      {reserveCloseButton ? (
        <div className="flex h-10 items-center gap-2 border-b border-border px-3 pe-10">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("shareDialog.shareRecording")}
          </span>
          {showHeaderCopy ? (
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
      ) : null}

      <div className="px-3 py-2">
        <ShareTabs
          value={activeTab}
          onValueChange={(value) => {
            setAccessMenuOpen(false);
            setTab(value as ShareTab);
          }}
          tabs={available.map((value) => ({
            value,
            label: labels[value],
            content: panels[value],
          }))}
        />
      </div>
    </div>
  );
}

type ShareTab = "people" | "agents" | "embed" | "social";

const SHARE_TABS: ShareTab[] = ["people", "agents", "embed", "social"];

function PeopleTab({
  recordingId,
  controller,
  visibility,
  hasPassword,
  expiresAt,
  onPasswordChange,
  onExpiryChange,
  canViewShares,
  accessMenuOpen,
  onAccessMenuOpenChange,
}: {
  recordingId: string;
  controller: ShareButtonController;
  visibility: Visibility | null;
  hasPassword?: boolean;
  expiresAt: string | null;
  onPasswordChange: (hasPassword: boolean) => void;
  onExpiryChange: (expiresAt: string | null) => void;
  canViewShares: boolean;
  accessMenuOpen: boolean;
  onAccessMenuOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const roleCopy = {
    commenter: {
      label: t("shareUi.recordingCommenter.label"),
      description: t("shareUi.recordingCommenter.description"),
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <SharePeopleInvite controller={controller} roleCopy={roleCopy} />

      {canViewShares ? (
        visibility ? (
          <div className="flex flex-col gap-1.5">
            <ShareSectionLabel>{t("shareUi.whoHasAccess")}</ShareSectionLabel>
            <div className="flex flex-col gap-0.5">
              <div className="max-h-72 overflow-y-auto">
                <SharePeopleList controller={controller} roleCopy={roleCopy} />
              </div>
              <ShareGeneralAccessRow
                controller={{ ...controller, visibility }}
                sentenceTrigger
                menuOpen={accessMenuOpen}
                onMenuOpenChange={onAccessMenuOpenChange}
              >
                <RecordingAdvancedAccess
                  recordingId={recordingId}
                  hasPassword={Boolean(hasPassword)}
                  expiresAt={expiresAt}
                  canEdit={canViewShares}
                  onPasswordChange={onPasswordChange}
                  onExpiryChange={onExpiryChange}
                />
              </ShareGeneralAccessRow>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5" aria-hidden>
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
          </div>
        )
      ) : null}
    </div>
  );
}

function AgentTab({
  recordingId,
  visibility,
  hasPassword,
  active,
}: {
  recordingId: string;
  visibility: Visibility | null;
  hasPassword?: boolean;
  active: boolean;
}) {
  const t = useT();
  const isPublic = visibility === "public";
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
    if (!active) {
      agentLinkRequestIdRef.current += 1;
      return;
    }

    setAgentContextUrl("");
    setAgentLinkError(false);
    if (visibility !== null && needsScopedAgentContext) {
      void loadAgentContextUrl();
    }

    return () => {
      agentLinkRequestIdRef.current += 1;
    };
  }, [active, loadAgentContextUrl, needsScopedAgentContext, visibility]);

  const agentLink = isPublic
    ? publicAgentContextUrl || agentContextUrl
    : agentContextUrl;
  const agentShareDisabled =
    visibility === null ||
    !agentLink ||
    (needsScopedAgentContext &&
      (createAgentLink.isPending || !agentContextUrl));
  const agentCopyValue = agentLink
    ? t("shareDialog.agentPrompt", {
        agentContextUrl: agentLink,
        shareWithAgents: t("shareDialog.shareWithAgents"),
      })
    : "";

  const openAgentDestination = (destination: AgentShareDestination) => {
    if (
      agentShareDisabled ||
      !agentCopyValue ||
      typeof window === "undefined"
    ) {
      return;
    }

    trackEvent("agent_share_opened", {
      resource_type: "recording",
      resource_id: recordingId,
      destination,
    });
    window.location.assign(
      buildAgentShareDeepLink(destination, agentCopyValue),
    );
  };

  const copyAgentPrompt = async () => {
    if (agentShareDisabled || !agentCopyValue) return;
    const copied = await writeClipboardText(agentCopyValue);
    if (copied === false) return;

    trackEvent("share_link_copied", {
      app_name: "clips",
      template_name: "clips",
      output_id: recordingId,
      resource_type: "recording",
      resource_id: recordingId,
      link_type: "agent_context",
      ...(visibility ? { link_scope: visibility } : {}),
    });
    toast.success(t("shareUi.copied"));
  };

  if (agentLinkError) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full justify-start px-1.5 text-sm font-normal"
        onClick={() => void loadAgentContextUrl()}
        disabled={createAgentLink.isPending}
      >
        {t("shareDialog.retryAgentLink")}
      </Button>
    );
  }

  return (
    <AgentDestinationActions
      labels={{
        copy: t("shareDialog.copyAgentPrompt"),
        claude: t("shareDialog.openInClaude"),
        claudeCode: t("shareDialog.openInClaudeCode"),
        codex: t("shareDialog.openInCodex"),
      }}
      icons={{
        claude: <ClaudeLogo className="size-4" />, // i18n-ignore: destination identifiers in this icon map
        "claude-code": <ClaudeCodeLogo className="size-4" />, // i18n-ignore: destination identifier
        codex: <CodexLogo className="size-4" />,
      }}
      disabled={agentShareDisabled}
      onCopy={copyAgentPrompt}
      onOpen={openAgentDestination}
    />
  );
}

function RecordingAdvancedAccess({
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

  const summary = [
    hasPassword ? t("shareDialog.passwordSet") : t("shareDialog.noPassword"),
    expiresAt
      ? t("shareDialog.expiresOn", { date: formatExpiry(expiresAt) })
      : t("shareDialog.neverExpires"),
  ].join(" · ");

  return (
    <ShareAdvancedPopover summary={summary} disabled={!canEdit}>
      <div className="grid gap-2">
        <div className="flex min-h-8 items-center gap-2">
          <Label
            htmlFor="share-password-required"
            className="min-w-0 flex-1 cursor-pointer text-sm font-normal"
          >
            {t("embedRoute.passwordRequired")}
          </Label>
          <ViewerSwitch
            id="share-password-required"
            checked={passwordEnabled}
            disabled={!canEdit || updateRecording.isPending}
            onCheckedChange={setPasswordRequired}
          />
        </div>

        {passwordEnabled ? (
          <>
            <div className="flex gap-2">
              <Input
                size="sm"
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
                className="min-w-0"
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0"
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
          </>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="share-expiry" className="text-sm font-normal">
          {t("shareDialog.linkExpires")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="share-expiry"
            size="sm"
            type="datetime-local"
            value={toDatetimeLocal(expiryDraft)}
            disabled={!canEdit}
            onChange={(event) =>
              setExpiryDraft(fromDatetimeLocal(event.target.value))
            }
            className="min-w-0"
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={!canEdit || updateRecording.isPending}
            onClick={() => {
              const nextExpiry = expiryDraft || null;
              updateRecording.mutate(
                { id: recordingId, expiresAt: nextExpiry } as any,
                { onSuccess: () => onExpiryChange(nextExpiry) },
              );
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </ShareAdvancedPopover>
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
          onClick={() =>
            window.open(animatedThumbnailUrl, "_blank", "noopener,noreferrer")
          }
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

function ClipsEmbedConfigurator({
  recordingId,
  visibility,
  canManage,
  ownerViaId,
  onChangeAccess,
}: {
  recordingId: string;
  visibility: Visibility | null;
  canManage: boolean;
  ownerViaId?: string;
  onChangeAccess: () => void;
}) {
  const t = useT();
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const isPublic = visibility === "public";

  const src = useMemo(() => {
    const params: string[] = [];
    if (autoplay) params.push("autoplay=1");
    if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
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
        <p className="text-xs leading-5 text-muted-foreground">
          {t("shareDialog.embedNeedsLinkAccess")}{" "}
          {canManage ? (
            <button
              type="button"
              className="font-medium text-foreground underline-offset-2 hover:underline"
              onClick={onChangeAccess}
            >
              {t("shareDialog.changeGeneralAccess")}
            </button>
          ) : (
            t("shareDialog.askOwnerPublic")
          )}
        </p>
      ) : null}

      <CopyButton
        value={code}
        className="w-full"
        variant="default"
        disabled={!isPublic}
      >
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
                  size="sm"
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">{t("shareDialog.height")}</Label>
                <Input
                  size="sm"
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
              size="sm"
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
