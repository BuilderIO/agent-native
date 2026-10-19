import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChunkedUploadSession } from "./chunked-upload-session";

const mocks = vi.hoisted(() => ({
  compareAndSetAppState: vi.fn(),
  deleteAppState: vi.fn(),
  listAppState: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.compareAndSetAppState,
  deleteAppState: mocks.deleteAppState,
  listAppState: mocks.listAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

import {
  createChunkedUploadSession,
  deleteOrphanedChunkCleanup,
  deleteOrphanedVideoAssetCleanup,
  listChunkedUploadSessions,
  recordOrphanedChunkCleanup,
  recordOrphanedVideoAssetCleanup,
} from "./chunked-upload-session";

const session: ChunkedUploadSession = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  filename: "deck.pdf",
  mimeType: "application/pdf",
  declaredSize: 4,
  chunks: {
    "0": {
      id: "blob-1",
      provider: "test-storage",
      opaque: true as const,
      encrypted: true,
    },
  },
  chunkSizes: { "0": 4 },
  createdAt: "2026-10-17T00:00:00.000Z",
  expiresAt: "2026-10-17T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAppState.mockImplementation(async (prefix: string) =>
    [
      {
        key: "slides-2:slides-upload-chunks-session-2",
        value: session,
      },
      {
        key: "slides-upload-chunks-session-slides",
        value: session,
      },
    ].filter((entry) => entry.key.startsWith(prefix)),
  );
});

describe("Slides 2 chunk upload application state", () => {
  it("keeps sessions and cleanup receipts under the Slides 2 namespace", async () => {
    await createChunkedUploadSession("session-2", session);
    await recordOrphanedChunkCleanup({
      version: 1,
      ownerEmail: session.ownerEmail!,
      orgId: session.orgId ?? null,
      uploadSessionId: "session-2",
      chunkIndex: 0,
      handle: session.chunks["0"],
      createdAt: session.createdAt,
    });
    await recordOrphanedVideoAssetCleanup({
      version: 1,
      ownerEmail: session.ownerEmail!,
      orgId: session.orgId ?? null,
      provider: "test-storage",
      providerObjectId: null,
      url: "https://files.example.test/video.mp4",
      uploadSessionId: "session-2",
      createdAt: session.createdAt,
    });

    expect(mocks.writeAppState).toHaveBeenNthCalledWith(
      1,
      "slides-2:slides-upload-chunks-session-2",
      session,
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^slides-2:slides-upload-orphan-chunk-/),
      expect.objectContaining({ handle: session.chunks["0"] }),
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^slides-2:slides-upload-orphan-video-asset-/),
      expect.objectContaining({ uploadSessionId: "session-2" }),
    );

    expect(session.chunks["0"]).not.toHaveProperty("data");
  });

  it("lists only Slides 2 sessions and leaves the Slides prefix unchanged", async () => {
    await expect(listChunkedUploadSessions()).resolves.toEqual([
      { sessionId: "session-2", session },
    ]);
    expect(mocks.listAppState).toHaveBeenCalledWith(
      "slides-2:slides-upload-chunks-",
    );
    expect(mocks.listAppState).not.toHaveBeenCalledWith(
      "slides-upload-chunks-",
    );
  });

  it("keeps orphan cleanup deletes inside the Slides 2 namespace", async () => {
    await deleteOrphanedChunkCleanup("slides-upload-orphan-chunk-old");
    await deleteOrphanedVideoAssetCleanup(
      "slides-2:slides-upload-orphan-video-asset-old",
    );

    expect(mocks.deleteAppState).toHaveBeenNthCalledWith(
      1,
      "slides-2:slides-upload-orphan-chunk-old",
    );
    expect(mocks.deleteAppState).toHaveBeenNthCalledWith(
      2,
      "slides-2:slides-upload-orphan-video-asset-old",
    );
    expect(mocks.deleteAppState).not.toHaveBeenCalledWith(
      "slides-upload-orphan-chunk-old",
    );
  });
});
