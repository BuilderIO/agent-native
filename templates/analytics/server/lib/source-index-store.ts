import { getOrgSetting } from "@agent-native/core/settings";

import {
  parseSourceIndexBundle,
  type SourceIndexBundle,
  type SourceIndexEntry,
} from "./source-index-schema";

export const SOURCE_INDEX_SETTING_KEY = "analytics-source-index";
const SOURCE_INDEX_CACHE_TTL_MS = 30_000;
const MAX_SOURCE_INDEX_CACHE_ORGS = 12;
export const SOURCE_INDEX_STALE_AFTER_DAYS = 90;

export function sourceIndexFreshness(
  generatedAt: string,
  now = Date.now(),
): { ageDays: number; staleAfterDays: number; stale: boolean } {
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error("The source index timestamp is invalid.");
  }
  const ageDays = Math.max(
    0,
    Math.floor((now - generatedAtMs) / (24 * 60 * 60 * 1000)),
  );
  return {
    ageDays,
    staleAfterDays: SOURCE_INDEX_STALE_AFTER_DAYS,
    stale: ageDays >= SOURCE_INDEX_STALE_AFTER_DAYS,
  };
}

export type SourceIndexRead =
  | { status: "not-configured" }
  | { status: "unavailable" }
  | { status: "invalid" }
  | { status: "available"; bundle: SourceIndexBundle };

const sourceIndexCache = new Map<
  string,
  { expiresAt: number; result: SourceIndexRead }
>();

function cacheSourceIndex(orgId: string, result: SourceIndexRead): void {
  sourceIndexCache.delete(orgId);
  sourceIndexCache.set(orgId, {
    expiresAt: Date.now() + SOURCE_INDEX_CACHE_TTL_MS,
    result,
  });
  while (sourceIndexCache.size > MAX_SOURCE_INDEX_CACHE_ORGS) {
    const oldest = sourceIndexCache.keys().next().value;
    if (oldest === undefined) break;
    sourceIndexCache.delete(oldest);
  }
}

export function invalidateSourceIndexCache(orgId: string): void {
  sourceIndexCache.delete(orgId);
}

export async function readSourceIndex(
  orgId: string | null,
): Promise<SourceIndexRead> {
  if (!orgId) return { status: "not-configured" };
  const cached = sourceIndexCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) sourceIndexCache.delete(orgId);
  let value: Record<string, unknown> | null;
  try {
    value = await getOrgSetting(orgId, SOURCE_INDEX_SETTING_KEY);
  } catch {
    const result = { status: "unavailable" } as const;
    cacheSourceIndex(orgId, result);
    return result;
  }
  if (!value) {
    const result = { status: "not-configured" } as const;
    cacheSourceIndex(orgId, result);
    return result;
  }
  try {
    const result = {
      status: "available",
      bundle: parseSourceIndexBundle(value),
    } as const;
    cacheSourceIndex(orgId, result);
    return result;
  } catch {
    const result = { status: "invalid" } as const;
    cacheSourceIndex(orgId, result);
    return result;
  }
}

export function sourceIndexDictionaryEntries(bundle: SourceIndexBundle) {
  const sourceRevisions = bundle.sources
    .map((source) =>
      source.revision ? `${source.id}@${source.revision}` : source.id,
    )
    .join(", ");

  return bundle.entries.map((entry: SourceIndexEntry) => ({
    id: `index-${entry.id}`,
    metric: entry.metric,
    definition: entry.definition,
    source: entry.source,
    ...(entry.sourceKind ? { sourceKind: entry.sourceKind } : {}),
    table: entry.table ?? "",
    columnsUsed: entry.columnsUsed ?? "",
    dependencies: entry.dependencies ?? "",
    joinPattern: entry.joinPattern ?? "",
    commonQuestions: entry.commonQuestions ?? "",
    knownGotchas: entry.knownGotchas ?? "",
    updateFrequency: entry.updateFrequency ?? "",
    ...(entry.semanticScope && entry.semanticScope !== "unknown"
      ? { semanticScope: entry.semanticScope }
      : {}),
    sourcePath: entry.sourcePath ?? "",
    sourceRevision: entry.sourceRevision ?? "",
    sourceIndexGeneratedAt: bundle.generatedAt,
    sourceIndexSources: sourceRevisions,
    sourceIndex: true,
    approved: false,
    aiGenerated: true,
  }));
}
