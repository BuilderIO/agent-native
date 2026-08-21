// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createImagePickerId,
  createMediaUploadId,
  getAudioFiles,
  getImageFiles,
  getVideoFiles,
  uploadAudioFile,
  uploadImageFile,
  uploadVideoFile,
} from "./image-upload";

describe("image uploads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates operation ids for pending media uploads", () => {
    expect(createImagePickerId()).toMatch(/^image-picker-/);
    expect(createMediaUploadId("image")).toMatch(/^image-upload-/);
    expect(createMediaUploadId("video")).toMatch(/^video-upload-/);
    expect(createMediaUploadId("audio")).toMatch(/^audio-upload-/);
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

  it.each(["", "application/octet-stream"])(
    "normalizes an SVG with browser MIME %j before upload",
    async (type) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/diagram.svg" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const file = new File(["<svg></svg>"], "diagram-two-way-context.SVG", {
        type,
        lastModified: 123,
      });

      expect(getImageFiles([file])).toEqual([
        expect.objectContaining({
          name: "diagram-two-way-context.SVG",
          type: "image/svg+xml",
          lastModified: 123,
        }),
      ]);
      await expect(uploadImageFile(file)).resolves.toBe(
        "https://cdn.example.com/diagram.svg",
      );

      const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
      const uploadedFile = body.get("file") as File;
      expect(uploadedFile.name).toBe("diagram-two-way-context.SVG");
      expect(uploadedFile.type).toBe("image/svg+xml");
      expect(uploadedFile.lastModified).toBe(123);
    },
  );

  it("rejects an SVG filename with a contradictory image MIME", async () => {
    const file = new File(["<svg></svg>"], "diagram.svg", {
      type: "image/png",
    });

    expect(getImageFiles([file])).toEqual([]);
    await expect(uploadImageFile(file)).rejects.toThrow(
      "Only image files can be uploaded.",
    );
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

  it("tells users to reconnect Builder.io when saved credentials are rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          message: "Builder.io upload failed (401): Unauthorized",
        }),
      }),
    );

    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    await expect(uploadImageFile(file)).rejects.toThrow(
      "Reconnect Builder.io in Settings -> File uploads",
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

  it("uploads video files through the framework file-upload endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: "https://cdn.example.com/demo.mp4" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["video-bytes"], "demo.mp4", {
      type: "video/mp4",
    });

    await expect(uploadVideoFile(file)).resolves.toBe(
      "https://cdn.example.com/demo.mp4",
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(uploadedFile.name).toBe("demo.mp4");
    expect(uploadedFile.type).toBe("video/mp4");
  });

  it("ignores non-video files before uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    expect(getVideoFiles([file])).toEqual([]);
    await expect(uploadVideoFile(file)).rejects.toThrow(
      "Only video files can be uploaded.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads audio files through the framework file-upload endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: "https://cdn.example.com/demo.mp3" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["audio-bytes"], "demo.mp3", {
      type: "audio/mpeg",
    });

    await expect(uploadAudioFile(file)).resolves.toBe(
      "https://cdn.example.com/demo.mp3",
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(uploadedFile.name).toBe("demo.mp3");
    expect(uploadedFile.type).toBe("audio/mpeg");
  });

  it("ignores non-audio files before uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["video-bytes"], "demo.mp4", {
      type: "video/mp4",
    });

    expect(getAudioFiles([file])).toEqual([]);
    await expect(uploadAudioFile(file)).rejects.toThrow(
      "Only audio files can be uploaded.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
