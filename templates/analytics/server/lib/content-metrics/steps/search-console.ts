import { createHash } from "node:crypto";

import { normalizeSearchConsoleProperty } from "../../../../shared/search-console-property.js";
import { querySearchAnalytics } from "../../search-console.js";
import type { SearchConsoleSite } from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import {
  listContentItems,
  type ContentItemInput,
  type ContentSnapshotInput,
  type StoredContentItem,
} from "../store.js";
import {
  collectionWindow,
  DailyMetricValues,
  pageKey,
  type ItemRef,
} from "./daily-metrics.js";

export const SEARCH_CONSOLE_CLICKS_METRIC = "search_console_clicks";
export const SEARCH_CONSOLE_IMPRESSIONS_METRIC = "search_console_impressions";
const METRICS = [
  SEARCH_CONSOLE_CLICKS_METRIC,
  SEARCH_CONSOLE_IMPRESSIONS_METRIC,
];
/**
 * Search Console's final numbers arrive two to three days late. Fetching the
 * last five days again picks each day up once it is final.
 */
const LOOKBACK_DAYS = 5;
const MAX_ROWS_PER_SITE = 500_000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a page URL belongs to a Domain or URL-prefix property. */
export function siteCoversUrl(siteUrl: string, url: string): boolean {
  if (siteUrl.startsWith("sc-domain:")) {
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
    const configFingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          sites.map((site) => [
            normalizeSearchConsoleProperty(site.siteUrl),
            site.pathPrefix?.trim() ?? "",
          ]),
        ),
      )
      .digest("hex");
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
    const newPages = new Map<string, ContentItemInput>();
    const snapshots = new Map<string, ContentSnapshotInput>();

    for (const site of sites) {
      const rows = await querySearchAnalytics({
        siteUrl: site.siteUrl,
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: ["date", "page"],
        ...(site.pathPrefix
          ? { pageRegex: `^https?://[^/]+${escapeRegex(site.pathPrefix)}` }
          : {}),
        maxRows: MAX_ROWS_PER_SITE,
        ...(signal ? { signal } : {}),
      });

      const values = new DailyMetricValues();
      let lastReturnedDate: string | null = null;
      for (const row of rows) {
        const [date, page] = row.keys;
        if (!date || !page) continue;
        if (!lastReturnedDate || date > lastReturnedDate) {
          lastReturnedDate = date;
        }
        const key = pageKey(page);
        if (!key) continue;
        let item: ItemRef | undefined = byKey.get(key);
        if (!item) {
          const url = page.split("#")[0]!;
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
      }

      for (const snapshot of values.snapshots({
        items: [...articles, ...knownPages].filter((item) =>
          inScope(site, item.url),
        ),
        metrics: METRICS,
        startDate: window.startDate,
        lastReturnedDate,
        fillMissing: false,
      })) {
        // Overlapping properties measure the same traffic. The first configured
        // property returning a value owns it, rather than double counting.
        const key = JSON.stringify([
          snapshot.itemSource,
          snapshot.itemExternalId,
          snapshot.metricDate,
          snapshot.metric,
        ]);
        if (!snapshots.has(key)) snapshots.set(key, snapshot);
      }
    }

    return {
      items: [...newPages.values()],
      snapshots: [...snapshots.values()],
      outcome: {
        rowCount: snapshots.size,
        windowStart: window.startDate,
        windowEnd: window.endDate,
        configFingerprint,
      },
    };
  },
};
