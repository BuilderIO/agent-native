// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageFiles, uploadImageFile } from "./image-upload";

describe("image uploads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads image files through the framework file-upload endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: "https://cdn.example.com/diagram.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    await expect(uploadImageFile(file)).resolves.toBe(
      "https://cdn.example.com/diagram.png",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/file-upload"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(uploadedFile.name).toBe("diagram.png");
    expect(uploadedFile.type).toBe("image/png");
  });

  it("points users to Builder.io when file storage is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          error: "No file upload provider configured.",
        }),
      }),
    );

    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    await expect(uploadImageFile(file)).rejects.toThrow(
      "Connect Builder.io in Settings -> File uploads",
    );
  });

  it("ignores non-image files before uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });

    expect(getImageFiles([file])).toEqual([]);
    await expect(uploadImageFile(file)).rejects.toThrow(
      "Only image files can be uploaded.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
