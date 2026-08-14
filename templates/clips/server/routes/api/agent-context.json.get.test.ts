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
  parseAgentChapters: (...args: unknown[]) => mockParseAgentChapters(...args),
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordingComments: {
      recordingId: "comments.recordingId",
      videoTimestampMs: "comments.videoTimestampMs",
      createdAt: "comments.createdAt",
    },
    recordingReactions: {
      recordingId: "reactions.recordingId",
      createdAt: "reactions.createdAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn((value) => value),
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
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          orderBy: vi.fn(async () => []),
        };
        return builder;
      }),
    });
  });

  it("passes comments and reactions into the shared agent payload", async () => {
    const comments = [{ id: "c1" }];
    const reactions = [{ id: "r1" }];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => comments),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => reactions),
            })),
          })),
        }),
    };
    mockGetDb.mockReturnValue(db as any);

    await handler({} as any);

    expect(mockBuildPublicAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        comments,
        reactions,
      }),
    );
  });
});
