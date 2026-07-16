// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
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

  it("uploads image files only through Content's document-media endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ url: "/api/document-media/media-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    await expect(uploadImageFile(file, "document-1")).resolves.toBe(
      "/api/document-media/media-1",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/document-media"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(body.get("documentId")).toBe("document-1");
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

    await expect(uploadImageFile(file, "document-1")).rejects.toThrow(
      "Image uploads need file storage",
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

    await expect(uploadImageFile(file, "document-1")).rejects.toThrow(
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

  it("fails closed before any request without a document id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    await expect(uploadImageFile(file)).rejects.toThrow(
      "Document media uploads require a document.",
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

    await expect(uploadVideoFile(file, "document-1")).resolves.toBe(
      "https://cdn.example.com/demo.mp4",
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(body.get("documentId")).toBe("document-1");
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

    await expect(uploadAudioFile(file, "document-1")).resolves.toBe(
      "https://cdn.example.com/demo.mp3",
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const uploadedFile = body.get("file") as File;
    expect(body.get("documentId")).toBe("document-1");
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
