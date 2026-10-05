import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRunOutcomeTelemetryStats,
  resetRunOutcomeTelemetryForTests,
  trackRunOutcome,
} from "./run-outcome-telemetry.js";
import type { RunOutcomeReport } from "./run-outcome.js";

vi.mock("../analytics.js", () => ({ trackEvent: vi.fn() }));

function report(overrides: Partial<RunOutcomeReport> = {}): RunOutcomeReport {
  return {
    runId: "run-1",
    threadId: "thr-1",
    outcome: "interrupted",
    code: "stale_run",
    retryable: true,
    terminalSource: "authority",
    verifiedAfterPipeClosed: true,
    resumeAttempts: 0,
    quietReads: 2,
    drainAttempts: 1,
    ...overrides,
  };
}

describe("run outcome telemetry", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    resetRunOutcomeTelemetryForTests();
  });

  it("reports a run that did not finish well with the detail that explains it", () => {
    trackRunOutcome(report(), send, () => 0.99);

    expect(send).toHaveBeenCalledWith("agent_run_outcome", {
      outcome: "interrupted",
      code: "stale_run",
      retryable: true,
      terminal_source: "authority",
      verified_after_pipe_closed: true,
      resume_attempts: 0,
      quiet_reads: 2,
      drain_attempts: 1,
      run_id: "run-1",
      thread_id: "thr-1",
      sample_rate: 1,
      sample_weight: 1,
    });
  });

  it("samples runs that ended as expected and weights the ones it keeps", () => {
    trackRunOutcome(
      report({ outcome: "succeeded", code: undefined }),
      send,
      () => 0.5,
    );
    expect(send).not.toHaveBeenCalled();
    expect(getRunOutcomeTelemetryStats().sampledOut).toBe(1);

    trackRunOutcome(
      report({ outcome: "stopped", code: undefined }),
      send,
      () => 0.05,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({
      outcome: "stopped",
      sample_rate: 0.1,
      sample_weight: 10,
    });
    expect(send.mock.calls[0]![1]).not.toHaveProperty("code");
  });

  it("caps the unexpected outcomes one page reports and counts what it dropped", () => {
    for (let i = 0; i < 45; i += 1) {
      trackRunOutcome(report({ runId: `run-${i}` }), send, () => 0.99);
    }

    expect(send).toHaveBeenCalledTimes(30);
    expect(getRunOutcomeTelemetryStats()).toMatchObject({
      unexpectedSent: 30,
      unexpectedDropped: 15,
    });
    // An expected outcome is sampled on its own budget, not the cap's.
    trackRunOutcome(report({ outcome: "succeeded" }), send, () => 0);
    expect(send).toHaveBeenCalledTimes(31);
  });

  it("never lets a failing sender throw into the run", () => {
    send.mockImplementation(() => {
      throw new Error("tracker down");
    });
    expect(() => trackRunOutcome(report(), send)).not.toThrow();
  });
});
