import type { AppActivity } from "@shared/app-activity";
import type { BrowserDiagnosticsData } from "@shared/browser-diagnostics";
import {
  diagnosticContextInputSchema,
  type DiagnosticContextInput,
} from "@shared/diagnostic-context";

export function diagnosticCapturePayload(input: {
  recordingId: string;
  captureId: string;
  captureAuthorization: string;
  startedAtMs: number;
  stoppedAtMs: number;
  historySeconds: number;
  activity?: AppActivity;
  browserDiagnostics?: BrowserDiagnosticsData | null;
  failureCode?: string;
  pauses?: Array<{ from: string; to: string }>;
}): DiagnosticContextInput {
  const iso = (time: number) => new Date(time).toISOString();
  const activity = input.activity;
  const requestedFromMs = input.startedAtMs - input.historySeconds * 1000;
  const clipSpans = <T extends { fromMs: number; toMs: number }>(
    spans: T[] | undefined,
  ): T[] | undefined =>
    spans
      ?.map((span) => ({
        ...span,
        fromMs: Math.max(requestedFromMs, span.fromMs),
        toMs: Math.min(input.stoppedAtMs, span.toMs),
      }))
      .filter((span) => span.fromMs < span.toMs);
  const boundedActivity = activity
    ? {
        ...activity,
        requestedWindow: {
          fromMs: requestedFromMs,
          toMs: input.stoppedAtMs,
        },
        sourceCoverage: clipSpans(activity.sourceCoverage),
        gaps: clipSpans(activity.gaps),
      }
    : undefined;
  const status = boundedActivity?.collectionStatus;
  const captured =
    status === "denied"
      ? "failed"
      : (status ?? (input.failureCode ? "failed" : "unsupported"));
  return {
    recordingId: input.recordingId,
    captureId: input.captureId,
    captureAuthorization: input.captureAuthorization,
    contextVersion: 1,
    consent: true,
    recordingStartedAt: iso(input.startedAtMs),
    requestedWindow: {
      from: iso(requestedFromMs),
      to: iso(input.stoppedAtMs),
    },
    captured,
    coverage: (boundedActivity?.sourceCoverage ?? []).map((span) => ({
      documentId: span.documentId,
      from: iso(span.fromMs),
      to: iso(span.toMs),
    })),
    gaps: boundedActivity?.gaps?.map((gap) => ({
      from: iso(gap.fromMs),
      to: iso(gap.toMs),
      reason: gap.reason,
    })) ?? [
      {
        from: iso(requestedFromMs),
        to: iso(input.stoppedAtMs),
        reason: input.failureCode ?? "no_page_bridge",
      },
    ],
    pauses: input.pauses ?? [],
    droppedEvents: boundedActivity?.dropped ?? 0,
    ...(input.failureCode || status === "denied"
      ? { failureCode: input.failureCode ?? "denied" }
      : {}),
    ...(boundedActivity ? { activity: boundedActivity } : {}),
    ...(input.browserDiagnostics
      ? { browserDiagnostics: { ...input.browserDiagnostics } }
      : {}),
  };
}

export function validatedDiagnosticContext(
  value: unknown,
  expected: Pick<
    DiagnosticContextInput,
    "recordingId" | "captureId" | "captureAuthorization"
  >,
): DiagnosticContextInput {
  const result = diagnosticContextInputSchema.safeParse(value);
  if (
    !result.success ||
    result.data.recordingId !== expected.recordingId ||
    result.data.captureId !== expected.captureId ||
    result.data.captureAuthorization !== expected.captureAuthorization
  ) {
    throw new Error(
      "The extension returned a mismatched private context capture.",
    );
  }
  return value as DiagnosticContextInput;
}
