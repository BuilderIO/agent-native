import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const mockGetEventOwnerContext = vi.hoisted(() => vi.fn());
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockResolvePlayerVideoUrl = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
}));

vi.mock("../../../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
    },
  },
}));

vi.mock("../../../../lib/player-video-url.js", () => ({
  resolvePlayerVideoUrl: (...args: unknown[]) =>
    mockResolvePlayerVideoUrl(...args),
}));

vi.mock("../../../../lib/recordings.js", () => ({
  getEventOwnerContext: (...args: unknown[]) =>
    mockGetEventOwnerContext(...args),
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

import handler from "./status.get";

function createDbWithRows(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return {
    select: vi.fn(() => builder),
  };
}

describe("/api/uploads/:recordingId/status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRouterParam.mockReturnValue("rec-1");
    mockGetEventOwnerContext.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockResolvePlayerVideoUrl.mockReturnValue("/api/video/rec-1");
  });

  it("returns owner-scoped recording status for private recovery", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRows([
        {
          id: "rec-1",
          status: "ready",
          videoUrl: "s3://private/rec-1.webm",
          durationMs: 1234,
          width: 1280,
          height: 720,
          hasAudio: true,
          hasCamera: false,
          uploadProgress: 100,
          failureReason: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ]),
    );

    await expect(handler({} as any)).resolves.toMatchObject({
      recording: {
        id: "rec-1",
        status: "ready",
        videoUrl: "/api/video/rec-1",
        hasAudio: true,
        hasCamera: false,
      },
    });
  });

  it("returns 404 when the recording is not owned by the caller", async () => {
    mockGetDb.mockReturnValue(createDbWithRows([]));

    await expect(handler({} as any)).resolves.toEqual({ error: "Not found" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
  });
});
