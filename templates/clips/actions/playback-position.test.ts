import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsertConflict = vi.hoisted(() => vi.fn());

const { mockDb } = vi.hoisted(() => {
  const selectQuery: Record<string, any> = {};
  selectQuery.from = vi.fn(() => selectQuery);
  selectQuery.where = vi.fn(() => selectQuery);
  selectQuery.limit = (...args: unknown[]) => mockSelectLimit(...args);

  const insertQuery: Record<string, any> = {};
  insertQuery.values = (...args: unknown[]) => mockInsertValues(...args);
  insertQuery.onConflictDoUpdate = (...args: unknown[]) =>
    mockInsertConflict(...args);
  insertQuery.returning = (...args: unknown[]) => mockInsertReturning(...args);

  return {
    mockDb: {
      select: vi.fn(() => selectQuery),
      insert: vi.fn(() => insertQuery),
    },
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) => mockGetRequestUserEmail(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: class MockForbiddenError extends Error {},
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordingPlaybackPositions: {
      recordingId: "recordingPlaybackPositions.recordingId",
      viewerKey: "recordingPlaybackPositions.viewerKey",
      viewerEmail: "recordingPlaybackPositions.viewerEmail",
      positionMs: "recordingPlaybackPositions.positionMs",
      updatedAt: "recordingPlaybackPositions.updatedAt",
      createdAt: "recordingPlaybackPositions.createdAt",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "playback-row-1",
}));

import getPlaybackPosition from "./get-playback-position";
import savePlaybackPosition from "./save-playback-position";

describe("playback position actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUserEmail.mockReturnValue(undefined);
    mockResolveAccess.mockResolvedValue({ resource: { id: "rec-1" } });
    mockSelectLimit.mockResolvedValue([]);
    mockInsertValues.mockReturnValue({
      onConflictDoUpdate: (...args: unknown[]) => mockInsertConflict(...args),
    });
    mockInsertConflict.mockReturnValue({
      returning: (...args: unknown[]) => mockInsertReturning(...args),
    });
    mockInsertReturning.mockResolvedValue([
      {
        recordingId: "rec-1",
        viewerKey: "anon:session-1",
        viewerEmail: null,
        positionMs: 1200,
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ]);
  });

  it("loads an anonymous viewer position through the action surface", async () => {
    mockSelectLimit.mockResolvedValue([
      {
        recordingId: "rec-1",
        viewerKey: "anon:session-1",
        viewerEmail: null,
        positionMs: 4500,
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ]);

    await expect(
      getPlaybackPosition.run({
        recordingId: "rec-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      playbackPosition: {
        recordingId: "rec-1",
        viewerKey: "anon:session-1",
        viewerEmail: null,
        positionMs: 4500,
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    expect(mockResolveAccess).toHaveBeenCalledWith("recording", "rec-1");
  });

  it("upserts an authenticated viewer position", async () => {
    mockGetRequestUserEmail.mockReturnValue("Viewer@Example.com");

    await savePlaybackPosition.run({
      recordingId: "rec-1",
      positionMs: 1200,
      sessionId: "ignored-for-authenticated-viewer",
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "playback-row-1",
        recordingId: "rec-1",
        viewerKey: "viewer@example.com",
        viewerEmail: "viewer@example.com",
        positionMs: 1200,
      }),
    );
    expect(mockInsertConflict).toHaveBeenCalled();
  });

  it("rejects anonymous requests without a viewer session", async () => {
    await expect(
      getPlaybackPosition.run({ recordingId: "rec-1" }),
    ).rejects.toThrow("sessionId is required for anonymous viewers");
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });
});
