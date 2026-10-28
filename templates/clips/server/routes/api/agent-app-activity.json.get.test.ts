import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockLoadPublicAgentAccess = vi.hoisted(() => vi.fn());
const mockLoadRecordingAppActivity = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/app-activity.js", () => ({
  loadRecordingAppActivity: (...args: unknown[]) =>
    mockLoadRecordingAppActivity(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: vi.fn(),
  canReadAppActivityEvents: async (access: {
    viewerIsOwner: boolean;
    agentLinkCreatorEmail: string | null;
  }) => access.viewerIsOwner || access.agentLinkCreatorEmail !== null,
  describeAgentAccessFailure: (failure: unknown) => failure,
  loadPublicAgentAccess: (...args: unknown[]) =>
    mockLoadPublicAgentAccess(...args),
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));

import handler from "./agent-app-activity.json.get";

const summary = {
  app: "mail",
  build: "dev",
  eventCount: 3,
  failureCount: 1,
  dropped: 0,
  coverage: [{ fromElapsedMs: -30_000, toElapsedMs: 9_000 }],
  failures: [],
};
const events = [
  { timestampMs: 1, elapsedMs: -800, type: "action", name: "a" },
  { timestampMs: 2, elapsedMs: 500, type: "action", name: "b" },
  { timestampMs: 3, elapsedMs: 900, type: "action", name: "c" },
];

function grantAccess(access: {
  viewerIsOwner: boolean;
  agentLinkCreatorEmail: string | null;
  apiToken: string | null;
}) {
  mockLoadPublicAgentAccess.mockResolvedValue({
    ok: true,
    access: { recording: { id: "rec-1", title: "Demo" }, ...access },
  });
}

describe("/api/agent-app-activity route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({ id: "rec-1", agent_access: "tok" });
    grantAccess({
      viewerIsOwner: false,
      agentLinkCreatorEmail: "editor@example.com",
      apiToken: "tok",
    });
    mockLoadRecordingAppActivity.mockResolvedValue({
      status: "ok",
      summary,
      activity: { events, watched: { inbox: "shown" }, pending: [] },
    });
  });

  it("refuses an open public link without a Share with agents token", async () => {
    mockGetQuery.mockReturnValue({ id: "rec-1" });
    grantAccess({
      viewerIsOwner: false,
      agentLinkCreatorEmail: null,
      apiToken: null,
    });

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 403);
    expect(result).toMatchObject({ failureKind: "access" });
    expect(mockLoadRecordingAppActivity).not.toHaveBeenCalled();
  });

  it("serves a bounded window of events to a scoped link", async () => {
    mockGetQuery.mockReturnValue({
      id: "rec-1",
      agent_access: "tok",
      fromMs: "0",
      maxEvents: "1",
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({
      type: "agent-native.clip.app-activity",
      summary,
      events: [events[1]],
      matchedCount: 2,
      truncated: true,
      nextStart: 1,
      watched: { inbox: "shown" },
    });
    expect((result as { instructions: string[] }).instructions[0]).toMatch(
      /untrusted/,
    );
  });

  it("continues from start without repeating events that share a time", async () => {
    mockLoadRecordingAppActivity.mockResolvedValue({
      status: "ok",
      summary,
      activity: {
        events: [events[2], { ...events[2], name: "second-at-900" }],
        watched: {},
        pending: [],
      },
    });
    mockGetQuery.mockReturnValue({
      id: "rec-1",
      agent_access: "tok",
      start: "1",
      maxEvents: "1",
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({
      events: [{ name: "second-at-900" }],
      matchedCount: 2,
      truncated: false,
    });
  });

  it("reports missing storage as unavailable rather than as no activity", async () => {
    mockLoadRecordingAppActivity.mockResolvedValue({
      status: "unavailable",
      summary,
      reason: "gone",
    });

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 410);
    expect(result).toMatchObject({ failureKind: "storage", summary });
  });

  it("rejects a malformed window", async () => {
    mockGetQuery.mockReturnValue({
      id: "rec-1",
      agent_access: "tok",
      maxEvents: "0",
    });

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toMatchObject({ failureKind: "request" });
  });
});
