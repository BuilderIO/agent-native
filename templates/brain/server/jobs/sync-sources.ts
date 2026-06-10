import { and, eq, ne } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../db/index.js";
import { nowIso, parseJson } from "../lib/brain.js";
import { runConnectorSync } from "../lib/connectors.js";
import type { BrainSourceProvider } from "../../shared/types.js";

const DEFAULT_POLL_MINUTES = 60;
const SYNC_INTERVAL_MS = 60 * 1000;
let skippingLogged = false;
let running = false;

type SourceRow = typeof schema.brainSources.$inferSelect;

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
  return (
    source.provider === "slack" ||
    source.provider === "granola" ||
    source.provider === "github"
  );
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

export function isBrainSourceDue(
  source: SourceRow,
  nowMs = Date.now(),
): boolean {
  if (source.status !== "active") return false;
  if (!isAutoSyncEnabled(source)) return false;
  const retryAt = retryAfterAt(source);
  if (retryAt && retryAt > nowMs) return false;
  if (!source.lastSyncedAt) return true;
  const lastSynced = Date.parse(source.lastSyncedAt);
  if (!Number.isFinite(lastSynced)) return true;
  return nowMs - lastSynced >= configuredPollMinutes(source) * 60 * 1000;
}

export function nextBrainSourceSyncAt(source: SourceRow): string | null {
  if (source.status !== "active" || !isAutoSyncEnabled(source)) return null;
  const retryAt = retryAfterAt(source);
  if (retryAt) return new Date(retryAt).toISOString();
  if (!source.lastSyncedAt) return nowIso();
  const lastSynced = Date.parse(source.lastSyncedAt);
  if (!Number.isFinite(lastSynced)) return nowIso();
  return new Date(
    lastSynced + configuredPollMinutes(source) * 60 * 1000,
  ).toISOString();
}

export async function listDueBrainSources(
  options: {
    limit?: number;
    system?: boolean;
  } = {},
) {
  const db = getDb();
  const where = options.system
    ? // guard:allow-unscoped — system scheduler enumerates active sources,
      // then re-enters each row's owner/org context before syncing.
      and(
        eq(schema.brainSources.status, "active"),
        ne(schema.brainSources.provider, "manual"),
      )
    : and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        eq(schema.brainSources.status, "active"),
        ne(schema.brainSources.provider, "manual"),
      );
  const rows = await db
    .select()
    .from(schema.brainSources)
    .where(where)
    .limit((options.limit ?? 10) * 4);
  return rows
    .filter((source) => isBrainSourceDue(source))
    .slice(0, options.limit ?? 10);
}

export async function syncDueBrainSourcesOnce(
  options: {
    limit?: number;
    system?: boolean;
  } = {},
) {
  const due = await listDueBrainSources(options);
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
  return { checked: due.length, results };
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
