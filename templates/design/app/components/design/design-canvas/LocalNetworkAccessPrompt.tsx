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
  DialogFooter,
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
  // deliberately hedged copy, never a diagnosed permission claim. See
  const isConfirmedUnreachable = kind === "unreachable";
  const isStalePreviewToken = kind === "stalePreviewToken";
  const title = proactive
    ? "Connect your local screens" /* i18n-ignore first-land localhost permission dialog title */
    : isStalePreviewToken
      ? "Reconnect this screen" /* i18n-ignore stale local dev preview token title */
      : isConfirmedUnreachable
        ? "Local dev server unreachable" /* i18n-ignore local dev connect card title */
        : "Can't reach your local dev server" /* i18n-ignore local dev connect card title */;
  const description = proactive
    ? "Allow this Design tab to connect to your localhost app so live layers can load and be edited. Click Allow if Chrome asks." /* i18n-ignore first-land localhost permission dialog body */
    : isStalePreviewToken
      ? "The local bridge restarted, so this screen's preview token is stale. Run design connect again, then click Retry." /* i18n-ignore stale local dev preview token body */
      : isConfirmedUnreachable
        ? "Is it still running?" /* i18n-ignore local dev connect card body */
        : "Your browser may need permission to connect to localhost — or the dev server may be offline." /* i18n-ignore local dev connect card body */;
  const actionLabel = connecting
    ? "Connecting…" /* i18n-ignore local dev connect card button, transient */
    : proactive
      ? "Allow local access" /* i18n-ignore first-land localhost permission dialog button */
      : isStalePreviewToken || isConfirmedUnreachable
        ? "Retry" /* i18n-ignore local dev connect card button */
        : "Connect" /* i18n-ignore local dev connect card button */;

  if (proactive) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconPlugConnected className="size-4" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={onConnect} disabled={connecting}>
              {actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
