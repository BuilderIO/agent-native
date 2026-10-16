import { afterEach, describe, expect, it, vi } from "vitest";

import {
  uploadDesignAudioFile,
  uploadDesignVideoFile,
} from "./design-media-upload";

afterEach(() => vi.unstubAllGlobals());

describe("uploadDesignVideoFile", () => {
  it("uploads a video as authenticated multipart and returns its durable URL", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ url: "https://cdn.example/video.mp4" }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["video"], "demo.mp4", { type: "video/mp4" });

    await expect(uploadDesignVideoFile(file)).resolves.toBe(
      "https://cdn.example/video.mp4",
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain("/_agent-native/file-upload");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBeInstanceOf(FormData);
    const uploadedFile = (init?.body as FormData).get("file");
    expect(uploadedFile).toMatchObject({
      name: file.name,
      type: file.type,
      size: file.size,
    });
  });

  it("rejects provider failures and non-durable upload results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Storage is unavailable." }), {
            status: 503,
          }),
      ),
    );
    await expect(
      uploadDesignVideoFile(
        new File(["video"], "demo.mp4", { type: "video/mp4" }),
      ),
    ).rejects.toThrow("Storage is unavailable.");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: "blob:temporary" }), {
            status: 201,
          }),
      ),
    );
    await expect(
      uploadDesignVideoFile(
        new File(["video"], "demo.mp4", { type: "video/mp4" }),
      ),
    ).rejects.toThrow("invalid URL");
  });

  it("reports unreadable upload responses instead of treating them as empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 503 })),
    );

    await expect(
      uploadDesignVideoFile(
        new File(["video"], "demo.mp4", { type: "video/mp4" }),
      ),
    ).rejects.toThrow("invalid JSON (503)");
  });
});

describe("uploadDesignAudioFile", () => {
  it("uploads an audio file as authenticated multipart and returns its durable URL", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ url: "https://cdn.example/audio.mp3" }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["audio"], "demo.mp3", { type: "audio/mpeg" });

    await expect(uploadDesignAudioFile(file)).resolves.toBe(
      "https://cdn.example/audio.mp3",
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain("/_agent-native/file-upload");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toMatchObject({
      name: file.name,
      type: file.type,
      size: file.size,
    });
  });

  it("rejects non-audio files and unusable storage responses", async () => {
    await expect(
      uploadDesignAudioFile(
        new File(["video"], "demo.mp4", { type: "video/mp4" }),
      ),
    ).rejects.toThrow("Only audio files can be uploaded.");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: "blob:temporary" }), {
            status: 201,
          }),
      ),
    );
    await expect(
      uploadDesignAudioFile(
        new File(["audio"], "demo.mp3", { type: "audio/mpeg" }),
      ),
    ).rejects.toThrow("Audio upload returned an invalid URL.");
  });
});
