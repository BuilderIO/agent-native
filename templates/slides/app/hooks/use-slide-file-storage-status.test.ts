import { afterEach, describe, expect, it, vi } from "vitest";

const fetchStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/uploads", () => ({
  fetchFileUploadStatus: fetchStatus,
}));

import { fetchSlideFileStorageStatus } from "./use-slide-file-storage-status";

afterEach(() => fetchStatus.mockReset());

describe("fetchSlideFileStorageStatus", () => {
  it("preserves an unavailable probe as an error", async () => {
    fetchStatus.mockResolvedValue({ state: "unavailable", status: 503 });

    await expect(fetchSlideFileStorageStatus()).rejects.toThrow(
      "File storage status is unavailable",
    );
  });

  it("returns an authoritative missing state", async () => {
    fetchStatus.mockResolvedValue({
      state: "available",
      value: { configured: false },
    });

    await expect(fetchSlideFileStorageStatus()).resolves.toEqual({
      configured: false,
      builderReauthorizationRequired: false,
    });
  });

  it("rejects a malformed status response", async () => {
    fetchStatus.mockResolvedValue({ state: "available", value: {} });

    await expect(fetchSlideFileStorageStatus()).rejects.toThrow(
      "File storage status response is invalid",
    );
  });
});
