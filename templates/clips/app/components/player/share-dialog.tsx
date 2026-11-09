import { trackEvent } from "@agent-native/core/client/analytics";
import { apiBaseUrl, appPath } from "@agent-native/core/client/api-path";
import { useActionMutation, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { JoinedShareControl } from "@agent-native/toolkit/sharing";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  ShareAdvancedPopover,
  nestedLayerDismissGuards,
  type Visibility,
} from "@/components/sharing/share-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

import { buildAgentApiUrls } from "../../../shared/agent-context";
import { withShareAttribution } from "../../../shared/share-attribution";
import {
  buildAgentShareDeepLink,
  type AgentShareDestination,
} from "../../lib/agent-share";

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
}

type ShareRecordingDialogProps = Omit<
  ShareRecordingPopoverProps,
  "children"
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerEmail?: string;
};

function RedactionWarning({ count }: { count: number }) {
  const t = useT();
  return (
    <div className="space-y-2 p-4">
      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
        {t("shareDialog.redactionsPendingTitle")}
      </p>
      <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
        {t("shareDialog.redactionsPendingBody", { count })}
      </p>
    </div>
  );
}

export function ShareRecordingPopover(props: ShareRecordingPopoverProps) {
  const t = useT();
  const { session } = useSession();
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : withShareAttribution(
          new URL(
            appPath(`/share/${props.recordingId}`),
            window.location.origin,
          ).toString(),
          props.initialRole === "owner"
            ? (session?.userId ?? undefined)
            : undefined,
        );
  const copyShareLink = async () => {
    if (props.pendingRedactions) {
      toast.warning(t("shareDialog.redactionsPendingTitle"), {
        description: t("shareDialog.redactionsPendingBody", {
          count: props.pendingRedactions,
        }),
      });
      return false;
    }
    if (!shareUrl || !(await writeClipboardText(shareUrl))) return false;
    trackEvent("share_link_copied", {
      app_name: "clips",
      template_name: "clips",
      output_id: props.recordingId,
      resource_type: "recording",
      resource_id: props.recordingId,
      link_type: "share",
      ...(props.initialVisibility
        ? { link_scope: props.initialVisibility }
        : {}),
    });
    return true;
  };
  if (props.pendingRedactions) {
    return (
      <Popover>
        <JoinedShareControl
          trigger={<PopoverTrigger asChild>{props.children}</PopoverTrigger>}
          copyLabel={t("recordRoute.copyLinkAction")}
          copiedLabel={t("recordRoute.linkCopied")}
          blocked
          onCopy={copyShareLink}
          className="clips-share-control"
        />
        <PopoverContent
          align="end"
          {...nestedLayerDismissGuards()}
          className="z-[260] w-[360px] max-w-[calc(100vw-1rem)] p-0"
        >
          <RedactionWarning count={props.pendingRedactions} />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <RecordingShareButton
      {...props}
      shareUrl={shareUrl}
      quickCopy={copyShareLink}
    />
  );
}

export function ShareRecordingDialog(props: ShareRecordingDialogProps) {
  const { session } = useSession();
  if (!props.open) return null;
  if (props.pendingRedactions) return <RedactionDialog {...props} />;
  const isOwner =
    props.initialRole === "owner" ||
    Boolean(
      props.ownerEmail &&
      session?.email &&
      props.ownerEmail.trim().toLowerCase() ===
        session.email.trim().toLowerCase(),
    );
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : withShareAttribution(
          new URL(
            appPath(`/share/${props.recordingId}`),
            window.location.origin,
          ).toString(),
          isOwner ? session?.userId : undefined,
        );
  return (
    <RecordingShareButton
      {...props}
      shareUrl={shareUrl}
      hideTrigger
      defaultOpen
    />
  );
}

function RedactionDialog(props: ShareRecordingDialogProps) {
  const t = useT();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogTitle className="sr-only">
          {t("shareDialog.shareRecording")}
        </DialogTitle>
        <RedactionWarning count={props.pendingRedactions ?? 0} />
      </DialogContent>
    </Dialog>
  );
}

