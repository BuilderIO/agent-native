import { IconExternalLink, IconGauge } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ContextManifest,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { cn } from "../utils.js";
import { ContextXRayPanel } from "./ContextXRayPanel.js";
import {
  CONTEXT_XRAY_MODEL_LIMIT,
  formatTokens,
  groupColor,
} from "./format.js";

export function ContextMeter({ threadId }: { threadId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Map<string, ContextSegmentStatus>
  >(new Map());
  const currentThreadId = useRef(threadId);
  const query = useActionQuery(
    "context-manifest-get",
    threadId ? { threadId } : undefined,
    {
      enabled: Boolean(threadId),
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
    if (!threadId || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantsXray = params.get("contextXray") === "1";
    const targetThread = params.get("threadId");
    if (wantsXray && (!targetThread || targetThread === threadId)) {
      setOpen(true);
    }
  }, [threadId]);

  const manifest = query.data;
  const segments = manifest?.segments ?? [];
  const pct = manifest
    ? Math.min(
        100,
        Math.round((manifest.totalTokens / CONTEXT_XRAY_MODEL_LIMIT) * 100),
      )
    : 0;
  const visibleGroups = useMemo(() => {
    const totals = new Map<string, number>();
    for (const segment of segments) {
      if (segment.status === "evicted") continue;
      const group = segment.status === "pinned" ? "Pinned" : segment.group;
      totals.set(group, (totals.get(group) ?? 0) + segment.tokenCount);
    }
    const total = [...totals.values()].reduce((sum, n) => sum + n, 0);
    return [...totals.entries()].map(([group, tokens]) => ({
      group,
      tokens,
      pct: total > 0 ? (tokens / total) * 100 : 0,
    }));
  }, [segments]);

  if (!threadId || !manifest || manifest.rawTokens <= 0) return null;

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
    <TooltipProvider delayDuration={200}>
      <div className="shrink-0 px-3 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left hover:bg-accent/40"
            >
              <IconGauge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    Context {pct}% · {formatTokens(manifest.totalTokens)}
                  </span>
                  <span className="flex items-center gap-1">
                    {!manifest.enforceable && "Advisory"}
                    <IconExternalLink className="h-3 w-3" />
                  </span>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                  {visibleGroups.map((group) => (
                    <span
                      key={group.group}
                      className={cn("h-full", groupColor(group.group))}
                      style={{ width: `${group.pct}%` }}
                    />
                  ))}
                </div>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent>Open Context X-Ray</TooltipContent>
        </Tooltip>
      </div>
      <ContextXRayPanel
        open={open}
        onOpenChange={setOpen}
        manifest={manifest}
        optimistic={optimistic}
        onPin={(segmentId) => mutateStatus(segmentId, "pinned", "pin")}
        onEvict={(segmentId) => mutateStatus(segmentId, "evicted", "evict")}
        onRestore={(segmentId) => mutateStatus(segmentId, "active", "restore")}
      />
    </TooltipProvider>
  );
}
