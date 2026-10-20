import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
