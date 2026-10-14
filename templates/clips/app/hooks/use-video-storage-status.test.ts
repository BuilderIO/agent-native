import { afterEach, describe, expect, it, vi } from "vitest";

const fetchStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: fetchStatus,
}));

import { fetchVideoStorageStatus } from "./use-video-storage-status";

afterEach(() => fetchStatus.mockReset());

describe("fetchVideoStorageStatus", () => {
  it("preserves an unavailable probe as an error", async () => {
    fetchStatus.mockRejectedValue(new Error("status unavailable"));

    await expect(fetchVideoStorageStatus()).rejects.toThrow(
      "status unavailable",
    );
  });

  it("returns an authoritative missing state", async () => {
    fetchStatus.mockResolvedValue({
      configured: false,
      mode: "none",
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      denyReason: "disabled",
    });

    await expect(fetchVideoStorageStatus()).resolves.toEqual({
      configured: false,
      activeProvider: null,
      builderConfigured: false,
      builderUploadConfigured: false,
      builderReauthorizationRequired: false,
      mode: "none",
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      denyReason: "disabled",
    });
  });

  it("preserves hosted provider failure separately from hosted allowance", async () => {
    fetchStatus.mockResolvedValue({
      configured: true,
      mode: "hosted",
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      providerError: "hosted_storage_unavailable",
    });

    await expect(fetchVideoStorageStatus()).resolves.toMatchObject({
      configured: true,
      mode: "hosted",
      hostedRemaining: 2,
      providerError: "hosted_storage_unavailable",
    });
  });

  it("rejects a malformed status response", async () => {
    fetchStatus.mockResolvedValue({});

    await expect(fetchVideoStorageStatus()).rejects.toThrow(
      "Video storage status response is invalid",
    );
  });
});
