import { beforeEach, describe, expect, it, vi } from "vitest";

const timeoutMocks = vi.hoisted(() => ({
  resolveRunSoftTimeoutMs: vi.fn((overrideMs?: number) => overrideMs ?? 11_000),
  resolveRunNoProgressTimeoutMs: vi.fn(
    (options: { overrideMs?: number; backgroundOverrideMs?: number }) =>
      options.backgroundOverrideMs ?? options.overrideMs ?? 7_000,
  ),
}));

vi.mock("../run-manager.js", () => ({
  resolveRunSoftTimeoutMs: timeoutMocks.resolveRunSoftTimeoutMs,
  resolveRunNoProgressTimeoutMs: timeoutMocks.resolveRunNoProgressTimeoutMs,
}));

const {
  agentHarnessFollowUpRunOptions,
  isAgentHarnessRunPolicy,
  resolveAgentHarnessRunPolicy,
} = await import("./run-policy.js");

describe("agent harness run policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses hosted defaults and the adapter engine when no run options exist", () => {
    expect(resolveAgentHarnessRunPolicy(undefined, "acp")).toEqual({
      softTimeoutMs: 11_000,
      noProgressTimeoutMs: 7_000,
      backgroundFunction: false,
      recoverChunkBoundaries: true,
      engineName: "acp",
    });
    expect(timeoutMocks.resolveRunSoftTimeoutMs).toHaveBeenCalledWith(
      undefined,
      { useHostedDefault: true, backgroundFunction: false },
    );
    expect(timeoutMocks.resolveRunNoProgressTimeoutMs).toHaveBeenCalledWith({
      softTimeoutMs: 11_000,
      backgroundFunction: false,
    });
  });

  it("preserves timeout, recovery, engine, and model overrides", () => {
    expect(
      resolveAgentHarnessRunPolicy(
        {
          softTimeoutMs: 30_000,
          useHostedSoftTimeoutDefault: false,
          noProgressTimeoutMs: 0,
          backgroundNoProgressTimeoutMs: 4_000,
          backgroundFunction: true,
          recoverChunkBoundaries: false,
          engineName: "custom",
          model: "model-a",
          attemptCount: 3,
        },
        "acp",
      ),
    ).toEqual({
      softTimeoutMs: 30_000,
      noProgressTimeoutMs: 4_000,
      backgroundFunction: true,
      recoverChunkBoundaries: false,
      engineName: "custom",
      model: "model-a",
      attemptCount: 3,
    });
    expect(timeoutMocks.resolveRunSoftTimeoutMs).toHaveBeenCalledWith(30_000, {
      useHostedDefault: false,
      backgroundFunction: true,
    });
    expect(timeoutMocks.resolveRunNoProgressTimeoutMs).toHaveBeenCalledWith({
      softTimeoutMs: 30_000,
      backgroundFunction: true,
      overrideMs: 0,
      backgroundOverrideMs: 4_000,
    });
  });

  it("accepts complete policies and rejects invalid persisted fields", () => {
    const policy = {
      softTimeoutMs: 30_000,
      noProgressTimeoutMs: 5_000,
      backgroundFunction: false,
      recoverChunkBoundaries: true,
      engineName: "acp",
      model: "model-a",
      attemptCount: 2,
    };
    expect(isAgentHarnessRunPolicy(policy)).toBe(true);
    expect(isAgentHarnessRunPolicy(null)).toBe(false);
    expect(isAgentHarnessRunPolicy([])).toBe(false);
    for (const invalid of [
      { ...policy, softTimeoutMs: Number.POSITIVE_INFINITY },
      { ...policy, noProgressTimeoutMs: -1 },
      { ...policy, backgroundFunction: "false" },
      { ...policy, recoverChunkBoundaries: undefined },
      { ...policy, engineName: 1 },
      { ...policy, model: 1 },
      { ...policy, attemptCount: Number.NaN },
    ]) {
      expect(isAgentHarnessRunPolicy(invalid)).toBe(false);
    }
  });

  it("builds safe defaults for old sessions and copies persisted policy", () => {
    expect(agentHarnessFollowUpRunOptions(undefined)).toEqual({
      executionLease: true,
      recoverChunkBoundaries: true,
      softTimeoutMs: 11_000,
    });
    expect(
      agentHarnessFollowUpRunOptions({
        softTimeoutMs: 30_000,
        noProgressTimeoutMs: 5_000,
        backgroundFunction: true,
        recoverChunkBoundaries: false,
        engineName: "custom",
        model: "model-a",
        attemptCount: 3,
      }),
    ).toEqual({
      executionLease: true,
      softTimeoutMs: 30_000,
      noProgressTimeoutMs: 5_000,
      backgroundFunction: true,
      recoverChunkBoundaries: false,
      engineName: "custom",
      model: "model-a",
      attemptCount: 3,
    });
  });
});
