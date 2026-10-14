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
      readAtMs,
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
  let dropped = 0;
  for (const { read, fromMs, toMs } of spans) {
    dropped += read.dropped;
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
        dropped += 1;
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
