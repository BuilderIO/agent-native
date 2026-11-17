import type { EmbedVisibility } from "@agent-native/core/shared";
import {
  analyticsChartsWiderThan,
  type AnalyticsChartData,
} from "@shared/analytics-chart-block";

type Chart = Pick<AnalyticsChartData, "panel" | "dashboard">;

/** Charts read from saved pages; `unread` while some can't be weighed yet. */
export interface ChartsRead {
  charts: readonly Chart[];
  unread: boolean;
}

/** The charts a change would show to more people, from one set of pages. */
export interface ChartsGoingWider {
  warn: Chart[];
  block: Chart[];
  unread: boolean;
}

export interface AnalyticsShareCheck {
  page: ChartsGoingWider;
  /**
   * Going public carries the sub-pages that aren't public yet, so their
   * charts count too; null for any other change.
   */
  subPages: ChartsGoingWider | null;
}

/** What the share dialog has read of the sub-pages' charts. */
export interface SubPageChartsQuery {
  data?:
    | {
        charts?: readonly Chart[] | undefined;
        unreadable?: number | undefined;
        more?: boolean | undefined;
      }
    | undefined;
  isError: boolean;
  isFetching: boolean;
}

/**
 * The sub-pages' charts, or unread while they're loading, when the last read
 * failed (a failed refetch keeps the earlier answer), when the answer isn't
 * whole, or when some can't be weighed.
 */
export function subPageChartsRead(query: SubPageChartsQuery): ChartsRead {
  const { data } = query;
  if (
    data === undefined ||
    !Array.isArray(data.charts) ||
    typeof data.unreadable !== "number" ||
    typeof data.more !== "boolean" ||
    data.unreadable > 0 ||
    data.more ||
    query.isError ||
    query.isFetching
  ) {
    return { charts: [], unread: true };
  }
  return { charts: data.charts ?? [], unread: false };
}

/** How long a read of the sub-pages' charts answers the question alone. */
export const SUB_PAGE_CHARTS_FRESH_MS = 15_000;

/**
 * Whether a click making the page public reads the sub-pages again first:
 * the question is asked on the click and can't wait for a read, so an older
 * answer asks while the new read is out.
 */
export function subPageChartsNeedReading(readAt: number, now: number) {
  return now - readAt > SUB_PAGE_CHARTS_FRESH_MS;
}

function goingWider(to: EmbedVisibility, read: ChartsRead): ChartsGoingWider {
  if (read.unread) return { warn: [], block: [], unread: true };
  return { ...analyticsChartsWiderThan(to, read.charts), unread: false };
}

/**
 * What opening a page to `to` shows to more people: the page's own charts,
 * and when it goes public, the charts in the sub-pages that go public with
 * it. A table that would go wider is refused by the server when the change
 * is saved, a sub-page's as well as the page's.
 */
export function analyticsShareCheck(
  to: EmbedVisibility,
  page: ChartsRead,
  subPages: ChartsRead,
): AnalyticsShareCheck {
  return {
    page: goingWider(to, page),
    subPages: to === "public" ? goingWider(to, subPages) : null,
  };
}

/** Whether the share dialog asks before making the change. */
export function analyticsShareAsks(check: AnalyticsShareCheck): boolean {
  return [check.page, check.subPages].some(
    (part) =>
      part !== null &&
      (part.unread || part.warn.length > 0 || part.block.length > 0),
  );
}
