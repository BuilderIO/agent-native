import type { AppActivity } from "@shared/app-activity";

export type DiagnosticCaptureIdentity = {
  ownerEmail: string;
  orgId: string;
};

export type DiagnosticOutboxEntry = {
  captureId: string;
  captureAuthorization: string;
  recordingId: string;
  origin: string;
  identity: DiagnosticCaptureIdentity;
  activity: AppActivity;
  pauses: Array<{ from: string; to: string }>;
  browserDiagnostics?: Record<string, unknown>;
  finalized: boolean;
  saved: "pending" | "failed";
  failureCode?: string;
  captureFailureCode?: string;
  recorderTabId?: number;
  sourceTabId?: number;
};

export const DIAGNOSTIC_OUTBOX_KEY = "clipsPrivateDiagnosticOutbox";
export const MAX_DIAGNOSTIC_OUTBOX_BYTES = 8_000_000;
export const MAX_DIAGNOSTIC_OUTBOX_ENTRIES = 8;
export const DIAGNOSTIC_OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export function pruneExpiredDiagnosticOutbox(
  entries: DiagnosticOutboxEntry[],
  nowMs = Date.now(),
): DiagnosticOutboxEntry[] {
  return entries.filter((entry) => {
    const startedAt = entry.activity.recordingStartedAtMs;
    return (
      typeof startedAt !== "number" ||
      !Number.isFinite(startedAt) ||
      nowMs - startedAt <= DIAGNOSTIC_OUTBOX_MAX_AGE_MS
    );
  });
}

export function sameDiagnosticIdentity(
  a: DiagnosticCaptureIdentity,
  b: DiagnosticCaptureIdentity,
): boolean {
  return (
    a.ownerEmail.toLowerCase() === b.ownerEmail.toLowerCase() &&
    a.orgId === b.orgId
  );
}

export function putDiagnosticOutboxEntry(
  entries: DiagnosticOutboxEntry[],
  entry: DiagnosticOutboxEntry,
): DiagnosticOutboxEntry[] {
  const previous = entries.find((item) => item.captureId === entry.captureId);
  if (
    previous?.finalized &&
    (!entry.finalized ||
      JSON.stringify(diagnosticSavePayload(previous)) !==
        JSON.stringify(diagnosticSavePayload(entry)))
  )
    throw new Error("diagnostic-capture-already-finalized");
  const next = [
    ...entries.filter((item) => item.captureId !== entry.captureId),
    entry,
  ];
  if (
    next.length > MAX_DIAGNOSTIC_OUTBOX_ENTRIES ||
    new TextEncoder().encode(JSON.stringify(next)).byteLength >
      MAX_DIAGNOSTIC_OUTBOX_BYTES
  ) {
    throw new Error("diagnostic-outbox-quota-exceeded");
  }
  return next;
}

export function diagnosticSavePayload(
  entry: DiagnosticOutboxEntry,
): Record<string, unknown> {
  const activity = entry.activity;
  if (
    !entry.finalized ||
    activity.recordingStartedAtMs === undefined ||
    !activity.requestedWindow
  ) {
    throw new Error("diagnostic-capture-not-finalized");
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    recordingId: entry.recordingId,
    captureId: entry.captureId,
    captureAuthorization: entry.captureAuthorization,
    contextVersion: 1,
    consent: true,
    recordingStartedAt: iso(activity.recordingStartedAtMs),
    requestedWindow: {
      from: iso(activity.requestedWindow.fromMs),
      to: iso(activity.requestedWindow.toMs),
    },
    captured:
      activity.collectionStatus === "denied"
        ? "failed"
        : (activity.collectionStatus ?? "failed"),
    coverage: (activity.sourceCoverage ?? []).map((span) => ({
      documentId: span.documentId,
      from: iso(span.fromMs),
      to: iso(span.toMs),
    })),
    gaps: (activity.gaps ?? []).map((gap) => ({
      from: iso(gap.fromMs),
      to: iso(gap.toMs),
      reason: gap.reason,
    })),
    pauses: entry.pauses,
    droppedEvents: activity.dropped,
    ...(activity.collectionStatus === "denied" || entry.captureFailureCode
      ? {
          failureCode:
            activity.collectionStatus === "denied"
              ? "denied"
              : entry.captureFailureCode,
        }
      : {}),
    activity,
    ...(entry.browserDiagnostics
      ? { browserDiagnostics: entry.browserDiagnostics }
      : {}),
  };
}

export function finalizeDiagnosticJournal(
  entry: DiagnosticOutboxEntry,
  options: {
    stoppedAtMs: number;
    activity?: AppActivity;
    pauses?: DiagnosticOutboxEntry["pauses"];
    browserDiagnostics?: Record<string, unknown>;
    failureCode?: string;
  },
): DiagnosticOutboxEntry {
  if (entry.finalized) return structuredClone(entry);
  const activity = structuredClone(options.activity ?? entry.activity);
  const window = activity.requestedWindow;
  if (
    !window ||
    activity.recordingStartedAtMs === undefined ||
    !Number.isFinite(options.stoppedAtMs) ||
    options.stoppedAtMs < activity.recordingStartedAtMs
  )
    throw new Error("diagnostic-journal-clock-invalid");
  if (window.toMs < options.stoppedAtMs) {
    activity.gaps = [
      ...(activity.gaps ?? []).slice(-199),
      {
        fromMs: window.toMs,
        toMs: options.stoppedAtMs,
        reason: options.failureCode ?? "source-not-observed",
      },
    ];
    window.toMs = options.stoppedAtMs;
    activity.collectionStatus = "partial";
  }
  if (options.failureCode) {
    activity.collectionStatus = activity.sources?.length ? "partial" : "failed";
    activity.collectionOutcomes = [
      ...(activity.collectionOutcomes ?? []).slice(-99),
      {
        atMs: options.stoppedAtMs,
        status: "failed",
        reason: options.failureCode,
      },
    ];
  }
  return {
    ...entry,
    activity,
    finalized: true,
    saved: "pending",
    ...(options.pauses ? { pauses: options.pauses } : {}),
    ...(options.browserDiagnostics
      ? { browserDiagnostics: options.browserDiagnostics }
      : {}),
    ...(options.failureCode ? { captureFailureCode: options.failureCode } : {}),
  };
}
