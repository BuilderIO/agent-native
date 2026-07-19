import { describe, expect, it, vi } from "vitest";

import type { SubscriptionStatus } from "../../shared/subscription-status.js";
import {
  MultiFrontierHelperRuntime,
  type MultiFrontierReadOnlyHelperLaunch,
  type MultiFrontierReadOnlyHelperResult,
  type MultiFrontierHelperLaunchRecord,
  type MultiFrontierProvenHelperCapability,
} from "./multi-frontier-helper-runtime.js";
import type { MultiFrontierHelperPolicy } from "./multi-frontier-orchestrator.js";

const POLICY: MultiFrontierHelperPolicy = {
  delegationAvailable: true,
  requestedModel: "gpt-5.6-terra",
  effectiveModel: "gpt-5.6-terra",
  readOnlyDefault: true,
  maxDepth: 2,
  maxTasks: 2,
  maxTurns: 3,
};

const CAPABILITY: MultiFrontierProvenHelperCapability = {
  schemaVersion: 1,
  providerId: "codex",
  runtime: "codex-cli",
  runtimeVersion: "0.144.3",
  requestedModel: "gpt-5.6-terra",
  effectiveModel: "gpt-5.6-terra",
  modelSelection: "verified",
  workspacePermission: "read_only_enforced",
  verifiedAt: "2026-07-19T18:00:00.000Z",
};

function liveStatus(usedPercent = 35): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId: "codex",
    connectionState: "connected",
    authMethod: "ChatGPT",
    telemetry: {
      state: "live",
      source: "codex-app-server",
      updatedAt: "2026-07-19T18:01:00.000Z",
      capabilities: {
        account: false,
        plan: false,
        rateLimits: true,
        modelTierRateLimits: false,
        contextWindow: false,
        credits: false,
        liveUpdates: true,
      },
      meters: [
        {
          id: "five-hour",
          kind: "five-hour",
          state: "available",
          usedPercent,
        },
      ],
    },
  };
}

function createRuntime(
  overrides: {
    policy?: MultiFrontierHelperPolicy;
    capability?: MultiFrontierProvenHelperCapability | null;
    status?: SubscriptionStatus | null;
    spawn?: (
      input: MultiFrontierReadOnlyHelperLaunch,
    ) => Promise<MultiFrontierReadOnlyHelperResult>;
    records?: MultiFrontierHelperLaunchRecord[];
    recordLaunch?: (
      record: MultiFrontierHelperLaunchRecord,
    ) => Promise<void> | void;
  } = {},
) {
  const records = overrides.records ?? [];
  const spawn =
    overrides.spawn ??
    vi
      .fn<
        (
          input: MultiFrontierReadOnlyHelperLaunch,
        ) => Promise<MultiFrontierReadOnlyHelperResult>
      >()
      .mockResolvedValue({
        effectiveModel: "gpt-5.6-terra",
        turns: 2,
        summary: "The bounded review completed.",
      });
  const recordLaunch =
    overrides.recordLaunch ??
    vi.fn<(record: MultiFrontierHelperLaunchRecord) => Promise<void>>(
      async (record) => {
        records.push(record);
      },
    );
  const runtime = new MultiFrontierHelperRuntime({
    collaborationId: "mf-1",
    policy: overrides.policy ?? POLICY,
    capability:
      overrides.capability === undefined ? CAPABILITY : overrides.capability,
    stopOptionalAtPercent: 80,
    readSubscriptionStatus: async () => overrides.status ?? liveStatus(),
    spawnReadOnly: spawn,
    recordLaunch,
    now: () => "2026-07-19T18:02:00.000Z",
  });
  return { runtime, spawn, records, recordLaunch };
}

const INPUT = {
  taskId: "helper-1",
  kind: "research" as const,
  depth: 1,
  prompt: "Find existing tests for the local runner.",
  artifacts: [
    { id: "proposal-1", summary: "Inspect the current runner tests." },
  ],
};

