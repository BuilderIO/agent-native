import { ContextMeterView } from "@agent-native/toolkit/context-ui";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ContextManifest,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  manifestConversationTokens,
  manifestSystemTokens,
  resolveManifestFreshness,
} from "../../shared/context-xray.js";
import { ACTIVE_RUN_STATE_EVENT, getActiveRun } from "../active-run-state.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { resolveContextWindow } from "./format.js";

const ContextXRayPanel = lazy(() =>
  import("./ContextXRayPanel.js").then((m) => ({
    default: m.ContextXRayPanel,
  })),
);

/**
 * Poll interval used only while a run is streaming. The manifest is persisted
 * through `application_state`, and `useDbSync` deliberately does NOT fan
 * `app-state` events out into `["action"]` invalidation, so without this the
 * meter keeps showing whatever it fetched when the thread mounted.
 */
const ACTIVE_RUN_REFETCH_MS = 5000;

function subscribeToActiveRun(onChange: () => void): () => void {
  window.addEventListener(ACTIVE_RUN_STATE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ACTIVE_RUN_STATE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function useRunActiveForThread(threadId?: string | null): boolean {
  return useSyncExternalStore(
    subscribeToActiveRun,
    () => {
      if (!threadId) return false;
      const run = getActiveRun();
      return Boolean(run && run.threadId === threadId && run.runId);
    },
    () => false,
  );
}

export function ContextMeter({
  threadId,
  manifest: providedManifest,
  enabled = true,
}: {
  threadId?: string | null;
  manifest?: ContextManifest | null;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Map<string, ContextSegmentStatus>
  >(new Map());
  const currentThreadId = useRef(threadId);
  const shouldQuery = Boolean(threadId && enabled && !providedManifest);
  const runActive = useRunActiveForThread(threadId);
  const query = useActionQuery(
    "context-manifest-get",
    shouldQuery && threadId ? { threadId } : undefined,
    {
      enabled: shouldQuery,
      staleTime: 1000,
      refetchInterval: runActive ? ACTIVE_RUN_REFETCH_MS : false,
    },
  ) as { data?: ContextManifest };
  const pin = useActionMutation("context-pin");
  const evict = useActionMutation("context-evict");
  const restore = useActionMutation("context-restore");

  useEffect(() => {
    currentThreadId.current = threadId;
    setOptimistic(new Map());
  }, [threadId]);

  useEffect(() => {
    if (!threadId || !enabled || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantsXray = params.get("contextXray") === "1";
    const targetThread = params.get("threadId");
    if (wantsXray && (!targetThread || targetThread === threadId)) {
      setOpen(true);
    }
  }, [enabled, threadId]);

  const manifest = providedManifest ?? query.data;
  const freshness = resolveManifestFreshness({
    manifest,
    latestTurnId: manifest?.latestTurnId,
    latestTurnStartedAt: manifest?.latestTurnStartedAt,
  });
  // A known-failed write still renders (as an em dash): hiding the meter is
  // indistinguishable from "this thread has used no context yet".
  const noReading =
    !!manifest && manifest.rawTokens <= 0 && manifest.totalTokens <= 0;
  if (
    (!shouldQuery && !providedManifest) ||
    !manifest ||
    (noReading && manifest.writeStatus !== "failed")
  ) {
    return null;
  }

  const mutateStatus = (
    segmentId: string,
    status: ContextSegmentStatus,
    action: "pin" | "evict" | "restore",
  ) => {
    const previous = new Map(optimistic);
    setOptimistic((prev) => new Map(prev).set(segmentId, status));
    const params = { threadId, segmentId };
    const options = {
      onError: () => {
        if (currentThreadId.current === threadId) {
          setOptimistic(previous);
        }
      },
    };
    if (action === "pin") pin.mutate(params, options);
    if (action === "evict") evict.mutate(params, options);
    if (action === "restore") restore.mutate(params, options);
  };

  return (
    <ContextMeterView
      manifest={{
        ...manifest,
        systemTokens: manifestSystemTokens(manifest),
        conversationTokens: manifestConversationTokens(manifest),
      }}
      contextWindow={resolveContextWindow(manifest.model)}
      freshness={freshness}
      open={open}
      onOpenChange={setOpen}
    >
      {open ? (
        <Suspense
          fallback={
            <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
              Loading context view…
            </div>
          }
        >
          <ContextXRayPanel
            manifest={manifest}
            optimistic={optimistic}
            onPin={(segmentId) => mutateStatus(segmentId, "pinned", "pin")}
            onEvict={(segmentId) => mutateStatus(segmentId, "evicted", "evict")}
            onRestore={(segmentId) =>
              mutateStatus(segmentId, "active", "restore")
            }
          />
        </Suspense>
      ) : null}
    </ContextMeterView>
  );
}
