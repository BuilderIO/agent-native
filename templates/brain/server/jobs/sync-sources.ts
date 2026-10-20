import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, gt, inArray, lte } from "drizzle-orm";

import type { BrainSourceProvider } from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "../lib/brain.js";
import { runConnectorSync } from "../lib/connectors.js";

const DEFAULT_POLL_MINUTES = 60;
const SYNC_INTERVAL_MS = 60 * 1000;
const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 20;
const AUTO_SYNC_PROVIDERS: BrainSourceProvider[] = [
  "slack",
  "granola",
  "github",
  "zoom",
];
let skippingLogged = false;
let running = false;

type SourceRow = typeof schema.brainSources.$inferSelect;
const RETRYABLE_SOURCE_STATUSES: SourceRow["status"][] = ["active", "error"];

function configuredPollMinutes(source: SourceRow): number {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const raw =
    config.pollMinutes ??
    config.syncEveryMinutes ??
    config.connectorPollMinutes;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(value)
    ? Math.max(5, Math.min(1440, Math.floor(value)))
    : DEFAULT_POLL_MINUTES;
}

function isAutoSyncEnabled(source: SourceRow): boolean {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  if (config.autoSync === false) return false;
  return AUTO_SYNC_PROVIDERS.includes(source.provider as BrainSourceProvider);
}

function transientRetryAt(source: SourceRow) {
  const cursor = parseJson<Record<string, unknown>>(source.cursorJson, {});
  const value = cursor.transientRetryAt;
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

function retryAfterAt(source: SourceRow): number | null {
  const cursor = parseJson<Record<string, unknown>>(source.cursorJson, {});
  const retry = parseJson<Record<string, unknown>>(
    typeof cursor.retry === "string" ? cursor.retry : undefined,
    typeof cursor.retry === "object" && cursor.retry
      ? (cursor.retry as Record<string, unknown>)
      : {},
  );
  const retryAt =
    typeof retry.retryAfterAt === "string"
      ? Date.parse(retry.retryAfterAt)
      : Number.NaN;
  return Number.isFinite(retryAt) ? retryAt : null;
}

function sourceSyncDueAt(source: SourceRow, nowMs: number): number | null {
  if (!RETRYABLE_SOURCE_STATUSES.includes(source.status)) return null;
  if (!isAutoSyncEnabled(source)) return null;

  const pollIntervalMs = configuredPollMinutes(source) * 60 * 1000;
  let pollAt = nowMs;
  if (source.status === "error") {
    const failedAt = Date.parse(source.updatedAt);
    if (Number.isFinite(failedAt)) pollAt = failedAt + pollIntervalMs;
    const transientAt = transientRetryAt(source);
    if (Number.isFinite(transientAt)) pollAt = Math.min(pollAt, transientAt);
  } else if (source.lastSyncedAt) {
    const lastSynced = Date.parse(source.lastSyncedAt);
    if (Number.isFinite(lastSynced)) pollAt = lastSynced + pollIntervalMs;
  }

  return Math.max(pollAt, retryAfterAt(source) ?? Number.NEGATIVE_INFINITY);
}

export function isBrainSourceDue(
  source: SourceRow,
  nowMs = Date.now(),
): boolean {
  const dueAt = sourceSyncDueAt(source, nowMs);
  return dueAt !== null && dueAt <= nowMs;
}

export function nextBrainSourceSyncAt(source: SourceRow): string | null {
  const dueAt = sourceSyncDueAt(source, Date.now());
  return dueAt === null ? null : new Date(dueAt).toISOString();
}

export interface SourceScanPage {
  afterId: string | null;
  upToId: string | null;
}

const PIVOT_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomScanPivot(): string {
  let pivot = "";
  for (let i = 0; i < 12; i += 1) {
    pivot += PIVOT_ALPHABET[Math.floor(Math.random() * PIVOT_ALPHABET.length)];
  }
  return pivot;
}

// Scans in id order from a random pivot, wrapping to the start, until enough
// rows are due. A fixed window or a fixed start lets never-due rows (auto-sync
// off, dead errors) permanently crowd later sources out of every capped sweep.
export async function collectDueSources(
  fetchPage: (page: SourceScanPage) => Promise<SourceRow[]>,
  limit: number,
  nowMs = Date.now(),
  pivot = randomScanPivot(),
): Promise<{ sources: SourceRow[]; truncated: boolean }> {
  const due: SourceRow[] = [];
  const segments: SourceScanPage[] = [
    { afterId: pivot, upToId: null },
    { afterId: null, upToId: pivot },
  ];
  let pages = 0;
  for (const segment of segments) {
    let afterId = segment.afterId;
    while (true) {
      if (pages >= SCAN_MAX_PAGES) return { sources: due, truncated: true };
      pages += 1;
      const rows = await fetchPage({ afterId, upToId: segment.upToId });
      for (const source of rows) {
        if (isBrainSourceDue(source, nowMs)) due.push(source);
        if (due.length >= limit) return { sources: due, truncated: false };
      }
      if (rows.length < SCAN_PAGE_SIZE) break;
      afterId = rows[rows.length - 1]!.id;
    }
  }
  return { sources: due, truncated: false };
}

export async function listDueBrainSources(
  options: {
    limit?: number;
    system?: boolean;
  } = {},
) {
  const db = getDb();
  const eligible = and(
    inArray(schema.brainSources.status, RETRYABLE_SOURCE_STATUSES),
    inArray(schema.brainSources.provider, AUTO_SYNC_PROVIDERS),
  );
  const where = options.system
    ? // guard:allow-unscoped — system scheduler enumerates retryable sources,
      // then re-enters each row's owner/org context before syncing.
      eligible
    : and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        eligible,
      );
  return collectDueSources(
    ({ afterId, upToId }) =>
      db
        .select()
        .from(schema.brainSources)
        .where(
          and(
            where,
            afterId ? gt(schema.brainSources.id, afterId) : undefined,
            upToId ? lte(schema.brainSources.id, upToId) : undefined,
          ),
        )
        .orderBy(asc(schema.brainSources.id))
        .limit(SCAN_PAGE_SIZE),
    options.limit ?? 10,
  );
}

