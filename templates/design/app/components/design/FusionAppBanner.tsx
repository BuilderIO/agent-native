import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const SYNC_POLL_INTERVAL_MS = 8000;

export interface FusionAppBannerProps {
  designId: string;
  status: "building" | "ready" | "error";
  statusMessage?: string;
}

/** Canvas notice while a Builder app is building or failed to build. */
export function FusionAppBanner({
  designId,
  status,
  statusMessage,
}: FusionAppBannerProps) {
  const syncMutation = useActionMutation("sync-builder-app");
  const syncMutateRef = useRef(syncMutation.mutate);
  syncMutateRef.current = syncMutation.mutate;
  const syncInFlightRef = useRef(false);
  useEffect(() => {
    if (status !== "building") return;
    const runSync = (): void => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      syncMutateRef.current(
        { designId } as any,
        { onSettled: () => (syncInFlightRef.current = false) } as any,
      );
    };
    runSync();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      runSync();
    }, SYNC_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [designId, status]);

  if (status === "building") {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border/60 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        <Spinner className="size-3.5 shrink-0" />
        <span className="truncate">
          {
            "Building your app…" /* i18n-ignore fusion app banner, flag-gated feature */
          }
          {statusMessage ? ` ${statusMessage}` : ""}
        </span>
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
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 cursor-pointer gap-1 px-2 !text-[11px]"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate({ designId } as any)}
        >
          {syncMutation.isPending ? (
            <Spinner className="size-3" />
          ) : (
            <IconRefresh className="size-3" />
          )}
          {"Retry" /* i18n-ignore fusion app banner, flag-gated feature */}
        </Button>
      </div>
    );
  }

  // A ready app has no banner: Preview, Publish, Push and queued edits live
  // in the top-right app menu (FusionAppMenu).
  return null;
}
