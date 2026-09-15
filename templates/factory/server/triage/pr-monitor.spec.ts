import { describe, expect, it } from "vitest";

import {
  dedupePullRequestMonitorResults,
  reconcilePullRequestRun,
  type PullRequestMonitorResult,
  type PullRequestObservation,
} from "./pr-monitor.js";

const observation: PullRequestObservation = {
  repo: "builder/agent-native",
  pullRequestNumber: 42,
  headSha: "abc123",
  reviews: [
    {
      author: "reviewer",
      state: "approved",
      observedAt: "2026-07-31T10:00:00.000Z",
    },
  ],
  checks: [
    { name: "ci", state: "passed", observedAt: "2026-07-31T10:00:00.000Z" },
  ],
  observedAt: "2026-07-31T10:00:00.000Z",
};

const baseInput = {
  triageItemId: "item-1",
  runId: "run-1",
  now: "2026-07-31T10:01:00.000Z",
  timeoutMs: 60_000,
};

describe("reconcilePullRequestRun", () => {
  it("reconciles a missed callback from a terminal provider observation", () => {
    const result = reconcilePullRequestRun({
      ...baseInput,
      providerObservation: observation,
    });

    expect(result.state).toBe("completed");
    expect(result.triageItemPatch?.status).toBe("evidence_ready");
  });

  it("keeps an active callback running without a provider observation", () => {
    const result = reconcilePullRequestRun({
      ...baseInput,
      callback: { state: "running", observedAt: baseInput.now },
    });

    expect(result.state).toBe("running");
    expect(result.triageItemPatch).toBeNull();
  });

  it("times out a stale run without a terminal observation", () => {
    const result = reconcilePullRequestRun({
      ...baseInput,
      heartbeatAt: "2026-07-31T09:59:00.000Z",
      callback: { state: "running", observedAt: "2026-07-31T09:59:00.000Z" },
    });

    expect(result.state).toBe("timed_out");
  });

  it("completes only with callback and successful terminal provider observation", () => {
    const result = reconcilePullRequestRun({
      ...baseInput,
      callback: { state: "running", observedAt: "2026-07-31T10:00:30.000Z" },
      providerObservation: observation,
    });

    expect(result.state).toBe("completed");
    expect(result.terminalState).toBe("completed");
    expect(result.triageItemPatch).toMatchObject({
      repository: observation.repo,
      pullRequestNumber: observation.pullRequestNumber,
      headSha: observation.headSha,
      status: "evidence_ready",
    });
  });
});

describe("dedupePullRequestMonitorResults", () => {
  it("dedupes by triage item id", () => {
    const result: PullRequestMonitorResult = {
      triageItemId: "item-1",
      runId: "run-1",
      state: "reconciliation_required",
      terminalState: "reconciliation_required",
      triageItemPatch: null,
      reason: "duplicate",
    };

    expect(
      dedupePullRequestMonitorResults([
        result,
        { ...result, reason: "provider comment id differs" },
        { ...result, runId: "run-2" },
      ]),
    ).toHaveLength(1);
  });
});