describe("MultiFrontierHelperRuntime", () => {
  it("spawns only a proven read-only helper and records requested/effective models", async () => {
    const { runtime, spawn, records } = createRuntime();

    await expect(runtime.launch(INPUT)).resolves.toEqual({
      effectiveModel: "gpt-5.6-terra",
      turns: 2,
      summary: "The bounded review completed.",
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        runtime: "codex-cli",
        requestedModel: "gpt-5.6-terra",
        effectiveModel: "gpt-5.6-terra",
        workspacePermission: "read_only",
        maxTurns: 3,
      }),
    );
    expect(records).toEqual([
      expect.objectContaining({
        status: "started",
        requestedModel: "gpt-5.6-terra",
        effectiveModel: "gpt-5.6-terra",
        quotaUsedPercent: 35,
      }),
      expect.objectContaining({
        status: "completed",
        turns: 2,
        summary: "The bounded review completed.",
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain(INPUT.prompt);
    expect(JSON.stringify(records)).not.toContain("proposal-1");
  });

  it("fails closed without a proven capability or fresh provider quota", async () => {
    const unavailable = createRuntime({ capability: null });
    await expect(unavailable.runtime.launch(INPUT)).rejects.toThrow(
      "unavailable",
    );
    expect(unavailable.spawn).not.toHaveBeenCalled();

    const stale = createRuntime({
      status: {
        ...liveStatus(),
        telemetry: { ...liveStatus().telemetry, state: "stale" },
      },
    });
    await expect(stale.runtime.launch(INPUT)).rejects.toThrow(
      "fresh provider-reported quota",
    );
    expect(stale.spawn).not.toHaveBeenCalled();
  });

  it("stops optional work at the current provider-reported threshold", async () => {
    const { runtime, spawn } = createRuntime({ status: liveStatus(80) });

    await expect(runtime.launch(INPUT)).rejects.toThrow("near its limit");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects model mismatches and records the failed launch without persisting secrets", async () => {
    const { runtime, records } = createRuntime({
      spawn: vi.fn().mockResolvedValue({
        effectiveModel: "frontier-expensive",
        turns: 1,
        summary: "sk-this-is-a-fake-test-secret",
      }),
    });

    await expect(runtime.launch(INPUT)).rejects.toThrow("did not confirm");
    expect(records).toEqual([
      expect.objectContaining({ status: "started" }),
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(JSON.stringify(records)).not.toContain(
      "sk-this-is-a-fake-test-secret",
    );
  });

  it("enforces task, depth, artifact, payload, and turn caps before accepting a result", async () => {
    const { runtime, spawn } = createRuntime({
      policy: { ...POLICY, maxTasks: 1, maxDepth: 1, maxTurns: 1 },
      spawn: vi.fn().mockResolvedValue({
        effectiveModel: "gpt-5.6-terra",
        turns: 2,
        summary: "Too many turns.",
      }),
    });
    await expect(runtime.launch({ ...INPUT, depth: 2 })).rejects.toThrow(
      "depth",
    );
    await expect(
      runtime.launch({
        ...INPUT,
        artifacts: Array.from({ length: 13 }, (_, index) => ({
          id: `artifact-${index}`,
          summary: "Bounded summary.",
        })),
      }),
    ).rejects.toThrow("Too many bounded artifacts");
    await expect(runtime.launch(INPUT)).rejects.toThrow("turn contract");
    await expect(
      runtime.launch({ ...INPUT, taskId: "helper-2" }),
    ).rejects.toThrow("task cap");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("does not send sensitive prompt or artifact text to the helper", async () => {
    const { runtime, spawn } = createRuntime();
    await expect(
      runtime.launch({
        ...INPUT,
        prompt: "Use sk-this-is-a-fake-test-secret.",
      }),
    ).rejects.toThrow("sensitive");
    await expect(
      runtime.launch({
        ...INPUT,
        artifacts: [{ id: "proposal-1", summary: "Bearer fake-token-value" }],
      }),
    ).rejects.toThrow("sensitive");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("requires the runtime capability to match the configured requested and effective model", () => {
    expect(() =>
      createRuntime({
        capability: { ...CAPABILITY, effectiveModel: "gpt-5.6-luna" },
      }),
    ).toThrow("does not match");
  });
});
