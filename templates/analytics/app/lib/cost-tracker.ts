// An estimate: `totalBytesProcessed` at the on-demand list price. It is not
// the bill and not a bound on it. BigQuery bills `totalBytesBilled`, and
// capacity pricing or the free allowance can make the actual bill lower.
const COST_PER_BYTE = 6.25 / 1_000_000_000_000;
const STORAGE_KEY = "analytics_query_cost/v3";
// Earlier counters included cache hits (v1) or unconfirmed misses (v2).
// Aggregated totals cannot recover that provenance.
const LEGACY_STORAGE_KEYS = ["analytics_query_cost", "analytics_query_cost/v2"];
const TTL_MS = 24 * 60 * 60 * 1000;

interface StoredCost {
  /** Bytes processed by queries that actually scanned. */
  bytes: number;
  /** Failed/cancelled queries or positive bytes with unknown cache provenance. */
  unknownScans: number;
  startedAt: number;
}

export type QueryCostRecord = {
  status: "success" | "error" | "cancelled";
  /** App-side cache (L1/L2) served the result; absent means unknown. */
  cached?: boolean;
  /** BigQuery served the result from its own query cache; absent means unknown. */
  providerCacheHit?: boolean;
  /** Rows came from a browser snapshot, so no request produced them. */
  restored?: boolean;
  bytesProcessed?: unknown;
};

export type QueryCostOutcome =
  | { counted: number; reason: "scanned" }
  | {
      counted: 0;
      reason:
        | "app-cache"
        | "provider-cache"
        | "restored"
        | "no-bytes"
        | "invalid-bytes";
    }
  | { counted: 0; reason: "unknown-scan" };

function fresh(): StoredCost {
  return { bytes: 0, unknownScans: 0, startedAt: Date.now() };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function warn(message: string, error?: unknown) {
  // Names only: stored values and messages are not logged.
  console.warn(
    `[cost-tracker] ${message}`,
    error instanceof Error ? error.name : undefined,
  );
}

function load(): StoredCost {
  if (typeof window === "undefined") return fresh();

  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key);
        warn("discarded a legacy query cost with unverified cache provenance");
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh();
    const parsed: Partial<StoredCost> | null = JSON.parse(raw);
    if (
      !parsed ||
      !isCount(parsed.bytes) ||
      !isCount(parsed.unknownScans) ||
      !isCount(parsed.startedAt)
    ) {
      warn("discarded an invalid stored query cost");
      window.localStorage.removeItem(STORAGE_KEY);
      return fresh();
    }
    if (Date.now() - parsed.startedAt > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return fresh();
    }
    return {
      bytes: parsed.bytes,
      unknownScans: parsed.unknownScans,
      startedAt: parsed.startedAt,
    };
  } catch (error) {
    warn("could not read stored query cost", error);
    return fresh();
  }
}

function save(data: StoredCost) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // Cost tracking is advisory UI state; the in-memory total still counts.
    warn("could not store query cost", error);
  }
}

let state = load();
let listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function queryCostOutcome(record: QueryCostRecord): QueryCostOutcome {
  if (record.status !== "success") {
    return { counted: 0, reason: "unknown-scan" };
  }
  if (record.restored) return { counted: 0, reason: "restored" };
  if (record.cached) return { counted: 0, reason: "app-cache" };
  if (record.providerCacheHit) return { counted: 0, reason: "provider-cache" };
  const bytes = record.bytesProcessed;
  if (bytes === undefined || bytes === null || bytes === 0) {
    return { counted: 0, reason: "no-bytes" };
  }
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return { counted: 0, reason: "invalid-bytes" };
  }
  if (record.cached !== false || record.providerCacheHit !== false) {
    return { counted: 0, reason: "unknown-scan" };
  }
  return { counted: bytes, reason: "scanned" };
}

/**
 * Cache hits can carry the original scan's bytes. Positive bytes count only
 * when both cache layers confirm a miss; missing provenance and failed or
 * cancelled requests remain unknown rather than being priced as fresh scans.
 */
export function recordQueryCost(record: QueryCostRecord): QueryCostOutcome {
  const outcome = queryCostOutcome(record);
  if (outcome.reason === "unknown-scan") state.unknownScans += 1;
  else if (outcome.reason === "scanned") state.bytes += outcome.counted;
  else return outcome;
  save(state);
  notify();
  return outcome;
}

/** Legacy callers supply no cache provenance, so positive bytes stay unknown. */
export function addBytesProcessed(bytes: number): QueryCostOutcome {
  return recordQueryCost({ status: "success", bytesProcessed: bytes });
}

export function getTotalBytes(): number {
  return state.bytes;
}

export function getUnknownScans(): number {
  return state.unknownScans;
}

export function getTotalCost(): number {
  return state.bytes * COST_PER_BYTE;
}

export function getSessionAge(): number {
  return Date.now() - state.startedAt;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetSession() {
  state = fresh();
  save(state);
  notify();
}
