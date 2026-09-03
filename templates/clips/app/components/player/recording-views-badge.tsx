import { useActionQuery, useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTerminal2, IconUser } from "@tabler/icons-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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

interface Insights {
  views: number;
  agentViews: number;
  agentViewers: AgentViewerRow[];
  uniqueViewers: number;
  completionRate: number;
  ctaConversionRate: number;
  dropOff: { bucket: number; watching: number }[];
  topViewers: {
    viewerEmail: string | null;
    viewerName: string | null;
    totalWatchMs: number;
    completedPct: number;
  }[];
  durationMs: number;
}

export interface RecordingViewsBadgeProps {
  recordingId: string;
  /** Public counted-view total. Rendered as-is when details are unavailable. */
  viewCount: number;
  /** Outside-agent read total. Shown beside the human count, never folded into it. */
  agentViewCount?: number;
  /** True only for owner/editor — gates avatars, the popover, and all viewer identities. */
  canViewDetails: boolean;
  /** Optional: called by the popover's "More insights" button. Omit to hide that button. */
  onOpenInsights?: () => void;
  className?: string;
}

/**
 * Header-sized view counter. Viewer identities are owner/editor-only, so a
 * visitor gets plain text and fires no viewer queries at all — `canViewDetails`
 * is the client half of the server-side access check on `list-viewers`.
 */
export function RecordingViewsBadge({
  recordingId,
  viewCount,
  agentViewCount = 0,
  canViewDetails,
  onOpenInsights,
  className,
}: RecordingViewsBadgeProps): React.ReactElement | null {
  const t = useT();
  const [open, setOpen] = useState(false);

  const viewersQuery = useActionQuery<{ viewers: ViewerRow[] }>(
    "list-viewers",
    { recordingId, limit: 12 },
    { enabled: canViewDetails },
  );
  const insightsQuery = useActionQuery<Insights>(
    "get-recording-insights",
    { recordingId },
    { enabled: canViewDetails && open },
  );

  const countLabel = t("recordingInsights.viewsCount", { count: viewCount });
  const agentCountLabel = t("recordingInsights.agentViewsCount", {
    count: agentViewCount,
  });

  if (viewCount <= 0 && agentViewCount <= 0 && !canViewDetails) return null;

  if (!canViewDetails) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <span className="tabular-nums">{countLabel}</span>
        {agentViewCount > 0 ? (
          <AgentViewCount count={agentViewCount} label={agentCountLabel} />
        ) : null}
      </span>
    );
  }

  const viewers = viewersQuery.data?.viewers ?? [];
  const insights = insightsQuery.data;
  const agentViewers = insights?.agentViewers ?? [];
  const summary = insights
    ? t("recordingInsights.totalViewsSummary", {
        total: insights.views,
        unique: insights.uniqueViewers,
      })
    : countLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            className,
          )}
        >
          {viewers.length > 0 ? (
            <span className="hidden -space-x-1.5 sm:flex">
              {viewers.slice(0, 3).map((v) => (
                <ViewerAvatar
                  key={v.id}
                  viewer={v}
                  className="h-6 w-6 ring-2 ring-card"
                />
              ))}
            </span>
          ) : null}
          <span className="tabular-nums">{countLabel}</span>
          {agentViewCount > 0 ? (
            <AgentViewCount count={agentViewCount} label={agentCountLabel} />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Tabs defaultValue="views">
          <div className="p-2 pb-0">
            <TabsList className="grid h-8 w-full grid-cols-2">
              <TabsTrigger value="views" className="text-xs">
                {t("recordingInsights.viewsTab")}
              </TabsTrigger>
              <TabsTrigger value="insights" className="text-xs">
                {t("recordingInsights.insightsTab")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="views" className="mt-2">
            <div className="border-y border-border px-3 py-2 text-xs text-muted-foreground">
              {summary}
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5">
              <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
                {t("recordingInsights.humanViews")}
              </p>
              {viewersQuery.isLoading ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {t("recordingInsights.loading")}
                </p>
              ) : viewers.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {t("recordingInsights.noViewsYet")}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {viewers.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5"
                    >
                      <ViewerAvatar viewer={v} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {viewerLabel(v, t("recordingInsights.anonymous"))}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {Math.round(v.completedPct)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-2 border-t border-border px-2 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
                {t("recordingInsights.agentViews")}
              </p>
              {agentViewers.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("recordingInsights.noAgentViewsYet")}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {agentViewers.map((a) => (
                    <li
                      key={a.agentLabel ?? a.userAgent ?? "unknown"}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <IconTerminal2 className="h-3.5 w-3.5" />
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                        title={a.userAgent ?? undefined}
                      >
                        {a.agentLabel ?? t("recordingInsights.unknownAgent")}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {t("recordingInsights.viewsCount", { count: a.views })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="insights" className="mt-2 space-y-3 p-3 pt-1">
            {insightsQuery.isLoading ? (
              <p className="py-3 text-sm text-muted-foreground">
                {t("recordingInsights.loading")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard
                    label={t("recordingInsights.humanViews")}
                    value={insights?.views ?? viewCount}
                  />
                  <StatCard
                    label={t("recordingInsights.agentViews")}
                    value={insights?.agentViews ?? 0}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <MiniStat
                    label={t("recordingInsights.uniqueViewers")}
                    value={insights?.uniqueViewers ?? 0}
                  />
                  <MiniStat
                    label={t("recordingInsights.completion")}
                    value={`${Math.round(insights?.completionRate ?? 0)}%`}
                  />
                  <MiniStat
                    label={t("recordingInsights.ctaConversion")}
                    value={`${Math.round(insights?.ctaConversionRate ?? 0)}%`}
                  />
                </div>
              </>
            )}
            {onOpenInsights ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full cursor-pointer"
                onClick={() => {
                  setOpen(false);
                  onOpenInsights();
                }}
              >
                {t("recordingInsights.moreInsights")}
              </Button>
            ) : null}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

/** Agent reads are a separate audience from humans, so they get their own
 * icon-prefixed count rather than being summed into the view total. */
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
      <IconTerminal2 className="h-3.5 w-3.5" aria-hidden />
      {count}
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

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="truncate">{label}</div>
      <div className="mt-0.5 text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-foreground tabular-nums">
        {value}
      </div>
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
