/**
 * Presentational public status page. Pure/client-safe: it takes an already-
 * resolved, sanitized `PublicStatusPage` payload (from the
 * `get-public-status-page` action / SSR loader) and renders the branded status
 * banner, overall uptime cards, per-monitor colored uptime timelines, optional
 * response-time charts, and an incidents section.
 */
import {
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconRefresh,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import type { PublicStatusPage } from "../../../server/lib/status-pages";
import { formatLatencyMs, formatUptimePct } from "./chart-utils";
import { ResponseTimeChart } from "./ResponseTimeChart";
import { UptimeStatCards } from "./UptimeStatCards";
import { UptimeTimelineBars } from "./UptimeTimelineBars";

type OverallStatus = PublicStatusPage["overall"];
type PublicMonitor = PublicStatusPage["monitors"][number];
type MonitorStatus = PublicMonitor["status"];

function monitorTone(
  status: MonitorStatus,
): "up" | "down" | "degraded" | "neutral" {
  switch (status) {
    case "up":
      return "up";
    case "down":
    case "error":
      return "down";
    case "degraded":
      return "degraded";
    default:
      return "neutral";
  }
}

function toneDotClass(tone: ReturnType<typeof monitorTone>): string {
  switch (tone) {
    case "up":
      return "bg-emerald-500";
    case "down":
      return "bg-red-500";
    case "degraded":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function toneTextClass(tone: ReturnType<typeof monitorTone>): string {
  switch (tone) {
    case "up":
      return "text-emerald-500";
    case "down":
      return "text-red-500";
    case "degraded":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

function monitorStatusLabel(status: MonitorStatus): string {
  switch (status) {
    case "up":
      return "Operational";
    case "down":
      return "Down";
    case "degraded":
      return "Degraded";
    case "error":
      return "Error";
    case "running":
      return "Checking";
    default:
      return "Unknown";
  }
}

const BANNER: Record<
  OverallStatus,
  {
    icon: typeof IconCircleCheck;
    accent: string;
    ring: string;
    iconClass: string;
    title: string;
  }
> = {
  operational: {
    icon: IconCircleCheck,
    accent: "bg-emerald-500/10",
    ring: "border-emerald-500/30",
    iconClass: "text-emerald-500",
    title: "All systems operational", // i18n-ignore public status page fixed copy
  },
  degraded: {
    icon: IconAlertTriangle,
    accent: "bg-amber-500/10",
    ring: "border-amber-500/30",
    iconClass: "text-amber-500",
    title: "Some systems degraded", // i18n-ignore public status page fixed copy
  },
  down: {
    icon: IconAlertCircle,
    accent: "bg-red-500/10",
    ring: "border-red-500/30",
    iconClass: "text-red-500",
    title: "System outage in progress", // i18n-ignore public status page fixed copy
  },
  unknown: {
    icon: IconActivity,
    accent: "bg-muted",
    ring: "border-border/60",
    iconClass: "text-muted-foreground",
    title: "Status unknown", // i18n-ignore public status page fixed copy
  },
};

function bannerSubtitle(page: PublicStatusPage): string {
  const { up, down, degraded, total } = page.counts;
  if (total === 0) return "No monitors are being tracked on this page yet.";
  if (page.overall === "operational") {
    return `${total} ${total === 1 ? "monitor" : "monitors"} reporting healthy.`;
  }
  const parts: string[] = [];
  if (down > 0) parts.push(`${down} down`);
  if (degraded > 0) parts.push(`${degraded} degraded`);
  if (up > 0) parts.push(`${up} operational`);
  return parts.join(" · ");
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PublicStatusView({
  page,
  refreshing = false,
}: {
  page: PublicStatusPage;
  refreshing?: boolean;
}) {
  const banner = BANNER[page.overall];
  const BannerIcon = banner.icon;
  const centered = page.layout.alignment === "center";
  const compact = page.layout.density === "compact";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className={cn(
          "mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14",
          centered && "text-center",
        )}
      >
        {/* Brand + title */}
        <header
          className={cn("flex flex-col gap-1", centered && "items-center")}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="inline-flex size-5 items-center justify-center rounded-md bg-[var(--brand-amber,#F59E0B)]/15 text-[var(--brand-amber,#F59E0B)]">
              <IconActivity className="size-3.5" />
            </span>
            Status
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {page.title}
          </h1>
          {page.description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {page.description}
            </p>
          ) : null}
        </header>

        {/* Overall banner */}
        <section
          className={cn(
            "mt-6 flex items-center gap-4 rounded-xl border px-5 py-4",
            banner.ring,
            banner.accent,
            centered && "justify-center text-left",
          )}
        >
          <span
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-background/60",
              banner.iconClass,
            )}
          >
            <BannerIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="text-lg font-semibold">{banner.title}</div>
            <div className="text-sm text-muted-foreground">
              {bannerSubtitle(page)}
            </div>
          </div>
        </section>

        {/* Overall uptime cards */}
        {page.layout.showOverallUptime && page.monitors.length > 0 ? (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Overall uptime{/* i18n-ignore public status page fixed copy */}
            </h2>
            <UptimeStatCards windows={page.overallWindows} compact={compact} />
          </section>
        ) : null}

        {/* Per-monitor list */}
        <section className="mt-8 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Monitors
          </h2>
          {page.monitors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
              No monitors have been added to this status page yet.
              {/* i18n-ignore public status page fixed copy */}
            </div>
          ) : (
            page.monitors.map((monitor) => {
              const tone = monitorTone(monitor.status);
              return (
                <article
                  key={monitor.id}
                  className={cn(
                    "rounded-xl border border-border/50 bg-card",
                    compact ? "p-4" : "p-5",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          toneDotClass(tone),
                        )}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {monitor.name}
                        </div>
                        {monitor.host ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {monitor.url ? (
                              <a
                                href={monitor.url}
                                target="_blank"
                                rel="noreferrer noopener nofollow"
                                className="hover:text-foreground"
                              >
                                {monitor.host}
                              </a>
                            ) : (
                              monitor.host
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className={cn("font-medium", toneTextClass(tone))}>
                        {monitorStatusLabel(monitor.status)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatUptimePct(monitor.windows.uptime90d)} (90d)
                      </span>
                    </div>
                  </div>

                  {page.layout.showUptimeBars ? (
                    <div className="mt-3">
                      <UptimeTimelineBars
                        buckets={monitor.timeline}
                        heightClassName={compact ? "h-6" : "h-8"}
                        ariaLabel={`${monitor.name} uptime over the last 90 days`}
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>90 days ago</span>
                        <span>Today</span>
                      </div>
                    </div>
                  ) : null}

                  {page.layout.showResponseTime &&
                  monitor.responseSeries.length > 0 ? (
                    <div className="mt-4">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium">
                          Response time
                          {/* i18n-ignore public status page fixed copy */}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          avg {formatLatencyMs(monitor.avgResponseMs)}
                        </span>
                      </div>
                      <ResponseTimeChart
                        series={monitor.responseSeries}
                        heightClassName="h-[140px]"
                      />
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>

        {/* Incidents / status updates */}
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Past incidents{/* i18n-ignore public status page fixed copy */}
          </h2>
          <div className="rounded-lg border border-border/50 bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No incidents reported.
            {/* i18n-ignore public status page fixed copy */}
          </div>
        </section>

        {/* Footer: last updated + auto-refresh */}
        <footer
          className={cn(
            "mt-8 flex items-center gap-1.5 text-xs text-muted-foreground",
            centered && "justify-center",
          )}
        >
          <IconRefresh
            className={cn("size-3.5", refreshing && "animate-spin")}
          />
          <span>Last updated {formatUpdatedAt(page.generatedAt)}</span>
        </footer>
      </div>
    </main>
  );
}
