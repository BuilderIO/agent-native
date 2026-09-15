import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStateGet = vi.hoisted(() => vi.fn());
const mockDeleteAppState = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...args),
  deleteAppState: (...args: unknown[]) => mockDeleteAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

import {
  clearSeekableRepairPending,
  isSeekableRepairPending,
  markSeekableRepairPending,
} from "./seekable-media-state";

describe("seekable media repair state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAppState.mockResolvedValue(undefined);
    mockDeleteAppState.mockResolvedValue(true);
  });

  it("reads the owner-scoped marker for ready recordings", async () => {
    mockAppStateGet.mockResolvedValue({
      recordingId: "rec-1",
      status: "pending",
      videoUrl: "https://cdn.example.com/rec-1.webm",
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
        videoUrl: "https://cdn.example.com/rec-1.webm",
      }),
    ).resolves.toBe(true);
    expect(mockAppStateGet).toHaveBeenCalledWith(
      "owner@example.com",
      "recording-seekable-repair-rec-1",
    );
  });

  it("stops polling for terminal, expired, and mismatched markers", async () => {
    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "processing",
      }),
    ).resolves.toBe(false);
    expect(mockAppStateGet).not.toHaveBeenCalled();

    mockAppStateGet.mockResolvedValue({
      recordingId: "another-recording",
      status: "pending",
      videoUrl: "https://cdn.example.com/other.webm",
      startedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T00:01:00.000Z",
    });
    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
        videoUrl: "https://cdn.example.com/rec-1.webm",
      }),
    ).resolves.toBe(false);

    mockAppStateGet.mockResolvedValue({
      recordingId: "rec-1",
      status: "pending",
      videoUrl: "https://cdn.example.com/rec-1.webm",
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
        videoUrl: "https://cdn.example.com/rec-1.webm",
      }),
    ).resolves.toBe(false);
  });

  it("writes and clears a marker around a background repair", async () => {
    await markSeekableRepairPending({
      recordingId: "rec-1",
      videoUrl: "https://cdn.example.com/rec-1.webm",
    });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-seekable-repair-rec-1",
      expect.objectContaining({
        recordingId: "rec-1",
        status: "pending",
        videoUrl: "https://cdn.example.com/rec-1.webm",
      }),
    );

    await clearSeekableRepairPending("rec-1");
    expect(mockDeleteAppState).toHaveBeenCalledWith(
      "recording-seekable-repair-rec-1",
    );
  });

  it("surfaces an unreadable state store instead of treating it as absent", async () => {
    const error = new Error("state read failed");
    mockAppStateGet.mockRejectedValue(error);

    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
      }),
    ).rejects.toBe(error);
  });

  it("surfaces a malformed marker instead of treating it as absent", async () => {
    mockAppStateGet.mockResolvedValue({ recordingId: "rec-1" });

    await expect(
      isSeekableRepairPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
      }),
    ).rejects.toThrow("Malformed seekable repair marker");
  });
});
