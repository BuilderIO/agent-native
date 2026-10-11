import { afterEach, describe, expect, it, vi } from "vitest";

const fetchFileUploadStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/uploads", () => ({
  fetchFileUploadStatus,
}));

import { fetchReplayStorageStatus } from "./use-replay-storage-status";

afterEach(() => fetchFileUploadStatus.mockReset());

describe("fetchReplayStorageStatus", () => {
  it("keeps Builder model connection separate from upload authorization", async () => {
    fetchFileUploadStatus.mockResolvedValue({
      state: "available",
      value: {
        configured: false,
        builderConfigured: true,
        builderUploadConfigured: false,
      },
    });

    await expect(fetchReplayStorageStatus()).resolves.toMatchObject({
      configured: false,
      builderConfigured: true,
      builderUploadConfigured: false,
    });
  });

  it("preserves upload-status failures instead of falling back to Builder AI", async () => {
    fetchFileUploadStatus.mockResolvedValue({
      state: "unavailable",
      status: 503,
    });

    await expect(fetchReplayStorageStatus()).rejects.toThrow(
      "Replay storage status is unavailable",
    );
    expect(fetchFileUploadStatus).toHaveBeenCalledOnce();
  });

  it("rejects a status response without an authoritative configured value", async () => {
    fetchFileUploadStatus.mockResolvedValue({
      state: "available",
      value: { builderConfigured: true },
    });

    await expect(fetchReplayStorageStatus()).rejects.toThrow(
      "Replay storage status response is invalid",
    );
  });
});
