import { afterEach, describe, expect, it, vi } from "vitest";

import { readPreviousRunBaseline } from "./agent-run-status";
import { resolvePreviousRunBaseline } from "./pending-generation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPreviousRunBaseline", () => {
  it("lets a fresh idle status override stale stored run ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ active: false, status: "idle" }),
      }),
    );

    const baseline = await readPreviousRunBaseline("thread-1");

    expect(
      resolvePreviousRunBaseline(baseline, {
        currentRunId: "stale-run",
        previousRunId: "older-run",
        previousRunBaselineVerified: true,
      }),
    ).toEqual({ runId: null, verified: true });
  });

  it("does not verify an unreadable thread as an empty run baseline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ active: false, status: "unknown" }),
      }),
    );

    const baseline = await readPreviousRunBaseline("thread-1");

    expect(baseline).toEqual({ runId: null, verified: false });
  });

  it("uses the latest run id instead of a stale stored id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          active: false,
          status: "completed",
          runId: "latest-run",
        }),
      }),
    );

    const baseline = await readPreviousRunBaseline("thread-1");

    expect(
      resolvePreviousRunBaseline(baseline, {
        currentRunId: "stale-run",
        previousRunBaselineVerified: true,
      }),
    ).toEqual({ runId: "latest-run", verified: true });
  });

  it("fails closed when the latest status cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const baseline = await readPreviousRunBaseline("thread-1");

    expect(
      resolvePreviousRunBaseline(baseline, {
        currentRunId: "stale-run",
        previousRunBaselineVerified: true,
      }),
    ).toEqual({ runId: null, verified: false });
  });
});
