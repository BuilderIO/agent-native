import { useT } from "@agent-native/core/client/i18n";
import {
  IconPlugConnected,
  IconPlugConnectedX,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { BridgeRegistrationFailureKind } from "./external-preview";

export function LocalNetworkAccessPrompt({
  kind,
  connecting,
  onConnect,
  onDismiss,
  proactive = false,
}: {
  kind: BridgeRegistrationFailureKind;
  connecting: boolean;
  onConnect: () => void;
  onDismiss: () => void;
  proactive?: boolean;
}) {
  const t = useT();
  // "unreachable" is the one confident case (permission is confirmed
  // granted, so it's confirmed NOT the cause) — every other kind is
  // deliberately hedged copy, never a diagnosed permission claim. See
  // classifyBridgeRegistrationFailure's doc comment for why.
  const isConfirmedUnreachable = kind === "unreachable";
  const isStalePreviewToken = kind === "stalePreviewToken";
  const title = proactive
    ? t("designCanvas.localBridge.permissionPromptTitle", {
        defaultValue: "Connect your local screens",
      })
    : isStalePreviewToken
      ? "Reconnect this screen" /* i18n-ignore stale local dev preview token title */
      : isConfirmedUnreachable
        ? "Local dev server unreachable" /* i18n-ignore local dev connect card title */
        : "Can't reach your local dev server" /* i18n-ignore local dev connect card title */;
  const description = proactive
    ? t("designCanvas.localBridge.permissionPromptDescription", {
        defaultValue: "Choose Allow in Chrome's prompt to enable live editing.",
      })
    : isStalePreviewToken
      ? "The local bridge restarted, so this screen's preview token is stale. Run design connect again, then click Retry." /* i18n-ignore stale local dev preview token body */
      : isConfirmedUnreachable
        ? "Is it still running?" /* i18n-ignore local dev connect card body */
        : "Your browser may need permission to connect to localhost — or the dev server may be offline." /* i18n-ignore local dev connect card body */;
  const actionLabel = connecting
    ? "Connecting…" /* i18n-ignore local dev connect card button, transient */
    : kind === "maybePermissionBlocked"
      ? t("designCanvas.localBridge.permissionPromptRetry", {
          defaultValue: "Retry connection",
        })
      : "Retry" /* i18n-ignore local dev connect card button */;
  const showPermissionHelp = proactive || kind === "maybePermissionBlocked";
  const noPromptLabel = t("designCanvas.localBridge.permissionPromptNoPrompt", {
    defaultValue: "No Chrome prompt?",
  });
  const permissionSettingsInstructions = t(
    "designCanvas.localBridge.permissionPromptSettingsInstructions",
    {
      defaultValue:
        "Click the site controls icon to the left of the address bar, open Site settings, then allow access to apps on your device.",
    },
  );
  const permissionHelp = showPermissionHelp ? (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{noPromptLabel}</summary>
      <p className="mt-2 leading-relaxed">{permissionSettingsInstructions}</p>
      <img
        src="/local-network-access-settings.png"
        alt={permissionSettingsInstructions}
        className="mt-3 block w-full rounded-md border border-border"
        width={1660}
        height={948}
        loading="lazy"
      />
    </details>
  ) : null;

  if (proactive) {
    return (
      <>
        <Dialog defaultOpen>
          <DialogContent
            className="sm:max-w-md"
            overlayClassName="backdrop-blur-[4px]"
            hideClose
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("designEditor.close")}
              className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onDismiss}
            >
              <IconX className="size-4" />
              <span className="sr-only">{t("designEditor.close")}</span>
            </Button>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconPlugConnected className="size-4" />
                {title}
              </DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <img
              src="/local-network-access-permission.png"
              alt={description}
              className="block w-full rounded-md border border-border"
              width={1654}
              height={951}
            />
            {permissionHelp}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <div className="pointer-events-auto relative flex w-full max-w-[22rem] flex-col items-start gap-3 rounded-lg border bg-card p-4 shadow-md">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 size-6"
          onClick={onDismiss}
        >
          <IconX className="size-3.5" />
          <span className="sr-only">
            {
              "Dismiss" /* i18n-ignore transient local dev connect card dismiss */
            }
          </span>
        </Button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent">
          {isConfirmedUnreachable || isStalePreviewToken ? (
            <IconPlugConnectedX className="size-4 text-accent-foreground" />
          ) : (
            <IconPlugConnected className="size-4 text-accent-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-0.5 pr-4">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {permissionHelp}
        <Button
          type="button"
          size="sm"
          onClick={onConnect}
          disabled={connecting}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