function RecordingShareButton({
  recordingId,
  recordingTitle,
  initialVisibility,
  hasPassword,
  expiresAt,
  viewerReshareOnly,
  shareUrl,
  quickCopy,
  hideTrigger,
  defaultOpen,
  onOpenChange,
}: Omit<ShareRecordingPopoverProps, "children"> & {
  shareUrl: string;
  quickCopy?: () => Promise<boolean>;
  hideTrigger?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const createAgentLink = useActionMutation(
    "create-recording-agent-link" as any,
  );
  const agentPrompt = async () => {
    try {
      const origin = apiBaseUrl();
      const result =
        viewerReshareOnly &&
        initialVisibility === "public" &&
        hasPassword === false
          ? {
              contextUrl: buildAgentApiUrls(
                recordingId,
                origin
                  ? { origin }
                  : {
                      origin: window.location.origin,
                      basePath: appPath("/").replace(/\/$/, ""),
                    },
              ).contextUrl,
            }
          : ((await createAgentLink.mutateAsync({ recordingId })) as {
              contextUrl?: string;
            });
      if (!result.contextUrl) throw new Error("Missing agent context URL");
      return t("shareDialog.agentPrompt", {
        agentContextUrl: result.contextUrl,
        shareWithAgents: t("shareDialog.shareWithAgents"),
        connectUrl: new URL(
          "/mcp/connect",
          apiBaseUrl() || window.location.origin,
        ).toString(),
      });
    } catch {
      toast.error(t("shareDialog.retryAgentLink"));
      return null;
    }
  };
  const [passwordProtected, setPasswordProtected] = useState(
    Boolean(hasPassword),
  );
  const [currentExpiry, setCurrentExpiry] = useState(expiresAt ?? null);
  useEffect(() => setPasswordProtected(Boolean(hasPassword)), [hasPassword]);
  useEffect(() => setCurrentExpiry(expiresAt ?? null), [expiresAt]);
  return (
    <ShareButton
      resourceType="recording"
      resourceId={recordingId}
      {...(recordingTitle !== undefined && { resourceTitle: recordingTitle })}
      shareUrl={shareUrl}
      {...(hideTrigger !== undefined && { hideTrigger })}
      {...(quickCopy && {
        quickCopy: {
          label: t("recordRoute.copyLinkAction"),
          copiedLabel: t("recordRoute.linkCopied"),
          onCopy: quickCopy,
          className: "clips-share-control",
        },
      })}
      {...(defaultOpen !== undefined && { defaultOpen })}
      {...(onOpenChange && { onOpenChange })}
      {...(!(viewerReshareOnly && hasPassword !== false) && {
        sendTo: {
          openInAgent: (destination: AgentShareDestination) => {
            void agentPrompt().then((prompt) => {
              if (prompt)
                window.location.assign(
                  buildAgentShareDeepLink(destination, prompt),
                );
            });
          },
          copyAgentPrompt: async () => {
            const prompt = await agentPrompt();
            if (prompt && (await writeClipboardText(prompt)))
              toast.success(t("shareUi.copied"));
          },
        },
      })}
      {...(viewerReshareOnly !== undefined && { linkOnly: viewerReshareOnly })}
      hideSendTo={Boolean(viewerReshareOnly && hasPassword !== false)}
      generalAccessExtras={(controller) =>
        !viewerReshareOnly && (passwordProtected || currentExpiry) ? (
          <RecordingAdvancedAccess
            recordingId={recordingId}
            hasPassword={passwordProtected}
            expiresAt={currentExpiry}
            canEdit={controller.canManage}
            onPasswordChange={setPasswordProtected}
            onExpiryChange={setCurrentExpiry}
          />
        ) : null
      }
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
  const updateRecording = useActionMutation("update-recording", {
    errorNotification: "shared",
  });
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
          <Switch
            id="share-password-required"
            checked={passwordEnabled}
            disabled={!canEdit || updateRecording.isPending || !hasPassword}
            onCheckedChange={setPasswordRequired}
          />
        </div>

        {passwordEnabled ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
              />
              <Button
                type="button"
                size="sm"
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
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Input
            id="share-expiry"
            size="sm"
            type="datetime-local"
            value={toDatetimeLocal(expiryDraft)}
            disabled={!canEdit}
            onChange={(event) =>
              setExpiryDraft(fromDatetimeLocal(event.target.value))
            }
          />
          <Button
            type="button"
            size="sm"
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
