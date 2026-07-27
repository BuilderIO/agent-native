export interface IngestionInventoryCandidate {
  externalId: string;
  sourceModifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestionHydrationPolicy {
  selectedExternalIds?: readonly string[];
  canonicalExternalIds?: readonly string[];
  pinnedExternalIds?: readonly string[];
  recentWindowMonths?: number;
  hydrateAll?: boolean;
  now?: Date;
}

export interface IngestionHydrationSelection<T> {
  selected: T[];
  deferred: T[];
  reasons: Record<
    string,
    "confirmed" | "canonical" | "pinned" | "recent" | "undated" | "all"
  >;
}

export function selectInventoryForHydration<
  T extends IngestionInventoryCandidate,
>(
  inventory: readonly T[],
  policy: IngestionHydrationPolicy = {},
): IngestionHydrationSelection<T> {
  const confirmed = stringSet(policy.selectedExternalIds);
  const canonical = stringSet(policy.canonicalExternalIds);
  const pinned = stringSet(policy.pinnedExternalIds);
  const hasConfirmedSelection = policy.selectedExternalIds !== undefined;
  const now = policy.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setUTCMonth(
    cutoff.getUTCMonth() - positiveInteger(policy.recentWindowMonths, 12),
  );
  const selected: T[] = [];
  const deferred: T[] = [];
  const reasons: IngestionHydrationSelection<T>["reasons"] = {};
  for (const item of inventory) {
    let reason: IngestionHydrationSelection<T>["reasons"][string] | undefined;
    if (policy.hydrateAll) reason = "all";
    else if (confirmed.has(item.externalId)) reason = "confirmed";
    else if (
      canonical.has(item.externalId) ||
      item.metadata?.canonical === true
    )
      reason = "canonical";
    else if (pinned.has(item.externalId) || item.metadata?.pinned === true)
      reason = "pinned";
    else if (!hasConfirmedSelection) {
      const modifiedAt = parsedDate(item.sourceModifiedAt);
      if (!modifiedAt) reason = "undated";
      else if (modifiedAt >= cutoff) reason = "recent";
    }
    if (reason) {
      selected.push(item);
      reasons[item.externalId] = reason;
    } else {
      deferred.push(item);
    }
  }
  return { selected, deferred, reasons };
}

function stringSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function parsedDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}
