import {
  IconChartTreemap,
  IconChevronDown,
  IconChevronRight,
  IconLock,
  IconListDetails,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { ContextSegmentRowView } from "./ContextSegmentRow.js";
import { ContextTreemapView } from "./ContextTreemap.js";
import { contextGroupColor, formatContextTokens } from "./format.js";
import type {
  ContextManifestViewData,
  ContextSegmentStatus,
  ContextSegmentViewData,
  ContextSystemSectionViewData,
  ContextTranslate,
} from "./types.js";
import { fallbackContextTranslate } from "./types.js";

interface Group {
  name: string;
  label: string;
  tokens: number;
  segments: ContextSegmentViewData[];
}

function groupLabel(name: string, translate: ContextTranslate): string {
  if (name === "Pinned")
    return translate("agentChat.contextXray.groups.pinned", {
      defaultValue: name,
    });
  if (name === "Tool results")
    return translate("agentChat.contextXray.groups.toolResults", {
      defaultValue: name,
    });
  if (name === "Files read")
    return translate("agentChat.contextXray.groups.filesRead", {
      defaultValue: name,
    });
  if (name === "Conversation")
    return translate("agentChat.contextXray.groups.conversation", {
      defaultValue: name,
    });
  if (name === "Thinking")
    return translate("agentChat.contextXray.groups.thinking", {
      defaultValue: name,
    });
  if (name === "Evicted")
    return translate("agentChat.contextXray.groups.evicted", {
      defaultValue: name,
    });
  if (name === "Task & instructions")
    return translate("agentChat.contextXray.groups.taskInstructions", {
      defaultValue: name,
    });
  return name;
}

function applyOptimisticStatus(
  segments: ContextSegmentViewData[],
  optimistic: Map<string, ContextSegmentStatus>,
) {
  if (optimistic.size === 0) return segments;
  return segments.map((segment) =>
    optimistic.has(segment.segmentId)
      ? { ...segment, status: optimistic.get(segment.segmentId)! }
      : segment,
  );
}

function groupedSegments(
  segments: ContextSegmentViewData[],
  translate: ContextTranslate,
): Group[] {
  const map = new Map<string, Group>();
  for (const segment of segments) {
    const name =
      segment.status === "pinned"
        ? "Pinned"
        : segment.status === "evicted"
          ? "Evicted"
          : segment.group;
    const group = map.get(name) ?? {
      name,
      label: groupLabel(name, translate),
      tokens: 0,
      segments: [],
    };
    group.tokens += segment.tokenCount;
    group.segments.push(segment);
    map.set(name, group);
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
    return ai >= 0 || bi >= 0
      ? (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
      : b.tokens - a.tokens;
  });
}

function sourceLabel(
  section: ContextSystemSectionViewData,
  translate: ContextTranslate,
) {
  const scope = section.sourceRef?.scope;
  const localizedScope =
    scope === "framework"
      ? translate("agentChat.contextXray.framework", {
          defaultValue: "framework",
        })
      : scope;
  return (
    section.sourceRef?.path ??
    section.sourceRef?.resourceId ??
    localizedScope ??
    translate("agentChat.contextXray.framework", {
      defaultValue: "framework",
    })
  );
}

function SystemSectionRow({
  section,
  totalTokens,
  translate,
}: {
  section: ContextSystemSectionViewData;
  totalTokens: number;
  translate: ContextTranslate;
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
          {sourceLabel(section, translate)} ·{" "}
          {formatContextTokens(section.tokenCount)}{" "}
          {translate("agentChat.contextXray.tokensShare", {
            defaultValue: "tokens · {{share}}%",
            share,
          })}
          {section.tokenMethod === "estimate"
            ? translate("agentChat.contextXray.estimatedSuffix", {
                defaultValue: " · estimated",
              })
            : ""}
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

export function ContextXRayPanelView({
  manifest,
  contextWindow,
  optimistic,
  onPin,
  onEvict,
  onRestore,
  governanceLabels = {},
  systemOrderedLabel = "System · ordered, not evictable",
  titleLabel = "Context X-Ray",
  translate = fallbackContextTranslate,
}: {
  manifest: ContextManifestViewData;
  contextWindow: number;
  optimistic: Map<string, ContextSegmentStatus>;
  onPin: (segmentId: string) => void;
  onEvict: (segmentId: string) => void;
  onRestore: (segmentId: string) => void;
  governanceLabels?: Partial<Record<"required" | "inherited" | "user", string>>;
  systemOrderedLabel?: string;
  titleLabel?: string;
  translate?: ContextTranslate;
}) {
  const [mode, setMode] = useState<"list" | "map">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const segments = useMemo(
    () => applyOptimisticStatus(manifest.segments, optimistic),
    [manifest.segments, optimistic],
  );
  const groups = useMemo(
    () => groupedSegments(segments, translate),
    [segments, translate],
  );
  const sections = manifest.systemSections ?? [];
  const systemGroups = useMemo(
    () =>
      (["required", "inherited", "user"] as const).flatMap((governance) => {
        const items = sections.filter(
          (section) => section.governance === governance,
        );
        return items.length
          ? [
              {
                governance,
                sections: items,
                tokens: items.reduce(
                  (sum, section) => sum + section.tokenCount,
                  0,
                ),
              },
            ]
          : [];
      }),
    [sections],
  );
  const pct = Math.min(
    100,
    Math.round((manifest.totalTokens / contextWindow) * 100),
  );
  const headroom = Math.max(0, contextWindow - manifest.totalTokens);
  const { conversationTokens: conversation, systemTokens: system } = manifest;
  const pinned = segments.filter(
    (segment) => segment.status === "pinned",
  ).length;
  const evicted = segments.filter(
    (segment) => segment.status === "evicted",
  ).length;
  const details = [
    translate("agentChat.contextXray.free", {
      defaultValue: "{{count}} free",
      count: formatContextTokens(headroom),
    }),
    system > 0
      ? translate("agentChat.contextXray.system", {
          defaultValue: "{{count}} system",
          count: formatContextTokens(system),
        })
      : null,
    translate("agentChat.contextXray.conversation", {
      defaultValue: "{{count}} conversation",
      count: formatContextTokens(conversation),
    }),
    pinned > 0
      ? translate("agentChat.contextXray.pinned", {
          defaultValue: "{{count}} pinned",
          count: pinned,
        })
      : null,
    evicted > 0
      ? translate("agentChat.contextXray.evicted", {
          defaultValue: "{{count}} evicted",
          count: evicted,
        })
      : null,
    manifest.tokenCountMethod === "estimate"
      ? translate("agentChat.contextXray.estimated", {
          defaultValue: "estimated",
        })
      : null,
    !manifest.enforceable
      ? translate("agentChat.contextXray.advisory", {
          defaultValue: "advisory",
        })
      : null,
  ].filter((item): item is string => Boolean(item));
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="flex max-h-[min(72vh,520px)] flex-col">
      <div className="border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
            {titleLabel}
          </h2>
          <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatContextTokens(manifest.totalTokens)} · {pct}%
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/70">
          <div
            className="h-full w-full origin-left rounded-full bg-foreground transition-transform duration-200 rtl:origin-right"
            style={{ transform: `scaleX(${Math.min(1, pct / 100)})` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
          {manifest.reclaimedTokens > 0 ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              -{formatContextTokens(manifest.reclaimedTokens)}
            </span>
          ) : null}
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
                  aria-label={translate("agentChat.contextXray.showList", {
                    defaultValue: "Show context list",
                  })}
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
              <TooltipContent>
                {translate("agentChat.contextXray.list", {
                  defaultValue: "List",
                })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setMode("map")}
                  aria-label={translate("agentChat.contextXray.showMap", {
                    defaultValue: "Show context map",
                  })}
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
              <TooltipContent>
                {translate("agentChat.contextXray.map", {
                  defaultValue: "Map",
                })}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {mode === "map" ? (
          <ContextTreemapView
            segments={segments}
            systemSections={sections}
            translate={translate}
            onSelect={(id) => {
              if (segments.some((segment) => segment.segmentId === id))
                setCollapsed(new Set());
            }}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {systemGroups.length ? (
              <div>
                <div className="px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {systemOrderedLabel}
                </div>
                {systemGroups.map((group) => {
                  const key = `system:${group.governance}`;
                  const isCollapsed = collapsed.has(key);
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-2 text-start hover:bg-accent/35"
                      >
                        {isCollapsed ? (
                          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <IconLock className="h-3 w-3 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {governanceLabels[group.governance] ??
                            group.governance}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatContextTokens(group.tokens)} ·{" "}
                          {manifest.totalTokens > 0
                            ? Math.round(
                                (group.tokens / manifest.totalTokens) * 100,
                              )
                            : 0}
                          %
                        </span>
                      </button>
                      {!isCollapsed ? (
                        <div className="pb-1">
                          {group.sections
                            .slice()
                            .sort((a, b) => b.tokenCount - a.tokenCount)
                            .map((section) => (
                              <SystemSectionRow
                                key={section.segmentId}
                                section={section}
                                totalTokens={manifest.totalTokens}
                                translate={translate}
                              />
                            ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name);
              return (
                <div key={group.name}>
                  <button
                    type="button"
                    onClick={() => toggle(group.name)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-2 text-start hover:bg-accent/35"
                  >
                    {isCollapsed ? (
                      <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        contextGroupColor(group.name),
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {group.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatContextTokens(group.tokens)}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <div className="pb-1">
                      {group.segments
                        .slice()
                        .sort((a, b) => b.tokenCount - a.tokenCount)
                        .map((segment) => (
                          <ContextSegmentRowView
                            key={segment.segmentId}
                            segment={segment}
                            advisory={!manifest.enforceable}
                            onPin={() => onPin(segment.segmentId)}
                            onEvict={() => onEvict(segment.segmentId)}
                            onRestore={() => onRestore(segment.segmentId)}
                            translate={translate}
                          />
                        ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
