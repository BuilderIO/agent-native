import { querySearchAnalytics } from "../../search-console.js";
import {
  searchConsoleConfigFingerprint,
  type SearchConsoleSite,
} from "../config.js";
import {
  ContentStepStop,
  type ContentStep,
  type ContentStepContext,
} from "../step.js";
import {
  listContentItems,
  type ContentItemInput,
  type ContentSnapshotInput,
  type StoredContentItem,
} from "../store.js";
import {
  addDays,
  BACKFILL_DAYS,
  collectionWindow,
  coveredSince,
  DailyMetricValues,
  daysFrom,
  monthsEndingOn,
  pageKey,
  type ItemRef,
} from "./daily-metrics.js";

export const SEARCH_CONSOLE_CLICKS_METRIC = "search_console_clicks";
export const SEARCH_CONSOLE_IMPRESSIONS_METRIC = "search_console_impressions";
export const SEARCH_CONSOLE_POSITION_WEIGHTED_METRIC =
  "search_console_position_weighted";
const METRICS = [
  SEARCH_CONSOLE_CLICKS_METRIC,
  SEARCH_CONSOLE_IMPRESSIONS_METRIC,
  SEARCH_CONSOLE_POSITION_WEIGHTED_METRIC,
];
/**
 * Search Console's final numbers arrive two to three days late. Fetching the
 * last five days again picks each day up once it is final.
 */
const LOOKBACK_DAYS = 5;
const MAX_DAYS_PER_RUN = BACKFILL_DAYS + LOOKBACK_DAYS;
const MAX_ROWS_PER_SITE = 500_000;
const HISTORY_DAYS_PER_REQUEST = 30;

type DateRange = { startDate: string; endDate: string };

function requestRanges(range: DateRange): DateRange[] {
  const ranges: DateRange[] = [];
  for (
    let startDate = range.startDate;
    startDate <= range.endDate;
    startDate = addDays(startDate, HISTORY_DAYS_PER_REQUEST)
  ) {
    const endDate = addDays(startDate, HISTORY_DAYS_PER_REQUEST - 1);
    ranges.push({
      startDate,
      endDate: endDate < range.endDate ? endDate : range.endDate,
    });
  }
  return ranges;
}

