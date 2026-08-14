import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockBuildPublicAgentContext = vi.hoisted(() => vi.fn());
const mockLoadPublicAgentAccess = vi.hoisted(() => vi.fn());
const mockLoadAgentTranscript = vi.hoisted(() => vi.fn());
const mockLoadAgentCtas = vi.hoisted(() => vi.fn());
const mockLoadAgentBrowserDiagnostics = vi.hoisted(() => vi.fn());
const mockLoadAgentBugReport = vi.hoisted(() => vi.fn());
const mockParseAgentChapters = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: vi.fn(),
  buildPublicAgentContext: (...args: unknown[]) =>
    mockBuildPublicAgentContext(...args),
  loadAgentBugReport: (...args: unknown[]) => mockLoadAgentBugReport(...args),
  loadAgentBrowserDiagnostics: (...args: unknown[]) =>
    mockLoadAgentBrowserDiagnostics(...args),
  loadAgentCtas: (...args: unknown[]) => mockLoadAgentCtas(...args),
  loadAgentTranscript: (...args: unknown[]) => mockLoadAgentTranscript(...args),
  loadPublicAgentAccess: (...args: unknown[]) =>
    mockLoadPublicAgentAccess(...args),
  MAX_PUBLIC_AGENT_HISTORY_ITEMS: 100,
  parseAgentChapters: (...args: unknown[]) => mockParseAgentChapters(...args),
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordingComments: {
      id: "comments.id",
      recordingId: "comments.recordingId",
      threadId: "comments.threadId",
      parentId: "comments.parentId",
      authorName: "comments.authorName",
      content: "comments.content",
      videoTimestampMs: "comments.videoTimestampMs",
      resolved: "comments.resolved",
      createdAt: "comments.createdAt",
      updatedAt: "comments.updatedAt",
    },
    recordingReactions: {
      id: "reactions.id",
      recordingId: "reactions.recordingId",
      emoji: "reactions.emoji",
      viewerName: "reactions.viewerName",
      createdAt: "reactions.createdAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn((value) => value),
  count: vi.fn(() => "count"),
  eq: vi.fn((left, right) => ({ left, right })),
}));

import handler from "./agent-context.json.get";

describe("/api/agent-context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({ id: "rec-1" });
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: {
        recording: {
          id: "rec-1",
          durationMs: 1234,
          status: "ready",
          enableComments: true,
          enableReactions: true,
        },
        viewerIsOwner: false,
        apiToken: null,
      },
    });
    mockLoadAgentTranscript.mockResolvedValue({
      transcript: null,
      agentSegments: [],
    });
    mockLoadAgentCtas.mockResolvedValue([]);
    mockLoadAgentBrowserDiagnostics.mockResolvedValue(null);
    mockLoadAgentBugReport.mockResolvedValue(null);
    mockParseAgentChapters.mockReturnValue([]);
    mockBuildPublicAgentContext.mockReturnValue({ ok: true });
    mockGetDb.mockReturnValue({
      select: vi.fn(() => {
        const builder: any = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          orderBy: vi.fn(() => builder),
          limit: vi.fn(async () => []),
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve([]).then(resolve),
        };
        return builder;
      }),
    });
  });

  it("passes comments and reactions into the shared agent payload", async () => {
    const comments = Array.from({ length: 101 }, (_, index) => ({
      id: `c${index}`,
    }));
    const reactions = Array.from({ length: 101 }, (_, index) => ({
      id: `r${index}`,
    }));
    const limitValues: number[] = [];
    const makeBuilder = (rows: unknown[]) => {
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(async (limit: number) => {
          limitValues.push(limit);
          return rows;
        }),
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return builder;
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeBuilder(comments))
        .mockReturnValueOnce(makeBuilder(reactions))
        .mockReturnValueOnce(makeBuilder([{ count: 250 }]))
        .mockReturnValueOnce(makeBuilder([{ count: 120 }])),
    };
    mockGetDb.mockReturnValue(db as any);

    await handler({} as any);

    expect(mockBuildPublicAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        comments: comments.slice(0, 100),
        reactions: reactions.slice(0, 100),
        commentCount: 250,
        commentsTruncated: true,
        reactionCount: 120,
        reactionsTruncated: true,
      }),
    );
    expect(limitValues).toEqual([101, 101]);
    expect(db.select.mock.calls[0][0]).not.toHaveProperty("authorEmail");
    expect(db.select.mock.calls[1][0]).not.toHaveProperty("viewerEmail");
  });
});
