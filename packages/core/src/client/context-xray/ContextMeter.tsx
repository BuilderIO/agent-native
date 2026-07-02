import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type {
  ContextManifest,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { cn } from "../utils.js";
import { formatTokens, resolveContextWindow } from "./format.js";

const ContextXRayPanel = lazy(() =>
  import("./ContextXRayPanel.js").then((m) => ({
    default: m.ContextXRayPanel,
  })),
);

function ContextDonut({ pct, advisory }: { pct: number; advisory: boolean }) {
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const displayPct = Math.max(3, Math.min(100, pct));
  const dashOffset = circumference - (displayPct / 100) * circumference;

  return (
    <span className="relative flex size-5 items-center justify-center">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="-rotate-90 size-5">
        <circle
          cx="10"
          cy="10"
          r={radius}
          className="stroke-muted"
          fill="none"
          strokeWidth="3"
        />
        <circle
          cx="10"
          cy="10"
          r={radius}
          className={cn(advisory ? "stroke-amber-500" : "stroke-[#00B5FF]")}
          fill="none"
          strokeLinecap="round"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute size-2 rounded-full bg-background" />
    </span>
  );
}

export function ContextMeter({
  threadId,
  enabled = true,
}: {
  threadId?: string | null;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Map<string, ContextSegmentStatus>
  >(new Map());
  const currentThreadId = useRef(threadId);
  const shouldQuery = Boolean(threadId && enabled);
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

  const manifest = query.data;
  const contextWindow = resolveContextWindow(manifest?.model);
  const pct = manifest
    ? Math.min(100, Math.round((manifest.totalTokens / contextWindow) * 100))
    : 0;

  if (!shouldQuery || !threadId || !manifest || manifest.rawTokens <= 0) {
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
    <TooltipProvider delayDuration={200}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Context ${pct}%, ${formatTokens(
                  manifest.totalTokens,
                )}. Open Context X-Ray.`}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  open && "bg-accent/60 text-foreground",
                )}
              >
                <ContextDonut pct={pct} advisory={!manifest.enforceable} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            Context {pct}% · {formatTokens(manifest.totalTokens)}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[min(92vw,380px)] overflow-hidden border-border/70 p-0"
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
                onEvict={(segmentId) =>
                  mutateStatus(segmentId, "evicted", "evict")
                }
                onRestore={(segmentId) =>
                  mutateStatus(segmentId, "active", "restore")
                }
              />
            </Suspense>
          ) : null}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
