import {
  type AppActivity,
  type AppActivityWindow,
  type RecorderReport,
  sanitizeAppActivity,
} from "@shared/app-activity";
import { BROWSER_DIAGNOSTIC_LOOKBACK_MS } from "@shared/browser-diagnostics";

// Reading app activity from an agent-native page's recorder, and placing it on
// the recording's diagnostics clock. Kept apart from the chrome.* calls in
// background.ts so the conversion and its limits are unit-tested here.

export const MAX_RECORDER_REPORT_CHARS = 5_000_000;
const APP_ACTIVITY_READ_TIMEOUT_MS = 2_000;

export class AppActivityReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the page did not answer within ${timeoutMs} ms`);
    this.name = "AppActivityReadTimeoutError";
  }
}

// A page that never answers must not hold up stopping or saving a recording.
export function withReadTimeout<T>(
  read: Promise<T>,
  timeoutMs = APP_ACTIVITY_READ_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppActivityReadTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

export type RecorderReportResult =
  | { status: "absent" }
  | { status: "ok"; json: string }
  | { status: "too-large"; chars: number }
  | { status: "failed"; error: string };

// Runs inside the page through chrome.scripting, so it must not close over
// anything from this file.
export function readRecorderReport(
  seconds: number,
  maxChars: number,
): RecorderReportResult {
  const recorder = (
    window as {
      __agentNativeRecorder?: {
        report?: (options: { seconds: number }) => RecorderReport;
      };
    }
  ).__agentNativeRecorder;
  if (typeof recorder?.report !== "function") return { status: "absent" };
  try {
    const json = JSON.stringify(recorder.report({ seconds }));
    return json.length > maxChars
      ? { status: "too-large", chars: json.length }
      : { status: "ok", json };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// The parts of a report Clips keeps, with events still unvalidated.
export type AppActivityRead = {
  readAtMs: number;
  documentId?: string;
  recordingSince?: number;
  coverageFrom?: number;
  watchedAtMs?: number;
  pendingAtMs?: number;
  app: string;
  build: string;
  windowSeconds: number;
  dropped: number;
  events: unknown[];
  watched: Record<string, unknown>;
  pending: unknown[];
};

export type AppActivityReadResult =
  | { status: "absent" }
  | { status: "unsupported" | "denied"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "ok"; read: AppActivityRead };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// The page controls this value, so nothing in it is trusted.
export function parseRecorderReportResult(
  result: unknown,
  readAtMs: number,
): AppActivityReadResult {
  if (!isRecord(result)) {
    return { status: "failed", reason: "the page returned no result" };
  }
  if (result.status === "absent") return { status: "absent" };
  if (result.status === "too-large") {
    return {
      status: "failed",
      reason: `the report is ${String(result.chars)} characters, over the ${MAX_RECORDER_REPORT_CHARS} limit`,
    };
  }
  if (result.status !== "ok" || typeof result.json !== "string") {
    return {
      status: "failed",
      reason:
        typeof result.error === "string"
          ? result.error
          : "the page returned an unknown result",
    };
  }
  if (result.json.length > MAX_RECORDER_REPORT_CHARS) {
    return {
      status: "failed",
      reason: `the report is ${result.json.length} characters, over the ${MAX_RECORDER_REPORT_CHARS} limit`,
    };
  }
  let report: unknown;
  try {
    report = JSON.parse(result.json);
  } catch {
    return { status: "failed", reason: "the report is not JSON" };
  }
  if (
    !isRecord(report) ||
    typeof report.app !== "string" ||
    typeof report.build !== "string" ||
    !isCount(report.windowSeconds) ||
    !isCount(report.dropped) ||
    !Array.isArray(report.events) ||
    !isRecord(report.watched) ||
    !Array.isArray(report.pending)
  ) {
    return {
      status: "failed",
      reason: "the report does not match the recorder contract",
    };
  }
  return {
    status: "ok",
    read: {
      readAtMs:
        typeof report.documentId === "string" &&
        typeof report.at === "string" &&
        Number.isFinite(Date.parse(report.at))
          ? Date.parse(report.at)
          : readAtMs,
      ...(typeof report.documentId === "string" &&
      report.documentId.length <= 200
        ? { documentId: report.documentId }
        : {}),
      ...(isCount(report.recordingSince)
        ? { recordingSince: report.recordingSince }
        : {}),
      ...(isCount(report.coverageFrom)
        ? { coverageFrom: report.coverageFrom }
        : {}),
      ...(typeof report.watchedAt === "string" &&
      Number.isFinite(Date.parse(report.watchedAt))
        ? { watchedAtMs: Date.parse(report.watchedAt) }
        : {}),
      ...(typeof report.pendingAt === "string" &&
      Number.isFinite(Date.parse(report.pendingAt))
        ? { pendingAtMs: Date.parse(report.pendingAt) }
        : {}),
      app: report.app,
      build: report.build,
      windowSeconds: report.windowSeconds,
      dropped: Math.round(report.dropped),
      events: report.events,
      watched: report.watched,
      pending: report.pending,
    },
  };
}

export type DiagnosticsClock = {
  startedAtMs: number;
  pauses: ReadonlyArray<{ startedAtMs: number; endedAtMs: number | null }>;
};

// Negative before the recording started; paused time does not count, the
// same rule console and network entries follow.
export function diagnosticsClockMs(
  timestampMs: number,
  clock: DiagnosticsClock,
): number {
  if (timestampMs < clock.startedAtMs) return timestampMs - clock.startedAtMs;
  let pausedMs = 0;
  for (const pause of clock.pauses) {
    const endedAtMs = Math.min(pause.endedAtMs ?? timestampMs, timestampMs);
    pausedMs += Math.max(0, endedAtMs - pause.startedAtMs);
  }
  return timestampMs - clock.startedAtMs - pausedMs;
}

// Without a start read, the stop read must reach back over the lookback too.
export function stopReadSeconds(
  startedAtMs: number,
  nowMs: number,
  hasStartRead: boolean,
): number {
  const secondsSinceStart = Math.ceil((nowMs - startedAtMs) / 1000) + 1;
  return hasStartRead
    ? secondsSinceStart
    : secondsSinceStart + BROWSER_DIAGNOSTIC_LOOKBACK_MS / 1000;
}

function mergeWindows(windows: AppActivityWindow[]): AppActivityWindow[] {
  const merged: AppActivityWindow[] = [];
  for (const window of windows.sort(
    (a, b) => a.fromElapsedMs - b.fromElapsedMs,
  )) {
    const last = merged[merged.length - 1];
    if (last && window.fromElapsedMs <= last.toElapsedMs) {
      last.toElapsedMs = Math.max(last.toElapsedMs, window.toElapsedMs);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

// The start read supplies the lookback and the stop read the recording, so
// each event comes from exactly one read. Without a start read, the stop read
// supplies whatever lookback it still holds.
export function buildAppActivity(
  reads: { start: AppActivityRead | null; stop: AppActivityRead | null },
  clock: DiagnosticsClock,
): AppActivity | null {
  const latest = reads.stop ?? reads.start;
  if (!latest) return null;
  const lookbackFromMs = clock.startedAtMs - BROWSER_DIAGNOSTIC_LOOKBACK_MS;
  const spans: Array<{ read: AppActivityRead; fromMs: number; toMs: number }> =
    [];
  if (reads.start) {
    spans.push({
      read: reads.start,
      fromMs: lookbackFromMs,
      toMs: clock.startedAtMs,
    });
  }
  if (reads.stop) {
    spans.push({
      read: reads.stop,
      fromMs: reads.start ? clock.startedAtMs : lookbackFromMs,
      toMs: Number.POSITIVE_INFINITY,
    });
  }

  const events: unknown[] = [];
  const coverage: AppActivityWindow[] = [];
  // The recorder's count is cumulative, so only the latest read's is used.
  let dropped = latest.dropped;
  for (const { read, fromMs, toMs } of spans) {
    const coveredFromMs = Math.max(
      fromMs,
      read.readAtMs - read.windowSeconds * 1000,
    );
    const coveredToMs = Math.min(toMs, read.readAtMs);
    if (coveredFromMs < coveredToMs) {
      coverage.push({
        fromElapsedMs: Math.round(diagnosticsClockMs(coveredFromMs, clock)),
        toElapsedMs: Math.round(diagnosticsClockMs(coveredToMs, clock)),
      });
    }
    for (const event of read.events) {
      const at = isRecord(event) ? event.at : undefined;
      if (!isRecord(event) || typeof at !== "number" || !Number.isFinite(at)) {
        // Without a time it cannot be matched across reads; count it once.
        if (read === latest) dropped += 1;
        continue;
      }
      if (at < fromMs || at >= toMs) continue;
      events.push({
        ...event,
        timestampMs: at,
        elapsedMs: diagnosticsClockMs(at, clock),
        durationMs: event.ms,
      });
    }
  }

  return sanitizeAppActivity({
    app: latest.app,
    build: latest.build,
    coverage: mergeWindows(coverage),
    dropped,
    events,
    watched: latest.watched,
    pending: latest.pending,
  });
}

export const APP_ACTIVITY_POLL_MS = 15_000;

type SourceCoverage = { documentId: string; fromMs: number; toMs: number };

function mergeSourceCoverage(windows: SourceCoverage[]): SourceCoverage[] {
  const merged: SourceCoverage[] = [];
  for (const window of windows.sort((a, b) => a.fromMs - b.fromMs)) {
    const last = [...merged]
      .reverse()
      .find((entry) => entry.documentId === window.documentId);
    if (last && window.fromMs <= last.toMs)
      last.toMs = Math.max(last.toMs, window.toMs);
    else merged.push({ ...window });
  }
  return merged;
}

function missingCoverage(
  fromMs: number,
  toMs: number,
  coverage: SourceCoverage[],
) {
  const missing: Array<{ fromMs: number; toMs: number; reason: string }> = [];
  let cursor = fromMs;
  for (const window of [...coverage].sort((a, b) => a.fromMs - b.fromMs)) {
    if (window.fromMs > cursor)
      missing.push({
        fromMs: cursor,
        toMs: window.fromMs,
        reason: "source-not-observed",
      });
    cursor = Math.max(cursor, window.toMs);
  }
  if (cursor < toMs)
    missing.push({ fromMs: cursor, toMs, reason: "source-not-observed" });
  return missing;
}

export class AppActivityCollector {
  private activity: AppActivity;
  private sequenceByDocument = new Map<string, number>();
  private droppedByDocument = new Map<string, number>();
  private legacy = false;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private cancelled = false;
  private stoppedAtMs: number | undefined;

  constructor(
    private readonly options: {
      startedAtMs: number;
      requestedHistorySeconds: number;
      read: (seconds: number) => Promise<AppActivityReadResult>;
      clock: () => DiagnosticsClock;
      now?: () => number;
      onSnapshot?: (activity: AppActivity) => Promise<void>;
      initialActivity?: AppActivity;
    },
  ) {
    if (
      !Number.isInteger(options.requestedHistorySeconds) ||
      options.requestedHistorySeconds < 0 ||
      options.requestedHistorySeconds > 300
    ) {
      throw new RangeError("Requested app history must be 0 to 300 seconds");
    }
    this.activity = {
      app: "unknown",
      build: "unknown",
      coverage: [],
      dropped: 0,
      events: [],
      watched: {},
      pending: [],
      recordingStartedAtMs: options.startedAtMs,
      requestedWindow: {
        fromMs: options.startedAtMs - options.requestedHistorySeconds * 1000,
        toMs: options.startedAtMs,
      },
      sources: [],
      sourceCoverage: [],
      gaps: [],
      collectionStatus: "partial",
      collectionOutcomes: [],
    };
    if (options.initialActivity) {
      this.activity = sanitizeAppActivity(options.initialActivity);
      for (const cursor of this.activity.sourceCursors ?? []) {
        this.sequenceByDocument.set(cursor.documentId, cursor.seq);
        this.droppedByDocument.set(cursor.documentId, cursor.dropped);
      }
      for (const event of this.activity.events) {
        if (event.documentId && event.seq !== undefined)
          this.sequenceByDocument.set(
            event.documentId,
            Math.max(
              this.sequenceByDocument.get(event.documentId) ?? -1,
              event.seq,
            ),
          );
      }
    }
  }

  start(): Promise<void> {
    if (this.closed) throw new Error("Collector is closed");
    this.timer ??= setInterval(() => {
      void this.sample();
    }, APP_ACTIVITY_POLL_MS);
    return this.sample();
  }

  sample(): Promise<void> {
    if (this.closed) return this.queue;
    const run = async () => {
      try {
        await this.collect();
      } catch (error) {
        const atMs = this.stoppedAtMs ?? this.options.now?.() ?? Date.now();
        this.activity.collectionStatus = this.activity.sources?.length
          ? "partial"
          : "failed";
        this.activity.collectionOutcomes = [
          ...(this.activity.collectionOutcomes ?? []).slice(-99),
          {
            atMs,
            status: "failed",
            reason: error instanceof Error ? error.message : "collector-failed",
          },
        ];
        if (
          this.activity.requestedWindow &&
          this.activity.requestedWindow.toMs < atMs
        ) {
          this.activity.gaps = [
            ...(this.activity.gaps ?? []).slice(-199),
            {
              fromMs: this.activity.requestedWindow.toMs,
              toMs: atMs,
              reason: "collector-failed",
            },
          ];
          this.activity.requestedWindow.toMs = atMs;
        }
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async stop(stoppedAtMs?: number): Promise<AppActivity> {
    this.stoppedAtMs = stoppedAtMs;
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.closed) {
      const final = this.sample();
      this.closed = true;
      await final;
    } else await this.queue;
    return structuredClone(this.activity);
  }

  cancel(): void {
    this.cancelled = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.closed = true;
  }

  snapshot(): AppActivity {
    return structuredClone(this.activity);
  }

  private async collect(): Promise<void> {
    const now = this.stoppedAtMs ?? this.options.now?.() ?? Date.now();
    const fromMs =
      this.options.startedAtMs - this.options.requestedHistorySeconds * 1000;
    let result: AppActivityReadResult;
    try {
      result = await this.options.read(Math.ceil((now - fromMs) / 1000) + 1);
    } catch (error) {
      result = {
        status: "failed",
        reason: error instanceof Error ? error.message : "recorder-read-failed",
      };
    }
    const outcomes = [
      ...(this.activity.collectionOutcomes ?? []),
      {
        atMs: now,
        status: result.status,
        ...("reason" in result ? { reason: result.reason } : {}),
      },
    ].slice(-100);
    const clock = this.options.clock();
    let sourceCoverage = [...(this.activity.sourceCoverage ?? [])];
    let sources = [...(this.activity.sources ?? [])];
    let events: unknown[] = [...this.activity.events];
    let watched = this.activity.watched;
    let pending: readonly unknown[] = this.activity.pending;
    let watchedAtMs = this.activity.watchedAtMs;
    let pendingAtMs = this.activity.pendingAtMs;
    let dropped = this.activity.dropped;
    let app = this.activity.app;
    let build = this.activity.build;
    if (result.status === "ok") {
      const read = result.read;
      app = read.app;
      build = read.build;
      const documentId = read.documentId;
      if (!documentId) this.legacy = true;
      const sourceId = documentId ?? "legacy-unidentified";
      const coveredFrom = Math.max(
        fromMs,
        read.coverageFrom ?? read.recordingSince ?? 0,
        read.readAtMs - read.windowSeconds * 1000,
      );
      const coveredTo = Math.min(now, read.readAtMs);
      if (coveredFrom < coveredTo)
        sourceCoverage.push({
          documentId: sourceId,
          fromMs: coveredFrom,
          toMs: coveredTo,
        });
      sourceCoverage = mergeSourceCoverage(sourceCoverage);
      if (!sources.some((source) => source.documentId === sourceId)) {
        if (sources.length === 100) {
          throw new Error("App activity source limit reached");
        }
        sources.push({ documentId: sourceId, app, build });
      }
      const seenSeq = this.sequenceByDocument.get(sourceId) ?? -1;
      let latestSeq = seenSeq;
      const newSequences = new Set<number>();
      for (const event of read.events) {
        if (!isRecord(event) || !isCount(event.at)) {
          dropped += 1;
          continue;
        }
        const at = event.at;
        if (at < fromMs || at > now) continue;
        const seq = event.seq;
        if (
          documentId &&
          event.documentId === documentId &&
          typeof seq === "number" &&
          Number.isSafeInteger(seq) &&
          seq >= 0
        ) {
          if (seq <= seenSeq || newSequences.has(seq)) continue;
          newSequences.add(seq);
          latestSeq = Math.max(latestSeq, seq);
        } else {
          this.legacy = true;
        }
        events.push({
          ...event,
          timestampMs: at,
          elapsedMs: diagnosticsClockMs(at, clock),
          durationMs: event.ms,
          ...(clock.pauses.some(
            (pause) =>
              at >= pause.startedAtMs &&
              (pause.endedAtMs === null || at < pause.endedAtMs),
          )
            ? { duringPause: true }
            : {}),
        });
      }
      this.sequenceByDocument.set(sourceId, latestSeq);
      const priorDropped = this.droppedByDocument.get(sourceId) ?? 0;
      dropped += Math.max(0, read.dropped - priorDropped);
      this.droppedByDocument.set(sourceId, read.dropped);
      watched = read.watched;
      pending = read.pending;
      watchedAtMs = read.watchedAtMs ?? read.readAtMs;
      pendingAtMs = read.pendingAtMs ?? read.readAtMs;
    }
    sourceCoverage = sourceCoverage
      .map((span) => ({
        ...span,
        fromMs: Math.max(fromMs, span.fromMs),
        toMs: Math.min(now, span.toMs),
      }))
      .filter((span) => span.fromMs < span.toMs);
    const gaps = missingCoverage(fromMs, now, sourceCoverage);
    if (this.legacy)
      gaps.push({
        fromMs,
        toMs: now,
        reason: "legacy-source-identity-unavailable",
      });
    const hasRead = sources.length > 0;
    const failed = outcomes.some((outcome) => outcome.status !== "ok");
    const collectionStatus = hasRead
      ? gaps.length > 0 || dropped > 0 || failed
        ? "partial"
        : "ready"
      : result.status === "denied"
        ? "denied"
        : result.status === "failed"
          ? "failed"
          : "unsupported";
    this.activity = sanitizeAppActivity({
      app,
      build,
      recordingStartedAtMs: this.options.startedAtMs,
      requestedWindow: { fromMs, toMs: now },
      coverage: mergeWindows(
        sourceCoverage.map((span) => ({
          fromElapsedMs: diagnosticsClockMs(span.fromMs, clock),
          toElapsedMs: diagnosticsClockMs(span.toMs, clock),
        })),
      ),
      sources,
      sourceCoverage,
      sourceCursors: [...this.sequenceByDocument].map(([documentId, seq]) => ({
        documentId,
        seq,
        dropped: this.droppedByDocument.get(documentId) ?? 0,
      })),
      gaps,
      collectionStatus,
      collectionOutcomes: outcomes,
      events: events.map((event) => {
        if (!isRecord(event) || !isCount(event.timestampMs)) return event;
        const at = event.timestampMs;
        return {
          ...event,
          elapsedMs: diagnosticsClockMs(at, clock),
          duringPause: clock.pauses.some(
            (pause) =>
              at >= pause.startedAtMs &&
              (pause.endedAtMs === null || at < pause.endedAtMs),
          ),
        };
      }),
      watched,
      pending,
      dropped,
      ...(watchedAtMs === undefined ? {} : { watchedAtMs }),
      ...(pendingAtMs === undefined ? {} : { pendingAtMs }),
    });
    if (
      this.activity.dropped > dropped &&
      this.activity.collectionStatus === "ready"
    )
      this.activity.collectionStatus = "partial";
    if (this.options.onSnapshot && !this.cancelled) {
      try {
        await this.options.onSnapshot(this.snapshot());
      } catch (error) {
        this.activity.collectionStatus = "partial";
        this.activity.collectionOutcomes = [
          ...outcomes.slice(-99),
          {
            atMs: now,
            status: "failed",
            reason:
              error instanceof Error
                ? error.message
                : "diagnostic-local-save-failed",
          },
        ];
      }
    }
  }
}
