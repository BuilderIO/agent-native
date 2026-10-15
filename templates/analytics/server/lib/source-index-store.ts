import { createHash } from "node:crypto";

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

export type SourceIndexFreshness = {
  ageDays: number;
  staleAfterDays: number;
  stale: boolean;
};

export function sourceIndexFreshness(
  generatedAt: string,
  now = Date.now(),
): SourceIndexFreshness {
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

export type SourceIndexScanCoverage = {
  unsafeEntriesOmitted: number | null;
  unsafeFieldsOmitted: number | null;
  truncatedFields: number | null;
  unresolvedTrackingCallSites: number | null;
};

export function sourceIndexScanCoverage(
  bundle: SourceIndexBundle,
): SourceIndexScanCoverage {
  const summary = bundle.scanSummary;
  return {
    unsafeEntriesOmitted: summary?.unsafeEntriesOmitted ?? null,
    unsafeFieldsOmitted: summary?.unsafeFieldsOmitted ?? null,
    truncatedFields: summary?.truncatedFields ?? null,
    unresolvedTrackingCallSites: summary?.unresolvedTrackingCallSites ?? null,
  };
}

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

export function mergeSourceIndexBundles(
  current: SourceIndexBundle | null,
  update: SourceIndexBundle,
): SourceIndexBundle {
  if (!current) return update;

  const sourceKind = (bundle: SourceIndexBundle, sourceId: string) => {
    const declared = bundle.sources.find(
      (source) => source.id === sourceId,
    )?.sourceKind;
    if (declared) return declared;
    const kinds = new Set(
      bundle.entries
        .filter((entry) => entry.source === sourceId)
        .map((entry) => entry.sourceKind)
        .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined),
    );
    return kinds.size === 1 ? kinds.values().next().value : undefined;
  };

  const sourceIdMap = new Map<string, string>();
  for (const source of update.sources) {
    const matchingSource = current.sources.find(
      (candidate) => candidate.id === source.id,
    );
    const currentHasSource =
      matchingSource !== undefined ||
      current.entries.some((entry) => entry.source === source.id);
    if (!currentHasSource) {
      sourceIdMap.set(source.id, source.id);
      continue;
    }

    const currentKind = sourceKind(current, source.id);
    const updateKind = sourceKind(update, source.id);
    if (!currentKind || !updateKind || currentKind !== updateKind) {
      throw new Error(
        `Source ID "${source.id}" has conflicting or unknown source types; no index was written.`,
      );
    }

    // The configured GitHub repository may change while keeping the same
    // repository basename. Preserve the old source and give the new one a
    // stable ID so neither repository's indexed metadata is silently lost.
    if (
      updateKind === "dbt" &&
      matchingSource?.repositoryRef !== source.repositoryRef
    ) {
      const refSlug = (source.repositoryRef ?? "unknown-repository")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      const refHash = createHash("sha256")
        .update(source.repositoryRef ?? "unknown-repository")
        .digest("hex")
        .slice(0, 8);
      const suffix = `${refSlug}-${refHash}`;
      const uniqueId = `${source.id.slice(0, 80 - suffix.length - 1)}-${suffix}`;
      const existingUniqueSource = current.sources.find(
        (candidate) => candidate.id === uniqueId,
      );
      if (
        existingUniqueSource &&
        (existingUniqueSource.repositoryRef !== source.repositoryRef ||
          sourceKind(current, existingUniqueSource.id) !== updateKind)
      ) {
        throw new Error(
          `Source ID "${uniqueId}" is already assigned to another repository; no index was written.`,
        );
      }
      sourceIdMap.set(source.id, uniqueId);
      continue;
    }
    sourceIdMap.set(source.id, source.id);
  }

  const updatedSources = update.sources.map((source) => ({
    ...source,
    id: sourceIdMap.get(source.id) ?? source.id,
    sourceKind: source.sourceKind ?? sourceKind(update, source.id),
    generatedAt: source.generatedAt ?? update.generatedAt,
  }));
  const replacedSourceIds = new Set(updatedSources.map((source) => source.id));
  const preservedSources = current.sources
    .filter((source) => !replacedSourceIds.has(source.id))
    .map((source) => ({
      ...source,
      generatedAt: source.generatedAt ?? current.generatedAt,
    }));
  const sources = [...preservedSources, ...updatedSources];
  const preservedEntries = current.entries.filter(
    (entry) => !replacedSourceIds.has(entry.source),
  );
  const updatedDbtRepositories = new Set(
    update.sources
      .filter((source) => sourceKind(update, source.id) === "dbt")
      .map((source) => source.repositoryRef)
      .filter((repositoryRef): repositoryRef is string =>
        Boolean(repositoryRef),
      ),
  );
  const retiredDbtSourceIds = new Set(
    current.sources
      .filter(
        (source) =>
          sourceKind(current, source.id) === "dbt" &&
          source.repositoryRef &&
          !updatedDbtRepositories.has(source.repositoryRef),
      )
      .map((source) => source.id),
  );
  const retainedEntries = preservedEntries.map((entry) =>
    retiredDbtSourceIds.has(entry.source)
      ? { ...entry, status: "deprecated" as const }
      : entry,
  );
  const reservedEntryIds = new Set(retainedEntries.map((entry) => entry.id));
  const entries = [
    ...retainedEntries,
    ...update.entries.map((entry) => {
      const source = sourceIdMap.get(entry.source) ?? entry.source;
      let id = entry.id;
      if (reservedEntryIds.has(id)) {
        const suffix = createHash("sha256")
          .update(source)
          .digest("hex")
          .slice(0, 8);
        let counter = 1;
        do {
          const counterSuffix = counter === 1 ? suffix : `${suffix}-${counter}`;
          id = `${entry.id.slice(0, 120 - counterSuffix.length - 1)}-${counterSuffix}`;
          counter += 1;
        } while (reservedEntryIds.has(id));
      }
      reservedEntryIds.add(id);
      return { ...entry, id, source };
    }),
  ];
  const generatedAt = sources.reduce((latest, source) => {
    const sourceGeneratedAt = source.generatedAt ?? update.generatedAt;
    return Date.parse(sourceGeneratedAt) > Date.parse(latest)
      ? sourceGeneratedAt
      : latest;
  }, current.generatedAt);
  // Existing scan counts describe the entire old bundle, so they cannot be
  // combined accurately after replacing only one source.
  const merged: SourceIndexBundle = {
    ...update,
    generatedAt,
    sources,
    entries,
  };
  if (preservedSources.length > 0) delete merged.scanSummary;

  return parseSourceIndexBundle(merged);
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

export function sourceIndexDictionaryEntries(
  bundle: SourceIndexBundle,
  freshness = sourceIndexFreshness(bundle.generatedAt),
  now = Date.now(),
) {
  const sourceRevisions = bundle.sources
    .map((source) =>
      source.revision ? `${source.id}@${source.revision}` : source.id,
    )
    .join(", ");

  const generatedAtBySource = new Map(
    bundle.sources.map((source) => [source.id, source.generatedAt]),
  );

  return bundle.entries.map((entry: SourceIndexEntry) => {
    const entryGeneratedAt =
      generatedAtBySource.get(entry.source) ?? bundle.generatedAt;
    const entryFreshness =
      entryGeneratedAt === bundle.generatedAt
        ? freshness
        : sourceIndexFreshness(entryGeneratedAt, now);

    return {
      id: `index-${entry.id}`,
      metric: entry.metric,
      definition: entry.definition,
      source: entry.source,
      ...(entry.sourceKind ? { sourceKind: entry.sourceKind } : {}),
      ...(entry.entryType ? { entryType: entry.entryType } : {}),
      status: entry.status,
      ...(entry.owner ? { owner: entry.owner } : {}),
      ...(entry.grain ? { grain: entry.grain } : {}),
      ...(entry.primaryEntity ? { primaryEntity: entry.primaryEntity } : {}),
      ...(entry.timeDimension ? { timeDimension: entry.timeDimension } : {}),
      ...(entry.semanticModel ? { semanticModel: entry.semanticModel } : {}),
      table: entry.table ?? "",
      columnsUsed: entry.columnsUsed ?? "",
      ...(entry.sqlProjectedColumns
        ? { sqlProjectedColumns: entry.sqlProjectedColumns }
        : {}),
      ...(entry.inferredMembershipKeys
        ? { inferredMembershipKeys: entry.inferredMembershipKeys }
        : {}),
      ...(entry.inferredMembershipKeyRoles
        ? { inferredMembershipKeyRoles: entry.inferredMembershipKeyRoles }
        : {}),
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
      sourceIndexGeneratedAt: entryGeneratedAt,
      sourceIndexSources: sourceRevisions,
      sourceIndexAgeDays: entryFreshness.ageDays,
      sourceIndexStaleAfterDays: entryFreshness.staleAfterDays,
      sourceIndexStale: entryFreshness.stale,
      sourceIndex: true,
      approved: false,
      aiGenerated: true,
    };
  });
}
