import { ContextMeterView } from "@agent-native/toolkit/context-ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type {
  ContextManifest,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  manifestConversationTokens,
  manifestSystemTokens,
} from "../../shared/context-xray.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { resolveContextWindow } from "./format.js";

const ContextXRayPanel = lazy(() =>
  import("./ContextXRayPanel.js").then((m) => ({
    default: m.ContextXRayPanel,
  })),
);

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
  const query = useActionQuery(
    "context-manifest-get",
    shouldQuery && threadId ? { threadId } : undefined,
    {
      enabled: shouldQuery,
      staleTime: 1000,
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
  if (
    (!shouldQuery && !providedManifest) ||
    !manifest ||
    (manifest.rawTokens <= 0 && manifest.totalTokens <= 0)
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
