import { describe, expect, it } from "vitest";

import {
  diagnosticCapturePayload,
  validatedDiagnosticContext,
} from "./diagnostic-capture";

const input = {
  recordingId: "recording-1",
  captureId: "capture-1",
  captureAuthorization: "example-capture-authorization",
  startedAtMs: 1_000_000,
  stoppedAtMs: 1_100_000,
  historySeconds: 300,
};

describe("private capture envelope", () => {
  it("retries the exact canonical envelope and rejects mismatched capture identity", () => {
    const frozen = diagnosticCapturePayload({
      ...input,
      failureCode: "source_lost",
    });
    const serialized = JSON.stringify(frozen);
    expect(JSON.stringify(validatedDiagnosticContext(frozen, input))).toBe(
      serialized,
    );
    for (const change of [
      { recordingId: "another-recording" },
      { captureId: "another-capture" },
      { captureAuthorization: "another-receipt" },
      { consent: false },
      { requestedWindow: { from: "invalid", to: "invalid" } },
    ]) {
      expect(() =>
        validatedDiagnosticContext({ ...frozen, ...change }, input),
      ).toThrow();
    }
  });

  it("labels desktop or browser footage without a page bridge unavailable for app activity", () => {
    const result = diagnosticCapturePayload(input);
    expect(result.captured).toBe("unsupported");
    expect(result.coverage).toEqual([]);
    expect(result.gaps).toEqual([
      {
        from: new Date(700_000).toISOString(),
        to: new Date(1_100_000).toISOString(),
        reason: "no_page_bridge",
      },
    ]);
    expect(result).not.toHaveProperty("activity");
    expect(result).not.toHaveProperty("screenshot");
  });

  it("retains absolute requested history, partial source coverage and the collection failure", () => {
    const result = diagnosticCapturePayload({
      ...input,
      activity: {
        app: "Design",
        build: "example",
        recordingStartedAtMs: input.startedAtMs,
        coverage: [{ fromElapsedMs: -120_000, toElapsedMs: 100_000 }],
        dropped: 2,
        events: [],
        watched: {},
        pending: [],
        collectionStatus: "partial",
        sourceCoverage: [
          { documentId: "document-a", fromMs: 880_000, toMs: 1_100_000.6 },
        ],
        gaps: [{ fromMs: 700_000, toMs: 880_000, reason: "source_retention" }],
      },
    });
    expect(result.recordingStartedAt).toBe(
      new Date(input.startedAtMs).toISOString(),
    );
    expect(result.requestedWindow.from).toBe(new Date(700_000).toISOString());
    expect(result.captured).toBe("partial");
    expect(result.coverage).toEqual([
      {
        documentId: "document-a",
        from: new Date(880_000).toISOString(),
        to: new Date(1_100_000).toISOString(),
      },
    ]);
    expect(result.activity).toMatchObject({
      sourceCoverage: [
        {
          documentId: "document-a",
          fromMs: 880_000,
          toMs: input.stoppedAtMs,
        },
      ],
      requestedWindow: { toMs: input.stoppedAtMs },
    });
    expect(result.droppedEvents).toBe(2);
    const failed = diagnosticCapturePayload({
      ...input,
      failureCode: "extension_timeout",
    });
    expect(failed.captured).toBe("failed");
    expect(failed.failureCode).toBe("extension_timeout");
  });
});
