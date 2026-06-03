import {
  IconAdjustmentsHorizontal,
  IconChartTreemap,
  IconChevronDown,
  IconChevronRight,
  IconListDetails,
  IconPin,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type {
  ContextManifest,
  ContextManifestSegment,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";
import { ContextSegmentRow } from "./ContextSegmentRow.js";
import { ContextTreemap } from "./ContextTreemap.js";
import {
  CONTEXT_XRAY_MODEL_LIMIT,
  formatTokens,
  groupColor,
} from "./format.js";

interface Group {
  name: string;
  tokens: number;
  segments: ContextManifestSegment[];
}

function applyOptimisticStatus(
  segments: ContextManifestSegment[],
  optimistic: Map<string, ContextSegmentStatus>,
): ContextManifestSegment[] {
  if (optimistic.size === 0) return segments;
  return segments.map((segment) => {
    const status = optimistic.get(segment.segmentId);
    return status ? { ...segment, status } : segment;
  });
}

function groupedSegments(segments: ContextManifestSegment[]): Group[] {
  const map = new Map<string, Group>();
  for (const segment of segments) {
    const groupName =
      segment.status === "pinned"
        ? "Pinned"
        : segment.status === "evicted"
          ? "Evicted"
          : segment.group;
    const group = map.get(groupName) ?? {
      name: groupName,
      tokens: 0,
      segments: [],
    };
    group.tokens += segment.tokenCount;
    group.segments.push(segment);
    map.set(groupName, group);
  }
  const order = [
    "Pinned",
    "Tool results",
    "Files read",
    "Conversation",
    "Thinking",
    "Evicted",
  ];
  return [...map.values()].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return b.tokens - a.tokens;
  });
}

function StatusLine({ manifest }: { manifest: ContextManifest }) {
  const pinned = manifest.segments.filter((s) => s.status === "pinned").length;
  const evicted = manifest.segments.filter(
    (s) => s.status === "evicted",
  ).length;
  const estimate = manifest.tokenCountMethod === "estimate";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span>Pinned {pinned}</span>
      <span>·</span>
      <span>Evicted {evicted}</span>
      {estimate && (
        <>
          <span>·</span>
          <span>token counts estimated</span>
        </>
      )}
      {!manifest.enforceable && (
        <>
          <span>·</span>
          <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
            Advisory
          </span>
        </>
      )}
    </div>
  );
}

export function ContextXRayPanel({
  open,
  onOpenChange,
  manifest,
  optimistic,
  onPin,
  onEvict,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: ContextManifest;
  optimistic: Map<string, ContextSegmentStatus>;
  onPin: (segmentId: string) => void;
  onEvict: (segmentId: string) => void;
  onRestore: (segmentId: string) => void;
}) {
  const [mode, setMode] = useState<"list" | "map">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const segments = useMemo(
    () => applyOptimisticStatus(manifest.segments, optimistic),
    [manifest.segments, optimistic],
  );
  const groups = useMemo(() => groupedSegments(segments), [segments]);
  const pct = Math.min(
    100,
    Math.round((manifest.totalTokens / CONTEXT_XRAY_MODEL_LIMIT) * 100),
  );
  const headroom = Math.max(0, CONTEXT_XRAY_MODEL_LIMIT - manifest.totalTokens);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-[460px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2">
            <IconAdjustmentsHorizontal className="h-4 w-4" />
            Context X-Ray
          </SheetTitle>
          <SheetDescription>
            {manifest.enforceable
              ? "Pinned items survive compaction. Evicted items are excluded, not deleted."
              : "Advisory mode records intent for an external host."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xl font-semibold text-foreground">
                  {formatTokens(manifest.totalTokens)} /{" "}
                  {formatTokens(CONTEXT_XRAY_MODEL_LIMIT)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {pct}% · {formatTokens(headroom)} headroom
                </div>
              </div>
              {manifest.reclaimedTokens > 0 && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  -{formatTokens(manifest.reclaimedTokens)}
                </div>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <StatusLine manifest={manifest} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
              <button
                type="button"
                onClick={() => setMode("list")}
                className={cn(
                  "flex h-7 items-center gap-1 rounded px-2 text-xs",
                  mode === "list" && "bg-background shadow-sm",
                )}
              >
                <IconListDetails className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => setMode("map")}
                className={cn(
                  "flex h-7 items-center gap-1 rounded px-2 text-xs",
                  mode === "map" && "bg-background shadow-sm",
                )}
              >
                <IconChartTreemap className="h-3.5 w-3.5" />
                Map
              </button>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconPin className="h-3.5 w-3.5" />
                  survives compaction
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Pinned segments stay in future context
              </TooltipContent>
            </Tooltip>
          </div>

          {mode === "map" ? (
            <ContextTreemap
              segments={segments}
              onSelect={(segmentId) => {
                const segment = segments.find((s) => s.segmentId === segmentId);
                if (segment) setCollapsed(new Set());
              }}
            />
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.name);
                return (
                  <div
                    key={group.name}
                    className="rounded-md border border-border"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.name)) next.delete(group.name);
                          else next.add(group.name);
                          return next;
                        });
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                    >
                      {isCollapsed ? (
                        <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          groupColor(group.name),
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {group.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatTokens(group.tokens)}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="border-t border-border py-1">
                        {group.segments
                          .slice()
                          .sort((a, b) => b.tokenCount - a.tokenCount)
                          .map((segment) => (
                            <ContextSegmentRow
                              key={segment.segmentId}
                              segment={segment}
                              advisory={!manifest.enforceable}
                              onPin={() => onPin(segment.segmentId)}
                              onEvict={() => onEvict(segment.segmentId)}
                              onRestore={() => onRestore(segment.segmentId)}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
