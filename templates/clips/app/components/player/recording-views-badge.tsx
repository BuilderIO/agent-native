import { useActionQuery, useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconMessageCircleBolt, IconUser } from "@tabler/icons-react";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ViewerTabsList, ViewerTabsTrigger } from "./viewer-controls";

interface ViewerRow {
  id: string;
  viewerEmail: string | null;
  viewerName: string | null;
  totalWatchMs: number;
  completedPct: number;
  countedView: boolean;
  ctaClicked: boolean;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
}

interface AgentViewerRow {
  agentLabel: string | null;
  userAgent: string | null;
  views: number;
  lastSeenAt: string;
}

interface AgentViewersResponse {
  views?: number;
  uniqueViewers?: number;
  completionRate?: number;
  ctaConversionRate?: number;
  dropOff?: { bucket: number; watching: number }[];
  agentViewers: AgentViewerRow[];
}

export interface RecordingViewsBadgeProps {
  recordingId: string;
  /** Public counted-view total. Rendered as-is when details are unavailable. */
  viewCount: number;
  /** Total recorded emoji reactions for the engagement funnel. */
  reactionCount?: number;
  /** Recording duration used to label the engagement drop-off chart. */
  durationMs?: number;
  /** Opens the unified surface when arriving from the legacy insights route. */
  defaultOpen?: boolean;
  /** True only for owner/editor — gates avatars, the dialog, and all viewer identities. */
  canViewDetails: boolean;
  className?: string;
}

/**
 * Header-sized human-view trigger. Viewer identities are owner/editor-only,
 * so a visitor gets plain text and fires no viewer queries at all —
 * `canViewDetails` is the client half of the server-side access check on
 * `list-viewers`.
 */
