import { BigQueryMetadataError, getBigQueryTableMetadata } from "./bigquery";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
} from "./credentials-context";
import { raceWithAbort } from "./gcloud";
import {
  SOURCE_GENERATION_STALE_AFTER_MS,
  type AvailableSourceGeneration,
  type SourceGenerationEntry,
  type SourceGenerationResult,
  type SourceGenerationUnavailableReason,
  type UnavailableSourceGeneration,
} from "../../shared/source-generation.js";

export {
  SOURCE_GENERATION_STALE_AFTER_MS,
  type AvailableSourceGeneration,
  type SourceGenerationEntry,
  type SourceGenerationResult,
  type SourceGenerationUnavailableReason,
  type UnavailableSourceGeneration,
};

/** Reuse window for a table lookup, successful or not, unless forced. */
export const SOURCE_GENERATION_REUSE_MS = 60_000;
const MAX_LOOKUP_ENTRIES = 300;

const TABLE_ID_PATTERN =
  /^([a-z][a-z0-9-]{4,61}[a-z0-9])\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

interface LookupEntry {
  entry: SourceGenerationEntry;
  checkedAtMs: number;
}

const lookups = new Map<string, LookupEntry>();
const inFlight = new Map<string, Promise<LookupEntry>>();

function unavailable(
  tableId: string,
  reason: SourceGenerationUnavailableReason,
  checkedAtMs: number,
): LookupEntry {
  return {
    entry: {
      tableId,
      status: "unavailable",
      reason,
      checkedAt: new Date(checkedAtMs).toISOString(),
    },
    checkedAtMs,
  };
}

// Shared by concurrent callers, so it takes no caller signal: one caller
// aborting must not fail the lookup for the others.
async function lookUpTable(tableId: string): Promise<LookupEntry> {
  const match = TABLE_ID_PATTERN.exec(tableId);
  if (!match) return unavailable(tableId, "invalid_table_id", Date.now());
  const [, projectId, datasetId, table] = match;
  try {
    const metadata = await getBigQueryTableMetadata(
      { projectId, datasetId, tableId: table },
      undefined,
      { fresh: true },
    );
    const checkedAtMs = Date.now();
    const modifiedMs = Number(metadata.lastModifiedTime);
    if (!metadata.lastModifiedTime || !Number.isSafeInteger(modifiedMs)) {
      return unavailable(tableId, "no_modified_time", checkedAtMs);
    }
    return {
      entry: {
        tableId,
        status: "ok",
        generation: String(modifiedMs),
        modifiedAt: new Date(modifiedMs).toISOString(),
        checkedAt: new Date(checkedAtMs).toISOString(),
      },
      checkedAtMs,
    };
  } catch (error) {
    const reason =
      error instanceof BigQueryMetadataError && error.status === 404
        ? "not_found"
        : error instanceof BigQueryMetadataError && error.status === 403
          ? "access_denied"
          : "lookup_failed";
    return unavailable(tableId, reason, Date.now());
  }
}

async function tableGeneration(
  tableId: string,
  options: { force: boolean; signal?: AbortSignal },
): Promise<SourceGenerationEntry> {
  const key = `${credentialCacheScope(
    "BIGQUERY_PROJECT_ID",
    requireRequestCredentialContext("BIGQUERY_PROJECT_ID"),
  )}\n${tableId}`;
  const reused = lookups.get(key);
  if (
    !options.force &&
    reused &&
    Date.now() - reused.checkedAtMs < SOURCE_GENERATION_REUSE_MS
  ) {
    return reused.entry;
  }
  let pending = inFlight.get(key);
  if (!pending) {
    pending = lookUpTable(tableId).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  const looked = await raceWithAbort(pending, options.signal);
  lookups.delete(key);
  if (lookups.size >= MAX_LOOKUP_ENTRIES) {
    const oldest = lookups.keys().next().value;
    if (oldest !== undefined) lookups.delete(oldest);
  }
  lookups.set(key, looked);
  return looked.entry;
}

/**
 * Read the generation of each table with BigQuery's table metadata call,
 * which runs no query job and bills nothing. Read it before submitting the
 * query that depends on it, so a result is never labeled newer than the
 * data it read.
 */
export async function resolveSourceGeneration(
  tableIds: readonly string[],
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<SourceGenerationResult> {
  const unique = [...new Set(tableIds)].sort();
  if (unique.length === 0) {
    throw new Error("resolveSourceGeneration needs at least one table");
  }
  const sources = await Promise.all(
    unique.map((tableId) =>
      tableGeneration(tableId, {
        force: options.force === true,
        signal: options.signal,
      }),
    ),
  );
  const oldestCheckedAt = sources
    .map((source) => source.checkedAt)
    .sort()[0];
  const missing = sources.find(
    (source): source is UnavailableSourceGeneration =>
      source.status === "unavailable",
  );
  if (missing) {
    return {
      status: "unavailable",
      sources,
      reason: missing.reason,
      checkedAt: oldestCheckedAt,
    };
  }
  const available = sources as AvailableSourceGeneration[];
  const oldestModifiedAt = available
    .map((source) => source.modifiedAt)
    .sort()[0];
  const ageMs = Math.max(0, Date.now() - Date.parse(oldestModifiedAt));
  return {
    status: "ok",
    sources: available,
    generation: available
      .map((source) => `${source.tableId}@${source.generation}`)
      .join(","),
    oldestModifiedAt,
    ageMs,
    stale: ageMs > SOURCE_GENERATION_STALE_AFTER_MS,
    checkedAt: oldestCheckedAt,
  };
}

export function resetSourceGenerationLookupsForTests(): void {
  lookups.clear();
  inFlight.clear();
}
