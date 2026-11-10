import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => undefined,
}));

vi.mock("../server/lib/meeting-recording-access.js", () => ({
  meetingRecordingTranscriptFilter: () => undefined,
}));

vi.mock("../server/db/index.js", () => {
  const table = (name: string) =>
    new Proxy(
      {},
      { get: (_table, column) => `${name}.${String(column)}` },
    ) as Record<string, string>;
  const query = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => void) => resolve(rows),
    };
    for (const step of ["from", "innerJoin", "where", "orderBy", "limit"]) {
      builder[step] = () => builder;
    }
    return builder;
  };
  return {
    getDb: () => ({
      select: (columns?: Record<string, unknown>) =>
        query(columns && !("fullText" in columns) ? state.rows : []),
      selectDistinct: () => query([]),
    }),
    schema: {
      meetings: table("meetings"),
      meetingShares: table("meetingShares"),
      meetingParticipants: table("meetingParticipants"),
      recordings: table("recordings"),
      recordingTranscripts: table("recordingTranscripts"),
    },
  };
});

import { AGENT_MEETINGS_PER_CALL } from "./lib/meeting-content";
import action from "./search-meetings";

const summaryMd = "# Summary\n\nWe talked about the renewal.";
const search = (caller: string) =>
  action.run({ query: "renewal", limit: 30, includeTrashed: false }, {
    caller,
  } as never);

describe("search-meetings", () => {
  beforeEach(() => {
    state.rows = [
      {
        id: "meeting-1",
        title: "Weekly sync",
        actualStart: "2026-08-14T17:00:00.000Z",
        summaryMd,
        userNotesMd: "Private notes",
      },
    ];
  });

  it.each(["mcp", "a2a", "tool", "webmcp"])(
    "gives a %s caller the match and a preview instead of the whole notes",
    async (caller) => {
      const { meetings } = await search(caller);

      expect(meetings[0]).toMatchObject({
        id: "meeting-1",
        matchType: "summary",
        snippet: expect.stringContaining("renewal"),
        summaryPreview: "# Summary We talked about the renewal.",
        hasNotes: true,
      });
      expect(meetings[0]).not.toHaveProperty("summaryMd");
      expect(meetings[0]).not.toHaveProperty("userNotesMd");
    },
  );

  it("gives an agent at most one page of matches", async () => {
    state.rows = Array.from({ length: 30 }, (_, index) => ({
      ...state.rows[0],
      id: `meeting-${index}`,
    }));

    expect(await search("mcp")).toMatchObject({
      meetings: expect.any(Array),
      hasMore: true,
    });
    expect((await search("mcp")).meetings).toHaveLength(
      AGENT_MEETINGS_PER_CALL,
    );
    expect(await search("frontend")).toMatchObject({ hasMore: false });
    expect((await search("frontend")).meetings).toHaveLength(30);
  });

  it("takes a query of at most 200 characters", () => {
    expect(action.schema.safeParse({ query: "a".repeat(201) }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ query: "a".repeat(200) }).success).toBe(
      true,
    );
  });

  it("leaves the app's own searches whole", async () => {
    const { meetings } = await search("frontend");

    expect(meetings[0]).toMatchObject({
      summaryMd,
      userNotesMd: "Private notes",
    });
  });
});
