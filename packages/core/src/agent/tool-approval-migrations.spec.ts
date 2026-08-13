import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_APPROVAL_INDEX_SQL,
  AGENT_TOOL_APPROVAL_MIGRATIONS,
  AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE,
  AGENT_TOOL_APPROVAL_TABLE_SQL,
} from "./tool-approval-migrations.js";

describe("agent tool approval migrations", () => {
  it("uses a dedicated named release migration table", () => {
    expect(AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE).toBe(
      "_agent_tool_approval_migrations",
    );
    expect(AGENT_TOOL_APPROVAL_MIGRATIONS).toEqual([
      expect.objectContaining({
        version: 1,
        name: "agent-tool-approvals-table-and-index",
      }),
    ]);
  });

  it("keeps approval timestamps 64-bit on Postgres and SQLite-compatible", () => {
    expect(AGENT_TOOL_APPROVAL_TABLE_SQL.postgres).toContain(
      "expires_at BIGINT NOT NULL",
    );
    expect(AGENT_TOOL_APPROVAL_TABLE_SQL.sqlite).toContain(
      "expires_at INTEGER NOT NULL",
    );
    expect(AGENT_TOOL_APPROVAL_INDEX_SQL).toContain(
      "idx_agent_tool_approvals_binding",
    );
    expect(AGENT_TOOL_APPROVAL_MIGRATIONS[0]?.sql).toEqual({
      postgres: expect.stringContaining(AGENT_TOOL_APPROVAL_INDEX_SQL),
      sqlite: expect.stringContaining(AGENT_TOOL_APPROVAL_INDEX_SQL),
    });
    expect(AGENT_TOOL_APPROVAL_MIGRATIONS[0]?.sql).toEqual({
      postgres: expect.stringContaining(`);\n${AGENT_TOOL_APPROVAL_INDEX_SQL}`),
      sqlite: expect.stringContaining(`);\n${AGENT_TOOL_APPROVAL_INDEX_SQL}`),
    });
  });
});
