import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentLeaseRenewalDiagnostics,
  LeaseRenewalDiagnostics,
  leaseRenewalFailureCode,
} from "./lease-renewal-diagnostics.js";

function collector(runId = "run-unit") {
  return new LeaseRenewalDiagnostics(runId, {
    intervalMs: 1_500,
    attemptDeadlineMs: 5_000,
    maxPending: 2,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("lease renewal diagnostics", () => {
  it("keeps a deadline separate from the eventual result of an overlapping attempt", () => {
    vi.useFakeTimers({ now: 1_000 });
    const diagnostics = collector();
    const first = diagnostics.start(0);
    vi.setSystemTime(6_000);
    first.deadlineReached();
    vi.setSystemTime(7_000);
    const second = diagnostics.start(1);
    second.settle("renewed");
    const pending = diagnostics.snapshot();
    expect(pending.attempts).toEqual([
      {
        attempt: 1,
        startedAtMs: 1_000,
        pendingAtStart: 0,
        deadlineReachedAtMs: 6_000,
        outcome: "pending",
      },
      {
        attempt: 2,
        startedAtMs: 7_000,
        pendingAtStart: 1,
        settledAtMs: 7_000,
        outcome: "renewed",
      },
    ]);
    vi.setSystemTime(8_000);
    first.settle(
      "error",
      Object.assign(new Error("private detail"), { code: "57014" }),
    );
    expect(diagnostics.snapshot().attempts[0]).toMatchObject({
      outcome: "error",
      failureCode: "57014",
      settledAtMs: 8_000,
      deadlineReachedAtMs: 6_000,
    });
    expect(pending.attempts[0]?.outcome).toBe("pending");
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain(
      "private detail",
    );
  });

  it("retains bounded recent attempts with an explicit omitted count", () => {
    const diagnostics = collector();
    for (let attempt = 0; attempt < 1_026; attempt++) {
      diagnostics.start(0).settle("renewed");
    }
    const snapshot = diagnostics.snapshot();
    expect(snapshot.attemptCount).toBe(1_026);
    expect(snapshot.droppedAttempts).toBe(2);
    expect(snapshot.attempts).toHaveLength(1_024);
    expect(snapshot.attempts[0]?.attempt).toBe(3);
    expect(snapshot.attempts[snapshot.attempts.length - 1]?.attempt).toBe(
      1_026,
    );
  });

  it("isolates concurrent run contexts and restores the caller's context", async () => {
    const first = collector("first");
    const second = collector("second");
    await Promise.all([
      first.run(async () => {
        await Promise.resolve();
        expect(currentLeaseRenewalDiagnostics("first")).toBe(first);
        expect(currentLeaseRenewalDiagnostics("second")).toBeUndefined();
      }),
      second.run(async () => {
        await Promise.resolve();
        expect(currentLeaseRenewalDiagnostics("second")).toBe(second);
        expect(currentLeaseRenewalDiagnostics("first")).toBeUndefined();
      }),
    ]);
    expect(currentLeaseRenewalDiagnostics("first")).toBeUndefined();
  });

  it("does not invoke error accessors or retain arbitrary error labels", () => {
    const read = vi.fn(() => "57014");
    const error = Object.defineProperty({}, "code", { get: read });
    expect(leaseRenewalFailureCode(error)).toBe("unclassified");
    expect(read).not.toHaveBeenCalled();
    expect(leaseRenewalFailureCode({ code: "private-code" })).toBe(
      "unclassified",
    );
    const inspect = vi.fn();
    expect(
      leaseRenewalFailureCode(
        new Proxy({}, { getOwnPropertyDescriptor: inspect }),
      ),
    ).toBe("unclassified");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("does not overwrite a settled outcome", () => {
    const diagnostics = collector();
    const attempt = diagnostics.start(0);
    attempt.settle("fence_lost");
    attempt.settle("renewed");
    attempt.deadlineReached();
    expect(diagnostics.snapshot().attempts[0]).toMatchObject({
      outcome: "fence_lost",
    });
    expect(diagnostics.snapshot().attempts[0]).not.toHaveProperty(
      "deadlineReachedAtMs",
    );
  });
});
