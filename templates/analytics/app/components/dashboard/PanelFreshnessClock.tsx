import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconClock } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  describeFreshnessText,
  relativeFetchAge,
  type PanelFreshness,
} from "./panel-freshness";

/**
 * When the panel's data was fetched and whether it came from a cache, behind a
 * clock in the panel's hover actions. The tooltip opens on hover and focus; a
 * tap opens it too, because a tooltip alone never opens on touch.
 */
export function PanelFreshnessClock({
  freshness,
  className,
  showAge = false,
}: {
  freshness: PanelFreshness;
  className?: string;
  showAge?: boolean;
}) {
  const t = useT();
  const formatters = useFormatters();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!showAge || !freshness.fetchedAt) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      60_000 - (Date.now() % 60_000),
    );
    return () => clearTimeout(timer);
  }, [showAge, freshness.fetchedAt, now]);
  const status = freshness.status;
  const updating =
    status === "updating" || status === "previous-filters-updating";
  const statusText =
    status === "previous-filters-updating"
      ? t("sqlDashboard.updatingPreviousFilters")
      : status === "updating"
        ? t("sqlDashboard.updating")
        : status === "previous-filters"
          ? t("sqlDashboard.previousFilters")
          : status === "refreshed"
            ? t("sqlDashboard.refreshed")
            : undefined;
  const label = [
    statusText,
    describeFreshnessText(t, formatters, freshness, "full"),
  ]
    .filter(Boolean)
    .join(" · ");
  const age =
    showAge && freshness.fetchedAt
      ? relativeFetchAge(
          formatters,
          freshness.fetchedAt,
          Math.max(now, Date.now()),
        )
      : undefined;
  const visibleText =
    statusText ??
    (age
      ? t("sqlDashboard.updatedAgo", { age })
      : status === "stale"
        ? describeFreshnessText(t, formatters, freshness, "compact")
        : undefined);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "panel-freshness-clock inline-flex min-w-0 max-w-full items-center justify-end gap-1.5 whitespace-nowrap rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !status && "panel-freshness-routine",
            className,
          )}
          aria-label={label}
          data-dashboard-report-freshness={freshness.cache}
          data-dashboard-report-updating={
            updating
              ? status === "previous-filters-updating"
                ? "previous-filters"
                : "refresh"
              : undefined
          }
          data-dashboard-report-paused={
            status === "previous-filters" ? "previous-filters" : undefined
          }
          data-dashboard-report-refreshed={
            status === "refreshed" ? "" : undefined
          }
          data-dashboard-report-stale={
            status === "stale" ? freshness.cache : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <span
            className="panel-freshness-text min-w-0 truncate"
            aria-hidden="true"
          >
            {status === "stale" && !showAge ? (
              <time dateTime={freshness.fetchedAt}>{visibleText}</time>
            ) : (
              visibleText
            )}
          </span>
          <span className="sr-only" role="status">
            {statusText}
          </span>
          {status === "refreshed" ? (
            <IconCheck aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <IconClock
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                updating && "animate-spin motion-reduce:animate-none",
              )}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
