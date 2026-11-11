import { trackEvent } from "@agent-native/core/client/analytics";
import { apiBaseUrl, appPath } from "@agent-native/core/client/api-path";
import { useActionMutation, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useActionQuery } from "@agent-native/core/client/use-action";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { JoinedShareControl } from "@agent-native/toolkit/sharing";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  nestedLayerDismissGuards,
  type Visibility,
} from "@/components/sharing/share-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
  initialRole,
  hasPassword,
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
  const { session } = useSession();
  const access = useActionQuery<{
    state: string;
    role?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  }>(
    "get-resource-access-status",
    { resourceType: "recording", resourceId: recordingId },
    { enabled: initialRole === undefined && !viewerReshareOnly },
  );
  const role =
    initialRole ??
    (!access.isError && access.data?.state === "allowed"
      ? access.data.role
      : undefined);
  const canManageSharing =
    role === "owner" || role === "admin" || role === "editor";
  const linkOnly = Boolean(viewerReshareOnly || !canManageSharing);
  const createAgentLink = useActionMutation(
    "create-recording-agent-link" as any,
  );
  const agentPrompt = async () => {
    try {
      const origin = apiBaseUrl();
      const result =
        linkOnly && initialVisibility === "public" && hasPassword === false
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
  useEffect(() => setPasswordProtected(Boolean(hasPassword)), [hasPassword]);
  const blockViewerHandoff = Boolean(
    linkOnly &&
    initialVisibility !== "private" &&
    initialVisibility !== "org" &&
    (initialVisibility !== "public" || hasPassword !== false),
  );
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
      {...(!blockViewerHandoff && {
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
      linkOnly={linkOnly}
      accessNote={
        initialRole === undefined && !viewerReshareOnly && access.isError ? (
          <div role="alert" className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("clipsSettings.loadFailed")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void access.refetch()}
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        ) : undefined
      }
      hideSendTo={blockViewerHandoff}
      generalAccessExtras={(controller) => {
        const role = controller.data?.role ?? initialRole;
        return !linkOnly && controller.visibility === "public" ? (
          <RecordingPasswordAccess
            key={`${recordingId}:${session?.userId ?? ""}`}
            recordingId={recordingId}
            hasPassword={passwordProtected}
            canEdit={role === "owner" || role === "admin" || role === "editor"}
            onPasswordChange={setPasswordProtected}
          />
        ) : null;
      }}
    />
  );
}

function RecordingPasswordAccess({
  recordingId,
  hasPassword,
  canEdit,
  onPasswordChange,
}: {
  recordingId: string;
  hasPassword: boolean;
  canEdit: boolean;
  onPasswordChange: (hasPassword: boolean) => void;
}) {
  const t = useT();
  const updateRecording = useActionMutation("update-recording", {
    errorNotification: "shared",
  });
  const [passwordEnabled, setPasswordEnabled] = useState(hasPassword);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setPasswordEnabled(hasPassword);
  }, [hasPassword]);

  useEffect(() => {
    if (!canEdit) setPassword("");
  }, [canEdit]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const setPasswordRequired = (enabled: boolean) => {
    setPasswordEnabled(enabled);
    if (!enabled) {
      setPassword("");
      setCopied(false);
      setShowPassword(false);
    }
    if (enabled || !hasPassword) return;

    updateRecording.mutate(
      { id: recordingId, password: null },
      {
        onSuccess: () => onPasswordChange(false),
        onError: () => setPasswordEnabled(true),
      },
    );
  };

  const copyPassword = async () => {
    try {
      if (await writeClipboardText(password)) {
        setCopied(true);
        return;
      }
    } catch {
      toast.error(t("dictateRoute.copyFailed"));
      return;
    }
    toast.error(t("dictateRoute.copyFailed"));
  };

  return (
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
          disabled={!canEdit || updateRecording.isPending}
          onCheckedChange={setPasswordRequired}
        />
      </div>

      {passwordEnabled ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <InputGroup size="sm" data-private>
              <InputGroupInput
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                disabled={!canEdit}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setCopied(false);
                }}
                aria-label={t("playerSettings.passwordProtection")}
                placeholder={t("shareDialog.enterPassword")}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  disabled={!canEdit}
                  aria-label={t(
                    showPassword
                      ? "shareDialog.hidePassword"
                      : "shareDialog.showPassword",
                  )}
                  title={t(
                    showPassword
                      ? "shareDialog.hidePassword"
                      : "shareDialog.showPassword",
                  )}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <IconEyeOff className="size-4" />
                  ) : (
                    <IconEye className="size-4" />
                  )}
                </InputGroupButton>
                <InputGroupButton
                  size="icon-xs"
                  disabled={!canEdit || !password.trim()}
                  aria-label={
                    copied ? t("shareUi.copied") : t("shareDialog.copyPassword")
                  }
                  title={
                    copied ? t("shareUi.copied") : t("shareDialog.copyPassword")
                  }
                  onClick={() => void copyPassword()}
                >
                  {copied ? (
                    <IconCheck className="size-4" />
                  ) : (
                    <IconCopy className="size-4" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button
              type="button"
              size="sm"
              disabled={
                !canEdit || updateRecording.isPending || !password.trim()
              }
              onClick={() => {
                updateRecording.mutate(
                  { id: recordingId, password: password.trim() },
                  {
                    onSuccess: () => {
                      onPasswordChange(true);
                      setPassword(password.trim());
                    },
                    onError: () => setCopied(false),
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
  );
}
