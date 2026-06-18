import { afterEach, describe, expect, it } from "vitest";

import {
  buildRuntimeContextPrompt,
  MAX_SUBAGENT_DELEGATION_DEPTH,
  resolveMaxSubagentDelegationDepth,
} from "./runtime-context.js";

describe("buildRuntimeContextPrompt", () => {
  it("includes authoritative UTC and local dates for relative date resolution", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      timezone: "America/New_York",
    });

    expect(prompt).toContain("<runtime-context>");
    expect(prompt).toContain("currentUtc: 2026-05-03T18:30:00.000Z");
    expect(prompt).toContain("currentDateUtc: 2026-05-03");
    expect(prompt).toContain("currentTimezone: America/New_York");
    expect(prompt).toContain("currentDateInTimezone: 2026-05-03");
    expect(prompt).toContain("relative dates");
  });

  it("falls back to UTC when the timezone is invalid", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      timezone: "not/a-zone",
    });

    expect(prompt).toContain("currentTimezone: UTC");
    expect(prompt).toContain("currentDateInTimezone: 2026-05-03");
  });

  it("omits delegation lines for the top-level agent (depth 0 / unset)", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
    });
    expect(prompt).not.toContain("delegationDepth:");
  });

  it("surfaces a sub-agent's delegation depth and remaining headroom", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      delegationDepth: 1,
    });
    expect(prompt).toContain("delegationDepth: 1");
    expect(prompt).toContain(
      `maxDelegationDepth: ${MAX_SUBAGENT_DELEGATION_DEPTH}`,
    );
    expect(prompt).toContain("spawn additional sub-agents only when");
  });

  it("tells a sub-agent at the cap it cannot delegate further", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:00Z"),
      delegationDepth: MAX_SUBAGENT_DELEGATION_DEPTH,
    });
    expect(prompt).toContain(
      `delegationDepth: ${MAX_SUBAGENT_DELEGATION_DEPTH}`,
    );
    expect(prompt).toContain("cannot spawn further sub-agents");
  });
});

describe("resolveMaxSubagentDelegationDepth", () => {
  afterEach(() => {
    delete process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH;
  });

  it("defaults to MAX_SUBAGENT_DELEGATION_DEPTH when unset or blank", () => {
    expect(resolveMaxSubagentDelegationDepth({})).toBe(
      MAX_SUBAGENT_DELEGATION_DEPTH,
    );
    expect(
      resolveMaxSubagentDelegationDepth({
        AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "  ",
      }),
    ).toBe(MAX_SUBAGENT_DELEGATION_DEPTH);
  });

  it("parses a valid non-negative integer override", () => {
    expect(
      resolveMaxSubagentDelegationDepth({
        AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "4",
      }),
    ).toBe(4);
    expect(
      resolveMaxSubagentDelegationDepth({
        AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "0",
      }),
    ).toBe(0);
  });

  it("falls back to the default on invalid values", () => {
    for (const bad of ["abc", "-1", "2.5", "1e3", "0x4", "Infinity", "NaN"]) {
      expect(
        resolveMaxSubagentDelegationDepth({
          AGENT_NATIVE_MAX_SUBAGENT_DEPTH: bad,
        }),
      ).toBe(MAX_SUBAGENT_DELEGATION_DEPTH);
    }
  });

  it("clamps absurdly large overrides to the ceiling", () => {
    expect(
      resolveMaxSubagentDelegationDepth({
        AGENT_NATIVE_MAX_SUBAGENT_DEPTH: "9999",
      }),
    ).toBe(16);
  });

  it("reads process.env by default", () => {
    process.env.AGENT_NATIVE_MAX_SUBAGENT_DEPTH = "5";
    expect(resolveMaxSubagentDelegationDepth()).toBe(5);
  });
});
