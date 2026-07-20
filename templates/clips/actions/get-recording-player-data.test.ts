import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockForbiddenError } = vi.hoisted(() => {
  class MockForbiddenError extends Error {}
  return { MockForbiddenError };
});

const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockShareLimit = vi.hoisted(() => vi.fn(async () => []));
const mockShareQuery = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: mockShareLimit,
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
});
const mockDb = vi.hoisted(() => ({
  select: vi.fn((selection?: unknown) => {
    if (!selection) {
      throw new Error("player data query reached before share verification");
    }
    return mockShareQuery;
  }),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
  embedApp: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: (...args: unknown[]) => mockGetRequestOrgId(...args),
  getRequestUserEmail: (...args: unknown[]) => mockGetRequestUserEmail(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: MockForbiddenError,
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordingShares: {
      id: "recordingShares.id",
      principalType: "recordingShares.principalType",
      principalId: "recordingShares.principalId",
      resourceId: "recordingShares.resourceId",
    },
    recordingViewers: {
      id: "recordingViewers.id",
      recordingId: "recordingViewers.recordingId",
      viewerEmail: "recordingViewers.viewerEmail",
    },
    recordingTranscripts: { recordingId: "recordingTranscripts.recordingId" },
    recordingComments: {
      recordingId: "recordingComments.recordingId",
      videoTimestampMs: "recordingComments.videoTimestampMs",
      createdAt: "recordingComments.createdAt",
    },
    recordingReactions: {
      recordingId: "recordingReactions.recordingId",
      createdAt: "recordingReactions.createdAt",
    },
    recordingCtas: {
      recordingId: "recordingCtas.recordingId",
      createdAt: "recordingCtas.createdAt",
    },
    recordingBrowserDiagnostics: {
      recordingId: "recordingBrowserDiagnostics.recordingId",
    },
    recordingBugReports: { recordingId: "recordingBugReports.recordingId" },
    meetings: {
      id: "meetings.id",
      title: "meetings.title",
      recordingId: "meetings.recordingId",
    },
  },
}));

vi.mock("../server/lib/player-video-url.js", () => ({
  resolvePlayerVideoUrl: vi.fn(),
}));

vi.mock("../server/lib/media-verification-state.js", () => ({
  isMediaVerificationPending: vi.fn(() => false),
}));

vi.mock("../server/lib/recordings.js", () => ({
  parseSpaceIds: vi.fn(() => []),
}));

vi.mock("../shared/browser-diagnostics.js", () => ({
  parseBrowserDiagnosticsRow: vi.fn(() => null),
}));

vi.mock("../shared/builder-credits.js", () => ({
  CLIPS_BUILDER_CREDITS_STATE_KEY: "clips-builder-credits",
  normalizeBuilderCreditsStatus: vi.fn(() => null),
}));

vi.mock("../shared/transcript-segments.js", () => ({
  normalizeTranscriptSegments: vi.fn(() => []),
  parseTranscriptSegments: vi.fn(() => []),
}));

vi.mock("../shared/transcript-status.js", () => ({
  resolveTranscriptPresentation: vi.fn(() => ({
    status: "pending",
    failureReason: null,
  })),
}));

import action from "./get-recording-player-data";

describe("get-recording-player-data direct public access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockShareLimit.mockResolvedValue([]);
  });

  it.each(["admin", "editor", "viewer"] as const)(
    "requires an explicit recording share for %s callers",
    async (role) => {
      mockResolveAccess.mockResolvedValue({
        role,
        resource: {
          id: "rec-1",
          visibility: "public",
          password: null,
          expiresAt: null,
        },
      });

      await expect(action.run({ recordingId: "rec-1" })).rejects.toThrow(
        "Open this recording from its share link instead of the direct recording URL",
      );

      expect(mockDb.select).toHaveBeenCalledWith({
        id: "recordingShares.id",
      });
    expect(mockShareLimit).toHaveBeenCalledTimes(2);
    },
  );
});
