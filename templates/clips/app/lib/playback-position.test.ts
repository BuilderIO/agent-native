// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPlaybackPosition, savePlaybackPosition } from "./playback-position";

const mockCallAction = vi.hoisted(() => vi.fn());
const mockTryCallActionKeepalive = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  tryCallActionKeepalive: (...args: unknown[]) =>
    mockTryCallActionKeepalive(...args),
}));

describe("playback-position client helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallAction.mockResolvedValue({ playbackPosition: null });
    mockTryCallActionKeepalive.mockReturnValue({
      accepted: true,
      bodyBytes: 100,
      completion: Promise.resolve({ playbackPosition: { positionMs: 4500 } }),
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("loads the current viewer's saved position through an action", async () => {
    mockCallAction.mockResolvedValue({
      playbackPosition: { positionMs: 4_500 },
    });

    await expect(
      getPlaybackPosition("recording-1", { sessionId: "viewer-session-1" }),
    ).resolves.toBe(4_500);
    expect(mockCallAction).toHaveBeenCalledWith(
      "get-playback-position",
      { recordingId: "recording-1", sessionId: "viewer-session-1" },
      { method: "GET", signal: undefined },
    );
  });

  it("returns null for an existing viewer with no saved position", async () => {
    mockCallAction.mockResolvedValue({ playbackPosition: null });

    await expect(
      getPlaybackPosition("recording-1", { sessionId: "viewer-session-1" }),
    ).resolves.toBeNull();
  });

  it("fails loudly when the response shape is unreadable", async () => {
    mockCallAction.mockResolvedValue({
      playbackPosition: { positionMs: "later" },
    });

    await expect(
      getPlaybackPosition("recording-1", { sessionId: "viewer-session-1" }),
    ).rejects.toThrow("Invalid playback position payload");
  });

  it("saves a position with keepalive for unload flushes", async () => {
    await savePlaybackPosition("recording-1", 4_500, {
      keepalive: true,
      sessionId: "viewer-session-1",
    });

    expect(mockTryCallActionKeepalive).toHaveBeenCalledWith(
      "save-playback-position",
      {
        recordingId: "recording-1",
        positionMs: 4_500,
        sessionId: "viewer-session-1",
      },
      { signal: undefined },
    );
  });
});
