import {
  IconPlugConnected,
  IconPlugConnectedX,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

import type { BridgeRegistrationFailureKind } from "./external-preview";

/**
 * Non-blocking floating card shown over a localhost screen when the live-edit
 * bridge can't be reached. Deliberately NOT a full-cover overlay: the real
 * iframe underneath (see `externalPreviewUrl`'s raw-URL fallback in
 * DesignCanvas.tsx) is still rendering the actual running app, so this stays a
 * small corner card the user can act on or dismiss without losing the view —
 * mirrors the liveEditSameInstanceStalledError banner pattern just above it.
 */
export function LocalNetworkAccessPrompt({
  kind,
  connecting,
  onConnect,
  onDismiss,
}: {
  kind: BridgeRegistrationFailureKind;
  connecting: boolean;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  // "unreachable" is the one confident case (permission is confirmed
  // granted, so it's confirmed NOT the cause) — every other kind is
  // deliberately hedged copy, never a diagnosed permission claim. See
  // classifyBridgeRegistrationFailure's doc comment for why.
  const isConfirmedUnreachable = kind === "unreachable";
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
          {isConfirmedUnreachable ? (
            <IconPlugConnectedX className="size-4 text-accent-foreground" />
          ) : (
            <IconPlugConnected className="size-4 text-accent-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-0.5 pr-4">
          <div className="text-sm font-medium text-foreground">
            {
              isConfirmedUnreachable
                ? "Local dev server unreachable" /* i18n-ignore local dev connect card title */
                : "Can't reach your local dev server" /* i18n-ignore local dev connect card title */
            }
          </div>
          <div className="text-xs text-muted-foreground">
            {
              isConfirmedUnreachable
                ? "Is it still running?" /* i18n-ignore local dev connect card body */
                : "Your browser may need permission to connect to localhost — or the dev server may be offline." /* i18n-ignore local dev connect card body */
            }
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onConnect}
          disabled={connecting}
        >
          {
            connecting
              ? "Connecting…" /* i18n-ignore local dev connect card button, transient */
              : isConfirmedUnreachable
                ? "Retry" /* i18n-ignore local dev connect card button */
                : "Connect" /* i18n-ignore local dev connect card button */
          }
        </Button>
      </div>
    </div>
  );
}
