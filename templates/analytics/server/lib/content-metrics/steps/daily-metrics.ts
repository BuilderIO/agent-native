import type { ContentCollectionStepId } from "../config.js";
import {
  lastSucceededContentRun,
  listContentRunWindows,
  type ContentCollection,
  type ContentSnapshotInput,
  type StoredContentItem,
} from "../store.js";

/** A step's first successful run reaches back this far. */
export const BACKFILL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Days to collect: through yesterday (UTC), reaching back `lookbackDays` so a
 * source's late or revised numbers are fetched again. Gaps since the last
 * covered day extend the window, up to `BACKFILL_DAYS`.
 */
export async function collectionWindow(
  collection: ContentCollection,
  step: ContentCollectionStepId,
  now: Date,
  lookbackDays: number,
  configFingerprint?: string,
): Promise<{ startDate: string; endDate: string }> {
  const end = new Date(now.getTime() - DAY_MS);
  const previous = await lastSucceededContentRun(collection, step);
  const earliest = end.getTime() - (BACKFILL_DAYS - 1) * DAY_MS;
  const lookback = end.getTime() - (lookbackDays - 1) * DAY_MS;
  const sameConfig =
    configFingerprint === undefined ||
    previous?.configFingerprint === configFingerprint;
  const uncovered =
    previous?.windowEnd && sameConfig
      ? new Date(`${previous.windowEnd}T00:00:00Z`).getTime() + DAY_MS
      : earliest;
  const start = Math.max(earliest, Math.min(lookback, uncovered));
  return {
    startDate: utcDate(new Date(start)),
    endDate: utcDate(end),
  };
}

export function daysFrom(startDate: string, endDate: string): number {
  return Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() -
      new Date(`${startDate}T00:00:00Z`).getTime()) /
      DAY_MS,
  );
}

export function addDays(date: string, days: number): string {
  return utcDate(
    new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS),
  );
}

export function monthsEndingOn(endDate: string, months: number): string {
  const end = new Date(`${endDate}T00:00:00Z`);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const start = new Date(
    Date.UTC(year, month, Math.min(end.getUTCDate(), lastDay)),
  );
  return addDays(utcDate(start), 1);
}

export async function coveredSince(
  collection: ContentCollection,
  step: ContentCollectionStepId,
  configFingerprint: string,
  anchorStart: string,
): Promise<string> {
  const runs = await listContentRunWindows(collection, step);
  const changedAt = runs
    .filter((run) => run.configFingerprint !== configFingerprint)
    .reduce(
      (latest, run) => (run.startedAt > latest ? run.startedAt : latest),
      "",
    );
  const windows = runs.filter(
    (run) =>
      run.configFingerprint === configFingerprint && run.startedAt > changedAt,
  );
  let start = anchorStart;
  for (let joined = true; joined; ) {
    joined = false;
    const dayBefore = addDays(start, -1);
    for (const window of windows) {
      if (window.windowStart < start && window.windowEnd >= dayBefore) {
        start = window.windowStart;
        joined = true;
      }
    }
  }
  return start;
}

function datesThrough(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (
    let day = new Date(`${startDate}T00:00:00Z`);
    utcDate(day) <= endDate;
    day = new Date(day.getTime() + DAY_MS)
  ) {
    dates.push(utcDate(day));
  }
  return dates;
}

/**
 * Host without `www.` plus the decoded path without a trailing slash, query
 * or fragment, lowercased: the key that matches one page across GA4, Search
 * Console and the stored item URLs. `null` for a URL that can't be read,
 * which no item can match.
 */
export function pageKey(rawUrl: string): string | null {
  if (!URL.canParse(rawUrl)) return null;
  const url = new URL(rawUrl);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
    // coercion-ok: a malformed escape gets the typed null key, which callers skip as unmatchable
  } catch {
    return null;
  }
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return `${url.hostname.replace(/^www\./, "")}${path}`.toLowerCase();
}

export type ItemRef = Pick<StoredContentItem, "source" | "externalId"> & {
  publishedAt: string | null;
};

function refKey(item: Pick<ItemRef, "source" | "externalId">): string {
  return `${item.source}\u0000${item.externalId}`;
}

/** Per-item, per-day metric values as a source returned them. */
export class DailyMetricValues {
  private readonly values = new Map<
    string,
    { item: ItemRef; days: Map<string, Record<string, number>> }
  >();

  add(item: ItemRef, date: string, metric: string, value: number): void {
    const key = refKey(item);
    let entry = this.values.get(key);
    if (!entry) {
      entry = { item, days: new Map() };
      this.values.set(key, entry);
    }
    const day = entry.days.get(date) ?? {};
    day[metric] = (day[metric] ?? 0) + value;
    entry.days.set(date, day);
  }

  /**
   * Snapshots for every item in scope on every day from `startDate` through
   * the last day the source returned any row for. GA4 leaves out a page with
   * no traffic, so inside that range a missing value is a real 0. Search
   * Console can omit traffic and uses fillMissing=false. A later day gets no
   * row at all and the view reads it as not collected.
   */
  snapshots(options: {
    items: ItemRef[];
    metrics: string[];
    startDate: string;
    lastReturnedDate: string | null;
    fillMissing?: boolean;
  }): ContentSnapshotInput[] {
    if (!options.lastReturnedDate) return [];
    const items = new Map(options.items.map((item) => [refKey(item), item]));
    for (const [key, entry] of this.values) {
      if (!items.has(key)) items.set(key, entry.item);
    }
    const dates = datesThrough(options.startDate, options.lastReturnedDate);
    const snapshots: ContentSnapshotInput[] = [];
    for (const [key, item] of items) {
      const days = this.values.get(key)?.days;
      const published = item.publishedAt?.slice(0, 10) ?? null;
      for (const date of dates) {
        const day = days?.get(date);
        if (options.fillMissing === false && !day) continue;
        if (!day && published && date < published) continue;
        for (const metric of options.metrics) {
          if (options.fillMissing === false && day?.[metric] === undefined)
            continue;
          snapshots.push({
            itemSource: item.source,
            itemExternalId: item.externalId,
            metricDate: date,
            metric,
            value: day?.[metric] ?? 0,
          });
        }
      }
    }
    return snapshots;
  }
}
