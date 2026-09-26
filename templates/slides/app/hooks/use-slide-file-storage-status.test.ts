import { afterEach, describe, expect, it, vi } from "vitest";

const isReferenceStorageReady = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prompt-file-uploads", () => ({
  isReferenceStorageReady,
}));

import { fetchSlideFileStorageStatus } from "./use-slide-file-storage-status";

afterEach(() => isReferenceStorageReady.mockReset());

describe("fetchSlideFileStorageStatus", () => {
  it("preserves an unavailable probe as an error", async () => {
    isReferenceStorageReady.mockRejectedValue(new Error("status unavailable"));

    await expect(fetchSlideFileStorageStatus()).rejects.toThrow(
      "status unavailable",
    );
  });

  it("returns an authoritative missing state", async () => {
    isReferenceStorageReady.mockResolvedValue(false);

    await expect(fetchSlideFileStorageStatus()).resolves.toEqual({
      configured: false,
    });
  });

  it("preserves ready local Slides storage", async () => {
    isReferenceStorageReady.mockResolvedValue(true);

    await expect(fetchSlideFileStorageStatus()).resolves.toEqual({
      configured: true,
    });
  });
});
