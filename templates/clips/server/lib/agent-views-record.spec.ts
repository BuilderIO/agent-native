import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDb = vi.hoisted(() => vi.fn());
const mockUserAgent = vi.hoisted(() => ({ value: "" }));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: () => mockUserAgent.value,
  getRequestIP: () => "203.0.113.7",
}));

vi.mock("./recordings.js", () => ({
  nanoid: () => "view-1",
}));

// A real table, not a stub: the conflict-update assertion below checks the SQL
// actually rendered for the label, which needs real column metadata.
vi.mock("../db/index.js", async () => {
  const { pgTable, text, integer } = await import("drizzle-orm/pg-core");
  return {
    getDb: (...args: unknown[]) => mockGetDb(...args),
    schema: {
      recordingAgentViews: pgTable("recording_agent_views", {
        recordingId: text("recording_id"),
        agentKey: text("agent_key"),
        agentLabel: text("agent_label"),
        userAgent: text("user_agent"),
        viewSessionId: text("view_session_id"),
        requestCount: integer("request_count"),
      }),
    },
  };
});

import { recordAgentView } from "./agent-views.js";

function captureInsert() {
  const inserted: Record<string, unknown>[] = [];
  const conflictUpdates: Record<string, unknown>[] = [];
  mockGetDb.mockReturnValue({
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          onConflictDoUpdate: async (config: {
            set: Record<string, unknown>;
          }) => {
            conflictUpdates.push(config.set);
          },
        };
      },
    }),
  });
  return { inserted, conflictUpdates };
}

describe("recordAgentView", () => {
  beforeEach(() => {
    mockGetDb.mockReset();
    mockUserAgent.value = "";
  });

  it("prefers the label the agent link was minted with over the user-agent", async () => {
    const { inserted } = captureInsert();
    mockUserAgent.value = "Claude-User/1.0";

    await recordAgentView({} as never, "rec-1", { agentLabel: "Fusion" });

    expect(inserted[0].agentLabel).toBe("Fusion");
  });

  it("falls back to the user-agent label when the link carried no name", async () => {
    const { inserted } = captureInsert();
    mockUserAgent.value = "Claude-User/1.0";

    await recordAgentView({} as never, "rec-1");

    expect(inserted[0].agentLabel).toBe("Claude");
  });

  it("stores a null label and the raw user-agent for an agent it cannot name", async () => {
    const { inserted } = captureInsert();
    mockUserAgent.value = "python-requests/2.32";

    await recordAgentView({} as never, "rec-1");

    expect(inserted[0].agentLabel).toBeNull();
    expect(inserted[0].userAgent).toBe("python-requests/2.32");
  });

  it("keeps a stored name when a later poll in the same session has none", async () => {
    const { conflictUpdates } = captureInsert();
    mockUserAgent.value = "python-requests/2.32";

    await recordAgentView({} as never, "rec-1");

    const rendered = new PgDialect().sqlToQuery(
      conflictUpdates[0].agentLabel as SQL,
    ).sql;
    expect(rendered).toBe(
      'COALESCE(excluded.agent_label, "recording_agent_views"."agent_label")',
    );
  });
});
