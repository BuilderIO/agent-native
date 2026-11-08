import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStoredUpload } from "./upload-store.js";

const settings = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: settings.get,
  putUserSetting: settings.put,
}));

describe("getStoredUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds an upload this owner recorded", async () => {
    const upload = {
      filename: "abc.pdf",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      size: 1,
      createdAt: 1,
    };
    settings.get.mockResolvedValue({ uploads: { "abc.pdf": upload } });

    await expect(
      getStoredUpload("owner@example.com", "abc.pdf"),
    ).resolves.toEqual(upload);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "finds nothing for the name %s",
    async (filename) => {
      settings.get.mockResolvedValue({ uploads: {} });

      await expect(
        getStoredUpload("owner@example.com", filename),
      ).resolves.toBeNull();
    },
  );
});
