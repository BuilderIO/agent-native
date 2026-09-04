import { describe, expect, it } from "vitest";

import {
  resolveTranscriptPresentation,
  STALE_PENDING_TRANSCRIPT_MS,
  STALE_PENDING_TRANSCRIPT_REASON,
} from "./transcript-status";

describe("resolveTranscriptPresentation", () => {
  const now = Date.parse("2026-07-10T16:30:00.000Z");

  it("keeps a recent pending transcript pending", () => {
    expect(
      resolveTranscriptPresentation(
        {
          status: "pending",
          updatedAt: new Date(
            now - STALE_PENDING_TRANSCRIPT_MS + 1,
          ).toISOString(),
        },
        now,
      ),
    ).toEqual({
      status: "pending",
      failureReason: null,
      stalePending: false,
    });
  });

  it("surfaces a stale pending transcript as retryable failure", () => {
    expect(
      resolveTranscriptPresentation(
        {
          status: "pending",
          updatedAt: new Date(now - STALE_PENDING_TRANSCRIPT_MS).toISOString(),
        },
        now,
      ),
    ).toEqual({
      status: "failed",
      failureReason: STALE_PENDING_TRANSCRIPT_REASON,
      stalePending: true,
    });
  });

  it("does not change terminal transcript states", () => {
    expect(
      resolveTranscriptPresentation(
        {
          status: "ready",
          updatedAt: "2026-01-01T00:00:00.000Z",
          failureReason: null,
        },
        now,
      ),
    ).toEqual({
      status: "ready",
      failureReason: null,
      stalePending: false,
    });
  });
});
