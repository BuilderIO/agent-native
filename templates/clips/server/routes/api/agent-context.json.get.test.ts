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
const mockListComments = vi.hoisted(() =>
  vi.fn(async (_recordingId: string) => [] as unknown[]),
);
const mockHydrateCommentAuthorNames = vi.hoisted(() =>
  vi.fn(async (rows: unknown[]) => rows),
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: vi.fn(),
  buildPublicAgentContext: (...args: unknown[]) =>
    mockBuildPublicAgentContext(...args),
  canReadAppActivityEvents: async () => false,
  describeAgentAccessFailure: (failure: unknown) => failure,
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

vi.mock("../../lib/recording-comments.js", () => ({
  listRecordingComments: (recordingId: string) => mockListComments(recordingId),
}));

vi.mock("../../lib/user-identities.js", () => ({
  hydrateCommentAuthorNames: (rows: unknown[]) =>
    mockHydrateCommentAuthorNames(rows),
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
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
    mockListComments.mockResolvedValue([]);
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

  it.each([true, false])(
    "applies comments-off visibility to agent history with viewerIsOwner=%s",
    async (viewerIsOwner) => {
      mockLoadPublicAgentAccess.mockResolvedValue({
        ok: true,
        access: {
          recording: {
            id: "rec-1",
            durationMs: 1234,
            status: "ready",
            enableComments: false,
            enableReactions: false,
          },
          viewerIsOwner,
          apiToken: null,
        },
      });
      const savedComment = {
        id: "comment-test",
        content: "Fake saved comment",
        videoTimestampMs: 0,
      };
      mockListComments.mockResolvedValue([savedComment]);
      await handler({} as unknown as Parameters<typeof handler>[0]);
      expect(mockBuildPublicAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: viewerIsOwner ? [savedComment] : [],
          commentCount: viewerIsOwner ? 1 : 0,
        }),
      );
    },
  );

  it("passes comments and reactions into the shared agent payload", async () => {
    const comments = Array.from({ length: 250 }, (_, index) => ({
      id: `c${index}`,
      videoTimestampMs: index,
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
        .mockReturnValueOnce(makeBuilder(reactions))
        .mockReturnValueOnce(makeBuilder([{ count: 120 }])),
    };
    mockGetDb.mockReturnValue(db as any);
    mockListComments.mockResolvedValue(comments);

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
    expect(mockListComments).toHaveBeenCalledWith("rec-1");
    expect(limitValues).toEqual([101]);
    const selected = db.select.mock.calls.map(([fields]) => fields);
    expect(selected[0]).not.toHaveProperty("viewerEmail");
  });
});
