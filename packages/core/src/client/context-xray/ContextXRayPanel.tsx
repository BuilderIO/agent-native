import {
  IconChartTreemap,
  IconChevronDown,
  IconChevronRight,
  IconLock,
  IconListDetails,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type {
  ContextManifest,
  ContextManifestSegment,
  ContextManifestSystemSection,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  manifestConversationTokens,
  manifestSystemTokens,
} from "../../shared/context-xray.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";
import { ContextSegmentRow } from "./ContextSegmentRow.js";
import { ContextTreemap } from "./ContextTreemap.js";
import { formatTokens, groupColor, resolveContextWindow } from "./format.js";

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

const GOVERNANCE_ORDER = ["required", "inherited", "user"] as const;

function governanceLabel(
  governance: ContextManifestSystemSection["governance"],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (governance) {
    case "required":
      return t("contextXray.governance.required", {
        defaultValue: "Required",
      });
    case "inherited":
      return t("contextXray.governance.inherited", {
        defaultValue: "Inherited",
      });
    case "user":
      return t("contextXray.governance.user", {
        defaultValue: "Your context",
      });
  }
}

function sourceLabel(section: ContextManifestSystemSection): string {
  return (
    section.sourceRef?.path ??
    section.sourceRef?.resourceId ??
    section.sourceRef?.scope ??
    "framework"
  );
}

function SystemSectionRow({
  section,
  totalTokens,
}: {
  section: ContextManifestSystemSection;
  totalTokens: number;
}) {
  const share =
    totalTokens > 0 ? Math.round((section.tokenCount / totalTokens) * 100) : 0;
  return (
    <div className="flex min-h-12 items-start gap-2 rounded-sm px-2 py-1.5">
      <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        <IconLock className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-5 text-foreground">
          {section.label}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {sourceLabel(section)} · {formatTokens(section.tokenCount)} tokens ·{" "}
          {share}%{section.tokenMethod === "estimate" ? " · estimated" : ""}
        </div>
        {section.preview ? (
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/80">
            {section.preview}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ContextXRayPanel({
  manifest,
  optimistic,
  onPin,
  onEvict,
  onRestore,
}: {
  manifest: ContextManifest;
  optimistic: Map<string, ContextSegmentStatus>;
  onPin: (segmentId: string) => void;
  onEvict: (segmentId: string) => void;
  onRestore: (segmentId: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"list" | "map">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const segments = useMemo(
    () => applyOptimisticStatus(manifest.segments, optimistic),
    [manifest.segments, optimistic],
  );
  const groups = useMemo(() => groupedSegments(segments), [segments]);
  const systemSections = manifest.systemSections ?? [];
  const systemGroups = useMemo(() => {
    const grouped = new Map<
      ContextManifestSystemSection["governance"],
      ContextManifestSystemSection[]
    >();
    for (const section of systemSections) {
      const list = grouped.get(section.governance) ?? [];
      list.push(section);
      grouped.set(section.governance, list);
    }
    return GOVERNANCE_ORDER.flatMap((governance) => {
      const sections = grouped.get(governance);
      return sections && sections.length > 0
        ? [
            {
              governance,
              sections,
              tokens: sections.reduce(
                (sum, section) => sum + section.tokenCount,
                0,
              ),
            },
          ]
        : [];
    });
  }, [systemSections]);
  const contextWindow = resolveContextWindow(manifest.model);
  const pct = Math.min(
    100,
    Math.round((manifest.totalTokens / contextWindow) * 100),
  );
  const headroom = Math.max(0, contextWindow - manifest.totalTokens);
  const pinned = segments.filter((s) => s.status === "pinned").length;
  const evicted = segments.filter((s) => s.status === "evicted").length;
  const systemTokens = manifestSystemTokens(manifest);
  const conversationTokens = manifestConversationTokens(manifest);
  const details = [
    `${formatTokens(headroom)} free`,
    systemTokens > 0 ? `${formatTokens(systemTokens)} system` : null,
    `${formatTokens(conversationTokens)} conversation`,
    pinned > 0 ? `${pinned} pinned` : null,
    evicted > 0 ? `${evicted} evicted` : null,
    manifest.tokenCountMethod === "estimate" ? "estimated" : null,
    !manifest.enforceable ? "advisory" : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="flex max-h-[min(72vh,520px)] flex-col">
      <div className="border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
            Context X-Ray
          </h2>
          <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTokens(manifest.totalTokens)} · {pct}%
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/70">
          <div
            className="h-full rounded-full bg-foreground origin-left transition-transform duration-200"
            style={{
              transform: `scaleX(${Math.min(1, pct / 100)})`,
              width: "100%",
            }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
          {manifest.reclaimedTokens > 0 && (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              -{formatTokens(manifest.reclaimedTokens)}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-y-auto px-2 py-2">
        <div className="mb-1 flex items-center justify-end">
          <div className="inline-flex rounded-md bg-muted/40 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  aria-label="Show context list"
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground",
                    mode === "list"
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                >
                  <IconListDetails className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>List</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setMode("map")}
                  aria-label="Show context map"
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground",
                    mode === "map"
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                >
                  <IconChartTreemap className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Map</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {mode === "map" ? (
          <ContextTreemap
            segments={segments}
            systemSections={systemSections}
            onSelect={(segmentId) => {
              const segment = segments.find((s) => s.segmentId === segmentId);
              if (segment) setCollapsed(new Set());
            }}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {systemGroups.length > 0 && (
              <div>
                <div className="px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t("contextXray.systemOrdered", {
                    defaultValue: "System · ordered, not evictable",
                  })}
                </div>
                {systemGroups.map((group) => {
                  const groupKey = `system:${group.governance}`;
                  const isCollapsed = collapsed.has(groupKey);
                  return (
                    <div key={groupKey}>
                      <button
                        type="button"
                        onClick={() => {
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(groupKey)) next.delete(groupKey);
                            else next.add(groupKey);
                            return next;
                          });
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-2 text-left hover:bg-accent/35"
                      >
                        {isCollapsed ? (
                          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <IconLock className="h-3 w-3 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {governanceLabel(group.governance, t)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatTokens(group.tokens)} ·{" "}
                          {manifest.totalTokens > 0
                            ? Math.round(
                                (group.tokens / manifest.totalTokens) * 100,
                              )
                            : 0}
                          %
                        </span>
                      </button>
                      {!isCollapsed && (
                        <div className="pb-1">
                          {group.sections
                            .slice()
                            .sort((a, b) => b.tokenCount - a.tokenCount)
                            .map((section) => (
                              <SystemSectionRow
                                key={section.segmentId}
                                section={section}
                                totalTokens={manifest.totalTokens}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name);
              return (
                <div key={group.name}>
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
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-2 text-left hover:bg-accent/35"
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
                    <div className="pb-1">
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
    </div>
  );
}
