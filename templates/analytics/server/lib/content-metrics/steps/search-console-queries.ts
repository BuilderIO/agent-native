import { querySearchAnalytics } from "../../search-console.js";
import {
  searchConsoleConfigFingerprint,
  searchConsoleQueriesConfigFingerprint,
} from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import {
  lastSucceededContentRun,
  listContentItems,
  type ContentItemInput,
  type ContentSearchQueryInput,
  type StoredContentItem,
} from "../store.js";
import {
  addDays,
  coveredSince,
  monthsEndingOn,
  pageKey,
  utcDate,
  type ItemRef,
} from "./daily-metrics.js";
import { sitePageRegex } from "./search-console.js";

export const SEARCH_CONSOLE_DAILY_ROW_LIMIT = 50_000;
const MAX_ROWS_PER_DAY = 2 * SEARCH_CONSOLE_DAILY_ROW_LIMIT;
const REREAD_WEEKS = 2;
const HISTORY_WEEKS_PER_RUN = 6;
const HISTORY_BUDGET_MS = 3 * 60 * 1000;

export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

type QueryTotals = { clicks: number; impressions: number; weighted: number };

export const searchConsoleQueriesStep: ContentStep = {
  id: "search_console_queries",
  async run({ collection, now, signal }) {
    const sites = collection.config.searchConsole.sites;
    const perPage = collection.config.searchConsoleQueries.perPage;
    const configFingerprint = searchConsoleQueriesConfigFingerprint(
      sites,
      perPage,
    );
    if (sites.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "no_search_console_sites",
        errorMessage: "No Search Console properties are set for collection.",
      });
    }

    const yesterday = utcDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const pages = await lastSucceededContentRun(collection, "search_console");
    if (
      !pages?.windowEnd ||
      pages.configFingerprint !== searchConsoleConfigFingerprint(sites)
    ) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "waiting_for_search_console_pages",
        errorMessage:
          "Waiting for Search Console's daily page numbers, which say which weeks are final.",
      });
    }
    const lastFinal = pages.windowEnd < yesterday ? pages.windowEnd : yesterday;
    const newestWeek = addDays(weekStartOf(addDays(lastFinal, 1)), -7);
    const newestSunday = addDays(newestWeek, 6);
    const rereadStart = addDays(newestWeek, -7 * (REREAD_WEEKS - 1));

    const weeks: string[] = [];
    for (let week = newestWeek; week >= rereadStart; week = addDays(week, -7)) {
      weeks.push(week);
    }
    const historyStart = monthsEndingOn(
      newestSunday,
      collection.config.searchConsole.historyMonths,
    );
    const firstWeek =
      weekStartOf(historyStart) === historyStart
        ? historyStart
        : addDays(weekStartOf(historyStart), 7);
    const covered = await coveredSince(
      collection,
      "search_console_queries",
      configFingerprint,
      rereadStart,
    );
    const historyWeeks: string[] = [];
    for (
      let week = addDays(covered, -7);
      week >= firstWeek && historyWeeks.length < HISTORY_WEEKS_PER_RUN;
      week = addDays(week, -7)
    ) {
      historyWeeks.push(week);
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
    const newPages = new Map<string, ContentItemInput>();
    const rows: ContentSearchQueryInput[] = [];
    const cappedDays: string[] = [];
    const readWeeks: string[] = [];

    async function readWeek(week: string): Promise<void> {
      const perItem = new Map<
        string,
        { item: ItemRef; queries: Map<string, QueryTotals> }
      >();
      for (let offset = 0; offset < 7; offset += 1) {
        const day = addDays(week, offset);
        const owned = new Map<string, number>();
        for (const [siteIndex, site] of sites.entries()) {
          const pageRegex = sitePageRegex(site);
          const dayRows = await querySearchAnalytics({
            siteUrl: site.siteUrl,
            startDate: day,
            endDate: day,
            dimensions: ["page", "query"],
            ...(pageRegex ? { pageRegex } : {}),
            maxRows: MAX_ROWS_PER_DAY,
            ...(signal ? { signal } : {}),
          });
          if (dayRows.length >= SEARCH_CONSOLE_DAILY_ROW_LIMIT) {
            cappedDays.push(`${day} (${site.siteUrl})`);
          }
          for (const row of dayRows) {
            const [page, query] = row.keys;
            if (!page || !query) continue;
            const key = pageKey(page);
            if (!key) continue;
            const owner = owned.get(key) ?? siteIndex;
            if (owner !== siteIndex) continue;
            owned.set(key, siteIndex);
            let item: ItemRef | undefined = byKey.get(key);
            if (!item) {
              const [url = page] = page.split("#");
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
            const itemKey = `${item.source}\u0000${item.externalId}`;
            let entry = perItem.get(itemKey);
            if (!entry) {
              entry = { item, queries: new Map() };
              perItem.set(itemKey, entry);
            }
            const totals = entry.queries.get(query) ?? {
              clicks: 0,
              impressions: 0,
              weighted: 0,
            };
            totals.clicks += row.clicks;
            totals.impressions += row.impressions;
            if (
              typeof row.position === "number" &&
              Number.isFinite(row.position)
            ) {
              totals.weighted += row.position * row.impressions;
            }
            entry.queries.set(query, totals);
          }
        }
      }
      for (const { item, queries } of perItem.values()) {
        const top = [...queries.entries()]
          .sort(
            ([queryA, a], [queryB, b]) =>
              b.impressions - a.impressions ||
              b.clicks - a.clicks ||
              (queryA < queryB ? -1 : queryA > queryB ? 1 : 0),
          )
          .slice(0, perPage);
        for (const [query, totals] of top) {
          rows.push({
            itemSource: item.source,
            itemExternalId: item.externalId,
            weekStart: week,
            query,
            clicks: totals.clicks,
            impressions: totals.impressions,
            positionWeighted: totals.weighted,
          });
        }
      }
      readWeeks.push(week);
    }

    for (const week of weeks) await readWeek(week);
    const historyStartedAt = Date.now();
    let oldestRead = rereadStart;
    for (const week of historyWeeks) {
      if (Date.now() - historyStartedAt > HISTORY_BUDGET_MS) break;
      await readWeek(week);
      oldestRead = week;
    }

    return {
      items: [...newPages.values()],
      searchQueries: { weekStarts: readWeeks, rows },
      outcome: {
        rowCount: rows.length,
        windowStart: oldestRead,
        windowEnd: newestSunday,
        configFingerprint,
        detail:
          cappedDays.length > 0
            ? `Search Console stopped at its ${SEARCH_CONSOLE_DAILY_ROW_LIMIT.toLocaleString("en-US")}-row daily limit on ${cappedDays.length} ${cappedDays.length === 1 ? "day" : "days"} (${cappedDays.slice(0, 3).join(", ")}${cappedDays.length > 3 ? ", …" : ""}), so less-clicked queries are missing there.`
            : null,
      },
    };
  },
};
