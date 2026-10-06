import { afterEach, describe, expect, it, vi } from "vitest";

const fetchStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/uploads", () => ({
  fetchFileUploadStatus: fetchStatus,
}));

import { fetchVideoStorageStatus } from "./use-video-storage-status";

afterEach(() => fetchStatus.mockReset());

describe("fetchVideoStorageStatus", () => {
  it("preserves an unavailable probe as an error", async () => {
    fetchStatus.mockResolvedValue({ state: "unavailable", status: 503 });

    await expect(fetchVideoStorageStatus()).rejects.toThrow(
      "Video storage status is unavailable",
    );
  });

  it("returns an authoritative missing state", async () => {
    fetchStatus.mockResolvedValue({
      state: "available",
      value: { configured: false },
    });

    await expect(fetchVideoStorageStatus()).resolves.toEqual({
      configured: false,
      activeProvider: null,
      builderConfigured: false,
      builderUploadConfigured: false,
      builderReauthorizationRequired: false,
    });
  });

  it("rejects a malformed status response", async () => {
    fetchStatus.mockResolvedValue({ state: "available", value: {} });

    await expect(fetchVideoStorageStatus()).rejects.toThrow(
      "Video storage status response is invalid",
    );
  });
});
