import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFileUploadStatusMock } = vi.hoisted(() => ({
  fetchFileUploadStatusMock: vi.fn(),
}));

vi.mock("../client-status-requests.js", () => ({
  fetchFileUploadStatus: fetchFileUploadStatusMock,
  invalidateClientStatusRequest: vi.fn(),
}));

import { readFileUploadStatus } from "./use-file-upload-status.js";

describe("readFileUploadStatus", () => {
  beforeEach(() => fetchFileUploadStatusMock.mockReset());

  it("returns the authoritative storage configuration", async () => {
    fetchFileUploadStatusMock.mockResolvedValue({
      state: "available",
      value: { configured: true },
    });

    await expect(readFileUploadStatus()).resolves.toEqual({ configured: true });
  });

  it("keeps an unavailable or malformed status separate from missing storage", async () => {
    fetchFileUploadStatusMock.mockResolvedValue({ state: "unavailable" });
    await expect(readFileUploadStatus()).rejects.toThrow(
      "File storage status is unavailable",
    );

    fetchFileUploadStatusMock.mockResolvedValue({
      state: "available",
      value: {},
    });
    await expect(readFileUploadStatus()).rejects.toThrow(
      "File storage status is unavailable",
    );
  });
});
