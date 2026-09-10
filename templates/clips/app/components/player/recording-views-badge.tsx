import { useActionQuery, useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconBotId, IconUser } from "@tabler/icons-react";
import { useState } from "react";

import { ClaudeLogo, CodexLogo } from "@/components/agent-destination-logos";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { InsightsChart } from "./insights-chart";
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
  agentViews?: number;
  uniqueViewers?: number;
  completionRate?: number;
  ctaConversionRate?: number;
  agentViewers: AgentViewerRow[];
}

export interface RecordingViewsBadgeProps {
  recordingId: string;
  /** Public counted human-view total. Combined with agentViewCount for display. */
  viewCount: number;
  /** Outside-agent read total. Broken out in the Views tab. */
  agentViewCount?: number;
  /** Total recorded emoji reactions for the engagement funnel. */
  reactionCount?: number;
  /** Opens the unified surface when arriving from the legacy insights route. */
  defaultOpen?: boolean;
  /** True only for owner/editor — gates avatars and all viewer identities. */
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
  agentViewCount = 0,
  reactionCount = 0,
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

  const totalViewCount = viewCount + agentViewCount;
  const countLabel = t("recordingInsights.viewsCount", {
    count: totalViewCount,
  });

  if (totalViewCount <= 0 && !canViewDetails) return null;

  if (!canViewDetails) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <span className="tabular-nums">{countLabel}</span>
      </span>
    );
  }

  const viewers = viewersQuery.data?.viewers ?? [];
  const agentViewers = agentViewersQuery.data?.agentViewers ?? [];

  const insightData = agentViewersQuery.data;
  const insightViews =
    (insightData?.views ?? viewCount) +
    (insightData?.agentViews ?? agentViewCount);
  const uniqueViewers = insightData?.uniqueViewers ?? null;
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
                  className="size-5 ring-1 ring-background"
                />
              ))}
            </span>
          ) : null}
          <span className="tabular-nums">{countLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[260] w-[460px] max-w-[calc(100vw-1rem)] overflow-hidden border-border p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "views" | "insights")}
        >
          <ViewerTabsList className="overflow-visible">
            <ViewerTabsTrigger value="views">
              {t("recordingInsights.viewsTab")}
            </ViewerTabsTrigger>
            <ViewerTabsTrigger value="insights">
              {t("recordingInsights.insightsTab")}
            </ViewerTabsTrigger>
          </ViewerTabsList>

          <div className="max-h-[min(70vh,520px)] overflow-y-auto">
            <TabsContent value="views" className="m-0 p-3">
              {viewersQuery.isError ? (
                <InsightsErrorState
                  compact
                  onRetry={() => void viewersQuery.refetch()}
                />
              ) : viewersQuery.isLoading ? (
                <ViewerRowsSkeleton />
              ) : viewers.length > 0 ? (
                <ViewerSection
                  label={t("recordingInsights.humanViews")}
                  trailingLabel={t("recordingInsights.completion")}
                >
                  <ul className="grid gap-0.5">
                    {viewers.map((viewer) => (
                      <li
                        key={viewer.id}
                        className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/60"
                      >
                        <ViewerAvatar viewer={viewer} className="size-5" />
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                          {viewerLabel(
                            viewer,
                            t("recordingInsights.anonymous"),
                          )}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {Math.round(viewer.completedPct)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </ViewerSection>
              ) : null}
              {agentViewersQuery.isError ? (
                <InsightsErrorState
                  compact
                  onRetry={() => void agentViewersQuery.refetch()}
                />
              ) : agentViewersQuery.isLoading ? (
                <div className="pt-1">
                  <ViewerRowsSkeleton count={2} />
                </div>
              ) : agentViewers.length > 0 ? (
                <ViewerSection label={t("recordingInsights.agentViews")}>
                  <ul className="grid gap-0.5">
                    {agentViewers.map((agent) => (
                      <li
                        key={agent.agentLabel ?? agent.userAgent ?? "unknown"}
                        className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/60"
                      >
                        <AgentViewerAvatar
                          agentLabel={agent.agentLabel}
                          className="size-5"
                        />
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
                </ViewerSection>
              ) : null}
              {!viewersQuery.isError &&
              !viewersQuery.isLoading &&
              !agentViewersQuery.isError &&
              !agentViewersQuery.isLoading &&
              viewers.length === 0 &&
              agentViewers.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {t("recordingInsights.noViewsYet")}
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="insights" className="m-0 px-4 pb-3 pt-4">
              {agentViewersQuery.isError ? (
                <InsightsErrorState
                  onRetry={() => void agentViewersQuery.refetch()}
                />
              ) : agentViewersQuery.isLoading ? (
                <Skeleton className="h-[220px] w-full rounded-lg" />
              ) : (
                <InsightsChart
                  views={insightViews}
                  uniqueViewers={uniqueViewers}
                  reactions={reactionCount}
                  completionRate={
                    agentViewersQuery.data?.completionRate ?? null
                  }
                  ctaConversionRate={
                    agentViewersQuery.data?.ctaConversionRate ?? null
                  }
                />
              )}
            </TabsContent>
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function ViewerSection({
  label,
  trailingLabel,
  children,
}: {
  label: string;
  trailingLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 px-2 text-xs font-medium text-muted-foreground">
        <h3>{label}</h3>
        {trailingLabel ? <span>{trailingLabel}</span> : null}
      </div>
      {children}
    </section>
  );
}

function InsightsErrorState({
  compact = false,
  onRetry,
}: {
  compact?: boolean;
  onRetry: () => void;
}) {
  const t = useT();

  return (
    <Empty
      className={cn(
        "gap-3 border-0 p-4 md:p-5",
        compact ? "min-h-28" : "min-h-52",
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAlertTriangle />
        </EmptyMedia>
        <EmptyTitle className="text-sm">
          {t("sharePage.somethingWentWrong")}
        </EmptyTitle>
        <EmptyDescription className="text-xs">
          {t("sharePage.pleaseTryAgain")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("libraryGrid.retry")}
        </Button>
      </EmptyContent>
    </Empty>
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

/** Agents use provider logos when the public API identifies the provider. */
export function AgentViewerAvatar({
  agentLabel,
  className,
}: {
  agentLabel?: string | null;
  className?: string;
}) {
  const normalizedLabel = agentLabel?.toLowerCase() ?? "";
  const logo = normalizedLabel.includes("claude") ? (
    <ClaudeLogo className="size-3.5" />
  ) : normalizedLabel.includes("openai") ||
    normalizedLabel.includes("chatgpt") ||
    normalizedLabel.includes("codex") ? (
    <CodexLogo className="size-3.5" />
  ) : (
    <IconBotId className="size-3.5" />
  );

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className,
      )}
    >
      {logo}
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
