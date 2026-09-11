import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../action.js";

const readOnlyEntry = { readOnly: true } as unknown as ActionEntry;

async function load() {
  vi.resetModules();
  const appConfig = await import("../app-config/index.js");
  appConfig.resetAppConfigForTests();
  const agent = await import("./production-agent.js");
  return { ...appConfig, ...agent };
}

function sweepCalls(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: "gong-calls",
    input: { company: `Account ${i + 1}` },
  }));
}

describe("agent.sourceSweepToolCallThreshold", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD;
  });

  it("defaults to 24", async () => {
    const { resolveSourceSweepToolCallThreshold } = await load();
    expect(resolveSourceSweepToolCallThreshold()).toBe(24);
  });

  it("moves the point at which the convergence guard fires", async () => {
    const { defineAppConfig, shouldGuardRepeatedSourceSweep } = await load();
    defineAppConfig({ agent: { sourceSweepToolCallThreshold: 40 } });

    const guardAt = (count: number) =>
      shouldGuardRepeatedSourceSweep({
        toolName: "gong-calls",
        entry: readOnlyEntry,
        priorToolCalls: sweepCalls(count),
      });

    // The previous default no longer stops the sweep.
    expect(guardAt(24)).toBeNull();
    expect(guardAt(39)).toBeNull();
    expect(guardAt(40)).toMatchObject({ priorCalls: 40 });
  });

  it("reports the configured budget in the message the agent reads", async () => {
    const { defineAppConfig, repeatedSourceSweepGuardMessage } = await load();
    defineAppConfig({ agent: { sourceSweepToolCallThreshold: 40 } });

    expect(
      repeatedSourceSweepGuardMessage({ toolName: "gong-calls" }),
    ).toContain("40-call convergence budget");
  });

  it("reads AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD", async () => {
    vi.stubEnv("AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD", "8");
    const { resolveSourceSweepToolCallThreshold } = await load();
    expect(resolveSourceSweepToolCallThreshold()).toBe(8);
  });

  it("rejects a non-positive budget at the call site that set it", async () => {
    const { defineAppConfig } = await load();
    expect(() =>
      defineAppConfig({ agent: { sourceSweepToolCallThreshold: 0 } }),
    ).toThrow();
  });
});
