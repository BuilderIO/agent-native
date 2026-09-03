import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStateGet = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...args),
}));

import { isMediaVerificationPending } from "./media-verification-state";

describe("isMediaVerificationPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the owner-scoped durable marker for processing recordings", async () => {
    mockAppStateGet.mockResolvedValue({
      recordingId: "rec-1",
      status: "pending",
      completedAttempts: 1,
      nextAttemptAt: "2026-07-17T18:00:00.000Z",
      leaseUntil: null,
      updatedAt: "2026-07-17T17:59:00.000Z",
    });

    await expect(
      isMediaVerificationPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "processing",
      }),
    ).resolves.toBe(true);
    expect(mockAppStateGet).toHaveBeenCalledWith(
      "owner@example.com",
      "recording-media-verification-rec-1",
    );
  });

  it("does not read marker state for terminal recordings", async () => {
    await expect(
      isMediaVerificationPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "ready",
      }),
    ).resolves.toBe(false);
    expect(mockAppStateGet).not.toHaveBeenCalled();
  });

  it("rejects malformed or mismatched markers", async () => {
    mockAppStateGet.mockResolvedValue({
      recordingId: "another-recording",
      status: "pending",
      completedAttempts: 0,
      nextAttemptAt: "2026-07-17T18:00:00.000Z",
      leaseUntil: null,
      updatedAt: "2026-07-17T17:59:00.000Z",
    });

    await expect(
      isMediaVerificationPending({
        ownerEmail: "owner@example.com",
        recordingId: "rec-1",
        recordingStatus: "processing",
      }),
    ).resolves.toBe(false);
  });
});
