import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildCurrentTimeUserContext,
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
    expect(prompt).toContain("currentDate: 2026-05-03");
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

  it("carries no sub-day-granularity timestamp so the cached system-prompt prefix stays stable", () => {
    const prompt = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T18:30:45.123Z"),
      timezone: "America/New_York",
    });

    // A millisecond ISO timestamp or any clock time (HH:MM) in this block
    // would invalidate the Anthropic prompt cache on every request — the
    // block sits inside the cached system-prompt prefix.
    expect(prompt).not.toMatch(/\d{2}:\d{2}/);
    expect(prompt).not.toContain("2026-05-03T");
    expect(prompt).not.toContain("currentUtc");
  });

  it("is byte-identical for any two instants within the same calendar day", () => {
    const morning = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T00:00:01Z"),
      timezone: "UTC",
    });
    const night = buildRuntimeContextPrompt({
      now: new Date("2026-05-03T23:59:59.999Z"),
      timezone: "UTC",
    });
    expect(morning).toBe(night);
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

describe("buildCurrentTimeUserContext", () => {
  it("carries the precise current time for per-turn user-message injection", () => {
    const block = buildCurrentTimeUserContext({
      now: new Date("2026-05-03T18:30:45.123Z"),
      timezone: "America/New_York",
    });

    expect(block).toContain("<current-time>");
    expect(block).toContain("currentUtc: 2026-05-03T18:30:45.123Z");
    expect(block).toContain("currentTimezone: America/New_York");
    // Local wall-clock time (2:30 PM EDT on that date) is present.
    expect(block).toMatch(/currentTimeInTimezone: .*2:30/);
  });

  it("falls back to UTC when the timezone is invalid", () => {
    const block = buildCurrentTimeUserContext({
      now: new Date("2026-05-03T18:30:45.123Z"),
      timezone: "not/a-zone",
    });

    expect(block).toContain("currentTimezone: UTC");
    expect(block).toContain("currentUtc: 2026-05-03T18:30:45.123Z");
  });
});

/**
 * Source guards for the prompt-caching invariants. The volatile precise time
 * must be injected per-turn into the USER message (production-agent.ts), and
 * every system-prompt assembly site must append the day-granular
 * runtime-context block LAST so a day rollover invalidates as little of the
 * cached prefix as possible. These read the source because the wiring lives
 * inside large request-handler closures that have no cheap unit seam.
 */
describe("prompt-caching wiring guards", () => {
  it("production-agent injects the precise per-turn time into the user message", () => {
    const source = readFileSync("src/agent/production-agent.ts", {
      encoding: "utf-8",
    });
    expect(source).toContain(
      'import { buildCurrentTimeUserContext } from "./runtime-context.js"',
    );
    expect(source).toContain('presendCap("time", timeContextThunk, "", 9000)');
    // The time block rides the same per-turn context that is appended to the
    // user message on every turn (including continuation/retry paths).
    expect(source).toContain(
      "const screenContext = timeBlock + screenBlock + urlBlock + selectionBlock;",
    );
  });

  it("agent-chat-plugin appends the runtime-context block last at every assembly site", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });
    // The bare `runtimeContext` identifier (or a direct
    // buildRuntimeContextPrompt() call) must never be followed by `+` in a
    // system-prompt concatenation — it has to be the final operand.
    expect(source).not.toMatch(/\bruntimeContext\b\s*\+/);
    expect(source).not.toMatch(/runtimeContextForEvent\([^)]*\)\s*\+/);
    expect(source).not.toMatch(/buildRuntimeContextPrompt\([^)]*\)\s*\+/);
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