async function historyRange(
  collection: ContentStepContext["collection"],
  window: DateRange,
  configFingerprint: string,
): Promise<DateRange | null> {
  const historyStart = monthsEndingOn(
    window.endDate,
    collection.config.searchConsole.historyMonths,
  );
  const covered = await coveredSince(
    collection,
    "search_console",
    configFingerprint,
    window.startDate,
  );
  const days = Math.min(
    MAX_DAYS_PER_RUN - (daysFrom(window.startDate, window.endDate) + 1),
    daysFrom(historyStart, covered),
  );
  if (days <= 0) return null;
  return { startDate: addDays(covered, -days), endDate: addDays(covered, -1) };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sitePageRegex(site: SearchConsoleSite): string | undefined {
  return site.pathPrefix
    ? `^https?://[^/]+${escapeRegex(site.pathPrefix)}`
    : undefined;
}

/** Whether a page URL belongs to a Domain or URL-prefix property. */
export function siteCoversUrl(siteUrl: string, url: string): boolean {
  if (siteUrl.toLowerCase().startsWith("sc-domain:")) {
    const domain = siteUrl.slice("sc-domain:".length).toLowerCase();
    if (!URL.canParse(url)) return false;
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }
  return url.toLowerCase().startsWith(siteUrl.toLowerCase());
}

function inScope(site: SearchConsoleSite, url: string | null): boolean {
  if (!url || !siteCoversUrl(site.siteUrl, url)) return false;
  if (!site.pathPrefix) return true;
  return new URL(url).pathname
    .toLowerCase()
    .startsWith(site.pathPrefix.toLowerCase());
}

/**
 * Daily clicks and impressions per page for each configured property. Pages
 * that are collected blog articles attach to the article; any other page
 * becomes its own `search_console` item.
 */
export const searchConsoleStep: ContentStep = {
  id: "search_console",
  async run({ collection, now, signal }) {
    const sites = collection.config.searchConsole.sites;
    const configFingerprint = searchConsoleConfigFingerprint(sites);
    if (sites.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "no_search_console_sites",
        errorMessage: "No Search Console properties are set for collection.",
      });
    }

    const [articles, knownPages] = await Promise.all([
      listContentItems(collection, "builder_blog"),
      listContentItems(collection, "search_console"),
    ]);
    const byKey = new Map<string, StoredContentItem>();
    for (const item of [...knownPages, ...articles]) {
      const key = item.url ? pageKey(item.url) : null;
      if (key) byKey.set(key, item);
    }

    const window = await collectionWindow(
      collection,
      "search_console",
      now,
      LOOKBACK_DAYS,
      configFingerprint,
    );
    const history = await historyRange(collection, window, configFingerprint);
    const ranges = [...(history ? requestRanges(history) : []), window];
    const firstDay = history?.startDate ?? window.startDate;
    const newPages = new Map<string, ContentItemInput>();
    const snapshots = new Map<string, ContentSnapshotInput>();
    const dayOwners = new Map<string, number>();
    let returnedThrough: string | null = null;

    for (const [siteIndex, site] of sites.entries()) {
      const pageRegex = sitePageRegex(site);
      const values = new DailyMetricValues();
      let lastReturnedDate: string | null = null;
      for (const range of ranges) {
        for (const row of await querySearchAnalytics({
          siteUrl: site.siteUrl,
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ["date", "page"],
          ...(pageRegex ? { pageRegex } : {}),
          maxRows: MAX_ROWS_PER_SITE,
          ...(signal ? { signal } : {}),
        })) {
          const [date, page] = row.keys;
          if (!date || !page) continue;
          if (!lastReturnedDate || date > lastReturnedDate) {
            lastReturnedDate = date;
          }
          const key = pageKey(page);
          if (!key) continue;
          let item: ItemRef | undefined = byKey.get(key);
          if (!item) {
            const url = page.replace(/#.*$/s, "");
            const created: StoredContentItem = {
              source: "search_console",
              externalId: key,
              url,
              publishedAt: null,
            };
            byKey.set(key, created);
            newPages.set(key, {
              source: "search_console",
              externalId: key,
              url,
              title: null,
              author: null,
              authors: [],
              publishedAt: null,
              metadata: { siteUrl: site.siteUrl },
            });
            item = created;
          }
          values.add(item, date, SEARCH_CONSOLE_CLICKS_METRIC, row.clicks);
          values.add(
            item,
            date,
            SEARCH_CONSOLE_IMPRESSIONS_METRIC,
            row.impressions,
          );
          if (
            typeof row.position === "number" &&
            Number.isFinite(row.position)
          ) {
            values.add(
              item,
              date,
              SEARCH_CONSOLE_POSITION_WEIGHTED_METRIC,
              row.position * row.impressions,
            );
          }
        }
      }
      if (
        lastReturnedDate &&
        lastReturnedDate >= window.startDate &&
        (!returnedThrough || lastReturnedDate > returnedThrough)
      ) {
        returnedThrough = lastReturnedDate;
      }

      for (const snapshot of values.snapshots({
        items: [...articles, ...knownPages].filter((item) =>
          inScope(site, item.url),
        ),
        metrics: METRICS,
        startDate: firstDay,
        lastReturnedDate,
        fillMissing: false,
      })) {
        // Overlapping properties measure the same traffic. The first configured
        // property returning a value owns it, rather than double counting.
        const day = JSON.stringify([
          snapshot.itemSource,
          snapshot.itemExternalId,
          snapshot.metricDate,
        ]);
        const owner = dayOwners.get(day) ?? siteIndex;
        if (owner !== siteIndex) continue;
        dayOwners.set(day, siteIndex);
        snapshots.set(JSON.stringify([day, snapshot.metric]), snapshot);
      }
    }

    return {
      items: [...newPages.values()],
      snapshots: [...snapshots.values()],
      outcome: {
        rowCount: snapshots.size,
        windowStart: firstDay,
        windowEnd: returnedThrough ?? window.endDate,
        configFingerprint,
      },
    };
  },
};
