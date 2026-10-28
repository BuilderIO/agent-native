import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDb = vi.hoisted(() => vi.fn());
const mockUserAgent = vi.hoisted(() => ({ value: "" }));
const mockTrackClipEventForOwner = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: () => mockUserAgent.value,
  getRequestIP: () => "203.0.113.7",
}));

vi.mock("./clip-funnel-tracking.js", () => ({
  trackClipEventForOwner: (...args: unknown[]) =>
    mockTrackClipEventForOwner(...args),
}));

vi.mock("./recordings.js", () => ({
  nanoid: () => "view-1",
}));

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

function captureInsert(requestCount = 1) {
  const inserted: Record<string, unknown>[] = [];
  const conflictUpdates: Record<string, unknown>[] = [];
  mockGetDb.mockReturnValue({
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
            conflictUpdates.push(config.set);
            return { returning: async () => [{ requestCount }] };
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
    mockTrackClipEventForOwner.mockReset();
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

  describe("clip_agent_viewed", () => {
    const event = {} as never;

    it("fires once for the request that opens an agent session, keyed to the owner", async () => {
      captureInsert(1);
      mockUserAgent.value = "Claude-User/1.0";

      await recordAgentView(event, "rec-1", {
        ownerEmail: "owner@example.com",
        viaScopedLink: true,
      });

      expect(mockTrackClipEventForOwner).toHaveBeenCalledExactlyOnceWith(
        event,
        "clip_agent_viewed",
        "owner@example.com",
        { output_id: "rec-1", agent_label: "Claude", via_scoped_link: true },
      );
    });

    it("does not fire for later polls in the same agent session", async () => {
      captureInsert(2);
      mockUserAgent.value = "Claude-User/1.0";

      await recordAgentView(event, "rec-1", {
        ownerEmail: "owner@example.com",
      });

      expect(mockTrackClipEventForOwner).not.toHaveBeenCalled();
    });

    it("reports an unnamed agent as a null label and a public read as not scoped", async () => {
      captureInsert(1);
      mockUserAgent.value = "python-requests/2.32";

      await recordAgentView(event, "rec-1", {
        ownerEmail: "owner@example.com",
      });

      expect(mockTrackClipEventForOwner.mock.calls[0][3]).toEqual({
        output_id: "rec-1",
        agent_label: null,
        via_scoped_link: false,
      });
    });

    it("does not fire when the view could not be recorded", async () => {
      mockGetDb.mockReturnValue({
        insert: () => {
          throw new Error("db down");
        },
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        recordAgentView(event, "rec-1", { ownerEmail: "owner@example.com" }),
      ).resolves.toBeUndefined();

      expect(mockTrackClipEventForOwner).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
