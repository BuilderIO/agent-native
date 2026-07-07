import { describe, expect, it } from "vitest";

import {
  MEDIA_WORKER_SIGNATURE_HEADER,
  MEDIA_WORKER_TIMESTAMP_HEADER,
  parseMediaWorkerCallback,
  signMediaWorkerPayload,
  verifyMediaWorkerSignature,
} from "./media-worker-contract";

describe("media-worker-contract", () => {
  it("signs and verifies raw media worker payloads", () => {
    const rawBody = JSON.stringify({ jobId: "rec-1:compress" });
    const headers = signMediaWorkerPayload({
      rawBody,
      secret: "test-secret",
      timestamp: "2000",
    });

    expect(
      verifyMediaWorkerSignature({
        rawBody,
        secret: "test-secret",
        timestamp: headers[MEDIA_WORKER_TIMESTAMP_HEADER],
        signature: headers[MEDIA_WORKER_SIGNATURE_HEADER],
        nowMs: 2_000_000,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects bad signatures and stale timestamps", () => {
    const rawBody = "{}";
    const headers = signMediaWorkerPayload({
      rawBody,
      secret: "test-secret",
      timestamp: "2000",
    });

    expect(
      verifyMediaWorkerSignature({
        rawBody,
        secret: "wrong-secret",
        timestamp: headers[MEDIA_WORKER_TIMESTAMP_HEADER],
        signature: headers[MEDIA_WORKER_SIGNATURE_HEADER],
        nowMs: 2_000_000,
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });
    expect(
      verifyMediaWorkerSignature({
        rawBody,
        secret: "test-secret",
        timestamp: headers[MEDIA_WORKER_TIMESTAMP_HEADER],
        signature: headers[MEDIA_WORKER_SIGNATURE_HEADER],
        nowMs: 2_400_001,
      }),
    ).toEqual({ ok: false, reason: "stale-timestamp" });
    expect(
      verifyMediaWorkerSignature({
        rawBody,
        secret: "test-secret",
        timestamp: headers[MEDIA_WORKER_TIMESTAMP_HEADER],
        signature: headers[MEDIA_WORKER_SIGNATURE_HEADER],
        nowMs: 1_599_999,
      }),
    ).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("parses only valid callbacks", () => {
    expect(
      parseMediaWorkerCallback({
        jobId: "rec-1:compress",
        status: "done",
        outputUrl: "https://cdn.builder.io/o/assets%2Forg%2Fasset%2Fcompressed",
        durationMs: 123.4,
      }),
    ).toEqual({
      jobId: "rec-1:compress",
      status: "done",
      outputUrl: "https://cdn.builder.io/o/assets%2Forg%2Fasset%2Fcompressed",
      durationMs: 123,
    });
    expect(
      parseMediaWorkerCallback({ jobId: "rec-1", status: "wat" }),
    ).toBeNull();
  });
});
