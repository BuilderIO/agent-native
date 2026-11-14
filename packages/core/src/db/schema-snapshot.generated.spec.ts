import { describe, expect, it } from "vitest";

import { SCHEMA_SNAPSHOT } from "./schema-snapshot.generated.js";

describe("generated schema snapshot", () => {
  it("includes the persisted harness run policy column and migration", () => {
    const harnessSessions = SCHEMA_SNAPSHOT.statements.find((statement) =>
      statement.startsWith('CREATE TABLE "agent_harness_sessions"'),
    );
    expect(harnessSessions).toContain('"run_policy" text');
    expect(SCHEMA_SNAPSHOT.migrations).toContainEqual([
      "agent_harness_sessions",
      "agent-harness-sessions-run-policy",
      "005df5375106ffa4",
    ]);
  });
});
