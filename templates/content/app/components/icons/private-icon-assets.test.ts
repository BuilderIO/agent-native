import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contentImageIconUrl,
  uploadPrivateIconFile,
} from "./private-icon-assets";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private icon client", () => {
  it("uploads through Content and keeps only the opaque ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "asset_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadPrivateIconFile(
      new File(["image"], "logo.png", { type: "image/png" }),
      "document-123",
    );

    expect(id).toBe("asset_123");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/private-icons",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body.get("documentId")).toBe(
      "document-123",
    );
  });

  it("does not turn malformed IDs into image URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "../other-user" }),
      }),
    );
    await expect(
      uploadPrivateIconFile(
        new File(["image"], "logo.png", { type: "image/png" }),
        "document-123",
      ),
    ).rejects.toThrow("invalid asset ID");
    expect(
      contentImageIconUrl({
        version: 1,
        kind: "image",
        authority: "private-icon",
        assetId: "../other-user",
      }),
    ).toBeUndefined();
  });
});
