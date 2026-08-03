/**
 * Aggregating perf recorder for the design editor. Hot paths run per animation
 * frame, so a `console.log` per call measurably slows the thing being measured
 * — samples are accumulated in memory and only printed on a flush interval.
 */

export const DESIGN_PERF_STORAGE_KEY = "agent-native.design.perf";
export const DESIGN_PERF_QUERY_PARAM = "perf";

export interface PerfSample {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

export type PerfSnapshot = Record<string, PerfSample>;

/** No-op returned by `start()` while recording is off, so a disabled recorder
 * allocates nothing per call. */
const NOOP_END = () => 0;

export interface PerfRecorder {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  /** Begin timing; call the returned function to record the elapsed ms. */
  start(label: string): () => number;
  record(label: string, ms: number): void;
  /** Count an occurrence with no duration (renders, effect runs, cache misses). */
  count(label: string, times?: number): void;
  snapshot(): PerfSnapshot;
  reset(): void;
}

export function createPerfRecorder(
  options: {
    now?: () => number;
    enabled?: boolean;
  } = {},
): PerfRecorder {
  const now =
    options.now ??
    (typeof performance !== "undefined"
      ? () => performance.now()
      : () => Date.now());
  let enabled = options.enabled ?? false;
  const samples = new Map<string, PerfSample>();

  const bump = (label: string, ms: number, times: number) => {
    const existing = samples.get(label);
    if (existing) {
      existing.count += times;
      existing.totalMs += ms;
      existing.lastMs = ms;
      if (ms > existing.maxMs) existing.maxMs = ms;
      return;
    }
    samples.set(label, {
      count: times,
      totalMs: ms,
      maxMs: ms,
      lastMs: ms,
    });
  };

  return {
    isEnabled: () => enabled,
    setEnabled: (next) => {
      enabled = next;
      if (!next) samples.clear();
    },
    start: (label) => {
      if (!enabled) return NOOP_END;
      const startedAt = now();
      return () => {
        const elapsed = now() - startedAt;
        bump(label, elapsed, 1);
        return elapsed;
      };
    },
    record: (label, ms) => {
      if (!enabled) return;
      bump(label, ms, 1);
    },
    count: (label, times = 1) => {
      if (!enabled) return;
      bump(label, 0, times);
    },
    snapshot: () => {
      const result: PerfSnapshot = {};
      for (const [label, sample] of samples) result[label] = { ...sample };
      return result;
    },
    reset: () => samples.clear(),
  };
}

export interface PerfReportRow {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

/** Rows sorted by total time spent — the thing to optimise is at the top.
 * Pure count-only labels (renders) sort last since their total is 0. */
export function buildPerfReport(snapshot: PerfSnapshot): PerfReportRow[] {
  return Object.entries(snapshot)
    .map(([label, sample]) => ({
      label,
      count: sample.count,
      totalMs: round(sample.totalMs),
      avgMs: round(sample.count > 0 ? sample.totalMs / sample.count : 0),
      maxMs: round(sample.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PerfEnabledSource = "query" | "storage" | "default";

export interface PerfEnabledResolution {
  enabled: boolean;
  source: PerfEnabledSource;
}

/**
 * `?perf=1` / `?perf=0` wins over the stored value so a URL can turn profiling
 * on for one session without leaving it on. Reports its source so the caller
 * can tell "explicitly off" from "never switched on".
 */
export function resolvePerfEnabled(args: {
  search?: string | null;
  stored?: string | null;
}): PerfEnabledResolution {
  const query = readQueryFlag(args.search);
  if (query !== null) return { enabled: query, source: "query" };
  if (args.stored === "1" || args.stored === "true") {
    return { enabled: true, source: "storage" };
  }
  if (args.stored === "0" || args.stored === "false") {
    return { enabled: false, source: "storage" };
  }
  return { enabled: false, source: "default" };
}

function readQueryFlag(search: string | null | undefined): boolean | null {
  if (!search) return null;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  if (!params.has(DESIGN_PERF_QUERY_PARAM)) return null;
  const raw = (params.get(DESIGN_PERF_QUERY_PARAM) ?? "").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}
