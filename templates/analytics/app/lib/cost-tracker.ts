// An estimate: `totalBytesProcessed` at the on-demand list price. It is not
// the bill and not a bound on it. BigQuery bills `totalBytesBilled`, and
// capacity pricing or the free allowance can make the actual bill lower.
const COST_PER_BYTE = 6.25 / 1_000_000_000_000;
const STORAGE_KEY = "analytics_query_cost/v2";
// Version 1 added `bytesProcessed` for every response, including app-cache and
// provider-cache hits that scanned nothing, so its totals cannot be corrected.
const LEGACY_STORAGE_KEY = "analytics_query_cost";
const TTL_MS = 24 * 60 * 60 * 1000;

interface StoredCost {
  /** Bytes processed by queries that actually scanned. */
  bytes: number;
  /** Failed or cancelled scans, whose bytes are unknown rather than zero. */
  unknownScans: number;
  startedAt: number;
}

export type QueryCostRecord = {
  status: "success" | "error" | "cancelled";
  /** App-side cache (L1/L2) served the result. */
  cached?: boolean;
  /** BigQuery served the result from its own query cache. */
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
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
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

/**
 * Counts one finished query. Only a result that actually scanned adds bytes:
 * an app-cache hit, a provider-cache hit and restored browser rows carry the
 * original scan's `bytesProcessed` but cost nothing now. A failed or cancelled
 * query may have scanned something, so it is tallied as unknown, never as 0.
 */
export function recordQueryCost(record: QueryCostRecord): QueryCostOutcome {
  if (record.status !== "success") {
    state.unknownScans += 1;
    save(state);
    notify();
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
  state.bytes += bytes;
  save(state);
  notify();
  return { counted: bytes, reason: "scanned" };
}

export function addBytesProcessed(bytes: number) {
  recordQueryCost({ status: "success", bytesProcessed: bytes });
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
