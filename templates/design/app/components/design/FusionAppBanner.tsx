import { useActionMutation } from "@agent-native/core/client/hooks";
import { APP_STARTING_MESSAGE } from "@shared/full-app";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const SYNC_POLL_INTERVAL_MS = 8000;

export interface FusionAppBannerProps {
  designId: string;
  status: "building" | "ready" | "error";
  statusMessage?: string;
  /** The app was built before, so a non-ready app is waking, not building. */
  built?: boolean;
  /** Checking the app takes edit access; viewers see the saved status. */
  canSync?: boolean;
}

/** Canvas notice while a Builder app is building or failed to build. */
export function FusionAppBanner({
  designId,
  status,
  statusMessage,
  built = false,
  canSync = true,
}: FusionAppBannerProps) {
  const syncMutation = useActionMutation("sync-builder-app");
  const syncMutateRef = useRef(syncMutation.mutate);
  syncMutateRef.current = syncMutation.mutate;
  const syncInFlightRef = useRef(false);
  const runSync = useCallback((): void => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    syncMutateRef.current(
      { designId },
      {
        onSettled: () => {
          syncInFlightRef.current = false;
        },
      },
    );
  }, [designId]);
  // A container saved as ready may have gone to sleep since: check it once
  // on open. One that is starting is then polled until it is up.
  useEffect(() => {
    if (canSync) runSync();
  }, [canSync, runSync]);
  useEffect(() => {
    if (!canSync || status !== "building") return;
    runSync();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      runSync();
    }, SYNC_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [canSync, runSync, status]);

  // A check that failed for this editor (e.g. no Builder access) isn't saved
  // to the app, so it shows only here while the app is starting.
  const checkError =
    syncMutation.data?.status === "error" ? syncMutation.data.message : null;

  if (status === "building") {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border/60 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        <Spinner className="size-3.5 shrink-0" />
        <span className="truncate">
          {
            built
              ? "Starting your app…" /* i18n-ignore fusion app banner, flag-gated feature */
              : "Building your app…" /* i18n-ignore fusion app banner, flag-gated feature */
          }
          {statusMessage && statusMessage !== APP_STARTING_MESSAGE
            ? ` ${statusMessage}`
            : ""}
        </span>
        {checkError ? (
          <span className="min-w-0 truncate text-destructive">
            {checkError}
          </span>
        ) : null}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border/60 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <IconAlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 truncate text-destructive">
          {
            statusMessage ||
              "Couldn't build your app" /* i18n-ignore fusion app banner, flag-gated feature */
          }
        </span>
        {canSync ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 cursor-pointer gap-1 px-2 !text-[11px]"
            disabled={syncMutation.isPending}
            onClick={runSync}
          >
            {syncMutation.isPending ? (
              <Spinner className="size-3" />
            ) : (
              <IconRefresh className="size-3" />
            )}
            {"Retry" /* i18n-ignore fusion app banner, flag-gated feature */}
          </Button>
        ) : null}
      </div>
    );
  }

  // A ready app has no banner: Preview, Publish, Push and queued edits live
  // in the top-right app menu (FusionAppMenu).
  return null;
}