export async function syncDueBrainSourcesOnce(
  options: {
    limit?: number;
    system?: boolean;
  } = {},
) {
  const { sources: due, truncated } = await listDueBrainSources(options);
  const results: Array<{
    sourceId: string;
    provider: BrainSourceProvider;
    status: string;
    capturesCreated: number;
    message?: string;
  }> = [];
  for (const source of due) {
    const run = async () => {
      try {
        const result = await runConnectorSync(source);
        results.push({
          sourceId: source.id,
          provider: source.provider as BrainSourceProvider,
          status: result.status,
          capturesCreated: result.capturesCreated,
          message: result.message,
        });
      } catch (err) {
        results.push({
          sourceId: source.id,
          provider: source.provider as BrainSourceProvider,
          status: "error",
          capturesCreated: 0,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };
    if (options.system) {
      await runWithRequestContext(
        { userEmail: source.ownerEmail, orgId: source.orgId ?? undefined },
        run,
      );
    } else {
      await run();
    }
  }
  if (truncated) {
    console.warn(
      `[brain-source-sync] Source scan hit its ${SCAN_MAX_PAGES * SCAN_PAGE_SIZE}-row cap; some sources were not checked this sweep (the next sweep starts at a different point).`,
    );
  }
  return { checked: due.length, scanTruncated: truncated, results };
}

export default function registerBrainSourceSyncJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[brain-source-sync] Skipping background sync (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    if (running) return;
    running = true;
    syncDueBrainSourcesOnce({ system: true, limit: 5 })
      .then((result) => {
        if (result.results.length) {
          console.log(
            `[brain-source-sync] synced ${result.results.length} due source(s).`,
          );
        }
      })
      .catch((err) =>
        console.error("[brain-source-sync] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, SYNC_INTERVAL_MS);
}
