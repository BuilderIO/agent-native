import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `instrumentAgentLoop` is applied by CALLERS, so every new way to start an
 * agent loop begins untraced and stays untraced until someone notices. It took
 * four entry points and one missed for a year — scheduled and queued runs, the
 * ones nobody is watching live, were the untraced ones.
 *
 * Attaching instrumentation at a chokepoint every path passes through is the
 * real fix, and it is not available today: the interactive handler, the A2A
 * bridge, agent teams, and the automation runner enter the loop through three
 * different runner shapes, and moving the decorator inside `runAgentLoop` would
 * double-wrap the three that already apply it. So this is the fallback the
 * brief asks for: enumerate the entry points and fail when one is unwrapped.
 *
 * ADDING AN ENTRY POINT? Wire `instrumentAgentLoop` into it and add it here.
 * Deleting a row because it is inconvenient is the failure mode this exists to
 * catch.
 */
const AGENT_LOOP_ENTRY_POINTS = [
  { file: "../agent/production-agent.ts", what: "interactive chat handler" },
  {
    file: "../server/agent-chat/action-filters-a2a.ts",
    what: "A2A / MCP delegated turns",
  },
  { file: "../server/agent-teams.ts", what: "agent teams" },
  {
    file: "../jobs/background-automation-runner.ts",
    what: "scheduled and queued automations",
  },
] as const;

describe("agent-loop instrumentation coverage", () => {
  for (const entry of AGENT_LOOP_ENTRY_POINTS) {
    it(`instruments the ${entry.what}`, async () => {
      const source = await readFile(
        fileURLToPath(new URL(entry.file, import.meta.url)),
        "utf8",
      );
      expect(source).toContain("instrumentAgentLoop");
    });
  }
});
