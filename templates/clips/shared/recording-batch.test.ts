import { describe, expect, it, vi } from "vitest";

import { MAX_RECORDING_BATCH, sendRecordingBatches } from "./recording-batch";

describe("sendRecordingBatches", () => {
  it("sends a selection as one call per hundred recordings", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `rec-${i}`);
    const send = vi.fn(async (chunk: string[]) => ({
      results: chunk.map((id) => ({ id, status: "changed" as const })),
    }));

    const outcome = await sendRecordingBatches(ids, send);

    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      MAX_RECORDING_BATCH,
      50,
    ]);
    expect(outcome).toEqual({
      succeededIds: ids,
      failedCount: 0,
      firstError: null,
    });
  });

  it("counts skipped recordings and every recording in a refused call as failed", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `rec-${i}`);
    const send = vi.fn(async (chunk: string[]) => {
      if (chunk.length === 1) throw new Error("Nothing was changed: rec-100");
      return {
        results: chunk.map((id, i) =>
          i === 0
            ? { id, status: "skipped" as const, reason: "Recording not found" }
            : { id, status: "unchanged" as const },
        ),
      };
    });

    const outcome = await sendRecordingBatches(ids, send);

    expect(outcome.succeededIds).toHaveLength(99);
    expect(outcome.failedCount).toBe(2);
    expect(outcome.firstError).toBe("Recording not found");
  });

  it("counts a recording the response leaves out as failed", async () => {
    const send = vi.fn(async () => ({
      results: [{ id: "rec-1", status: "changed" as const }],
    }));

    const outcome = await sendRecordingBatches(["rec-1", "rec-2"], send);

    expect(outcome).toEqual({
      succeededIds: ["rec-1"],
      failedCount: 1,
      firstError: "The server didn't report on every recording.",
    });
  });
});
