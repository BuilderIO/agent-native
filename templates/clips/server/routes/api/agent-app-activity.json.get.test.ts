import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  status: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  resolve: vi.fn(),
  read: vi.fn(),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: mocks.query,
  setResponseStatus: mocks.status,
}));
vi.mock("@agent-native/core/server", () => ({ getSession: mocks.session }));
vi.mock("../../lib/diagnostic-context.js", () => ({
  resolveRecordingDiagnosticAccess: mocks.resolve,
  readDiagnosticContext: mocks.read,
}));
vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: mocks.headers,
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
}));
import handler from "./agent-app-activity.json.get";

describe("diagnostic HTTP authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReturnValue({
      id: "private-video",
      diagnostic_access: "grant.receipt",
    });
    mocks.session.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({ context: { id: "context" } });
    mocks.read.mockResolvedValue({
      context: { id: "context" },
      canManage: false,
      events: [{ name: "approved" }],
      truncated: false,
    });
  });
  it("serves diagnostic-only grants before any playback authority and sends private response headers", async () => {
    const result = await handler({} as never);
    expect(result).toMatchObject({
      type: "agent-native.clip.diagnostic-context",
      events: [{ name: "approved" }],
    });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "private-video",
        diagnosticAccess: "grant.receipt",
      }),
    );
    expect(mocks.headers).toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    for (const key of [
      "transcript",
      "videoUrl",
      "recommendedFrames",
      "apis",
      "agent_access",
    ])
      expect(result).not.toHaveProperty(key);
  });
  it.each([
    { id: "video" },
    { id: "video", agent_access: "playback-token" },
    { id: "video", password: "video-password" },
  ])(
    "never treats playback credentials as a diagnostic grant: %j",
    async (query) => {
      mocks.query.mockReturnValue(query);
      expect(await handler({} as never)).toMatchObject({
        failureKind: "access",
      });
      expect(mocks.status).toHaveBeenCalledWith({}, 403);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it("checks current session diagnostic authority without using recording editor roles", async () => {
    mocks.query.mockReturnValue({ contextId: "context" });
    mocks.session.mockResolvedValue({
      email: "editor@example.com",
      orgId: "org-a",
    });
    mocks.resolve.mockRejectedValue(
      Object.assign(new Error("denied"), { statusCode: 403 }),
    );
    expect(await handler({} as never)).toMatchObject({ failureKind: "access" });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: "editor@example.com",
        orgId: "org-a",
      }),
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("validates and forwards every bounded page filter", async () => {
    mocks.query.mockReturnValue({
      contextId: "context",
      diagnostic_access: "grant.receipt",
      scopes: "summary,events",
      fromMs: "-300000",
      toMs: "20",
      start: "1",
      maxEvents: "2",
    });
    await handler({} as never);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopes: ["summary", "events"],
        fromMs: -300000,
        toMs: 20,
        start: 1,
        maxEvents: 2,
      }),
    );
    mocks.query.mockReturnValue({
      contextId: "context",
      diagnostic_access: "grant.receipt",
      maxEvents: "100000",
    });
    await handler({} as never);
    expect(mocks.status).toHaveBeenLastCalledWith({}, 400);
  });
  it("reports storage failure without returning cached global summaries or provider messages", async () => {
    mocks.read.mockRejectedValue(
      Object.assign(new Error("private storage location"), { statusCode: 503 }),
    );
    const result = await handler({} as never);
    expect(result).toEqual({
      failureKind: "storage",
      error: "Diagnostic context is unavailable.",
    });
    expect(result).not.toHaveProperty("summary");
    expect(mocks.status).toHaveBeenCalledWith({}, 503);
  });
});