export function RecordingViewsBadge({
  recordingId,
  viewCount,
  reactionCount = 0,
  durationMs = 0,
  defaultOpen = false,
  canViewDetails,
  className,
}: RecordingViewsBadgeProps): React.ReactElement | null {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<"views" | "insights">(
    defaultOpen ? "insights" : "views",
  );

  const viewersQuery = useActionQuery<{ viewers: ViewerRow[] }>(
    "list-viewers",
    { recordingId, limit: 12 },
    { enabled: canViewDetails },
  );
  const agentViewersQuery = useActionQuery<AgentViewersResponse>(
    "get-recording-insights",
    { recordingId },
    { enabled: canViewDetails && open },
  );

  const countLabel = t("recordingInsights.viewsCount", { count: viewCount });

  if (viewCount <= 0 && !canViewDetails) return null;

  if (!canViewDetails) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        <span className="tabular-nums">{countLabel}</span>
      </span>
    );
  }

  const viewers = viewersQuery.data?.viewers ?? [];
  const agentViewers = agentViewersQuery.data?.agentViewers ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setActiveTab("views");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 cursor-pointer gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            className,
          )}
          aria-label={countLabel}
          onClick={(event) => event.stopPropagation()}
        >
          {viewers.length > 0 ? (
            <span className="hidden -space-x-1.5 sm:flex">
              {viewers.slice(0, 3).map((viewer) => (
                <ViewerAvatar
                  key={viewer.id}
                  viewer={viewer}
                  className="size-5 ring-2 ring-background"
                />
              ))}
            </span>
          ) : null}
          <span className="tabular-nums">{countLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[260] w-[400px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "views" | "insights")}
        >
          <ViewerTabsList>
            <ViewerTabsTrigger value="views">
              {t("recordingInsights.viewsTab")}
            </ViewerTabsTrigger>
            <ViewerTabsTrigger value="insights">
              {t("recordingInsights.insightsTab")}
            </ViewerTabsTrigger>
          </ViewerTabsList>

          <div className="max-h-[min(70vh,520px)] overflow-y-auto">
            <TabsContent value="views" className="m-0 p-3">
              <div className="mb-1 flex items-center justify-between gap-3 px-2 text-xs font-medium text-muted-foreground">
                <span>{t("recordingInsights.recentViewers")}</span>
                <span>{t("recordingInsights.completion")}</span>
              </div>
              {viewersQuery.isLoading ? (
                <ViewerRowsSkeleton />
              ) : viewers.length === 0 && agentViewers.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {t("recordingInsights.noViewsYet")}
                </p>
              ) : (
                <ul className="grid gap-0.5">
                  {viewers.map((viewer) => (
                    <li
                      key={viewer.id}
                      className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/60"
                    >
                      <ViewerAvatar viewer={viewer} className="size-5" />
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                        {viewerLabel(viewer, t("recordingInsights.anonymous"))}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {Math.round(viewer.completedPct)}%
                      </span>
                    </li>
                  ))}
                  {agentViewers.map((agent) => (
                    <li
                      key={agent.agentLabel ?? agent.userAgent ?? "unknown"}
                      className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/60"
                    >
                      <AgentViewerAvatar className="size-5" />
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-foreground"
                        title={agent.userAgent ?? undefined}
                      >
                        {agent.agentLabel ??
                          t("recordingInsights.unknownAgent")}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t("recordingInsights.viewsCount", {
                          count: agent.views,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {agentViewersQuery.isLoading ? (
                <div className="pt-1">
                  <ViewerRowsSkeleton count={2} />
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="insights" className="m-0 p-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <InsightMetric
                  label={t("recordingInsights.views")}
                  value={viewCount}
                />
                <InsightMetric
                  label={t("recordingInsights.uniqueViewers")}
                  value={
                    agentViewersQuery.data?.uniqueViewers ?? viewers.length
                  }
                />
                <InsightMetric
                  label={t("recordingInsights.completion")}
                  value={
                    agentViewersQuery.data?.completionRate == null
                      ? "—"
                      : `${Math.round(agentViewersQuery.data.completionRate)}%`
                  }
                />
                <InsightMetric
                  label={t("insightsHub.reactions")}
                  value={reactionCount}
                />
                <InsightMetric
                  label={t("recordingInsights.ctaConversion")}
                  value={
                    agentViewersQuery.data?.ctaConversionRate == null
                      ? "—"
                      : `${Math.round(agentViewersQuery.data.ctaConversionRate)}%`
                  }
                />
              </div>

              {agentViewersQuery.data?.dropOff?.length && durationMs > 0 ? (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("recordingInsights.dropOff")}
                  </div>
                  <div className="h-36 rounded-md border border-border bg-muted/20 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={agentViewersQuery.data.dropOff}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          dataKey="bucket"
                          tickFormatter={(bucket) =>
                            msCompact(((bucket as number) / 100) * durationMs)
                          }
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                        />
                        <YAxis
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                        />
                        <ReTooltip
                          formatter={(value) => [
                            t("recordingInsights.viewersCount", {
                              count: Number(value),
                            }),
                            t("recordingInsights.watching"),
                          ]}
                          labelFormatter={(bucket) =>
                            msCompact(((bucket as number) / 100) * durationMs)
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="watching"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : agentViewersQuery.isLoading ? (
                <div className="mt-4 border-t border-border pt-4">
                  <Skeleton className="h-36 w-full rounded-md" />
                </div>
              ) : null}
            </TabsContent>
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function InsightMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

/** Compact agent-view indicator retained for library cards and other dense lists. */
export function AgentViewCount({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 border-s border-border ps-2 tabular-nums",
        className,
      )}
    >
      <AgentViewerAvatar className="size-5" />
      {count}
    </span>
  );
}

/** Agents use the same circular identity shape as people, with an assistant
 * mark instead of a terminal glyph that would imply developer tooling. */
export function AgentViewerAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className,
      )}
    >
      <IconMessageCircleBolt className="size-3.5" />
    </span>
  );
}

/** Identity fields every viewer surface shares — `list-viewers` rows and the
 * leaner `topViewers` rows from `get-recording-insights` alike. */
export interface ViewerIdentity {
  viewerEmail: string | null;
  viewerName: string | null;
}

export function ViewerAvatar({
  viewer,
  className,
}: {
  viewer: ViewerIdentity;
  className?: string;
}) {
  const anonymous = !viewer.viewerName && !viewer.viewerEmail;
  const avatarUrl = useAvatarUrl(viewer.viewerEmail);
  const label = viewer.viewerName || viewer.viewerEmail || "";

  return (
    <Avatar className={cn("h-6 w-6 shrink-0", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
      <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
        {anonymous ? (
          <IconUser className="h-3 w-3" />
        ) : (
          initials(viewer.viewerName || viewer.viewerEmail || "?")
        )}
      </AvatarFallback>
    </Avatar>
  );
}

function ViewerRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-0.5 px-2" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function viewerLabel(
  viewer: ViewerIdentity,
  anonymousLabel: string,
): string {
  if (viewer.viewerName) return viewer.viewerName;
  if (viewer.viewerEmail) return viewer.viewerEmail.split("@")[0];
  return anonymousLabel;
}

function initials(s: string): string {
  return s
    .split(/\s+|@/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function msCompact(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
