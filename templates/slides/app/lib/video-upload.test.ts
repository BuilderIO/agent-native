import { afterEach, describe, expect, it, vi } from "vitest";

import { discardUploadedSlideVideo, uploadSlideVideo } from "./video-upload";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testVideoFile(): File {
  return new File(["video"], "clip.mp4", { type: "video/mp4" });
}

function largeVideoFile(): File {
  return new File([new Uint8Array(5_566_718)], "clip.mp4", {
    type: "video/mp4",
  });
}

describe("uploadSlideVideo", () => {
  it("returns the uploaded video URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: "asset-1", url: "/assets/clip.mp4" }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(uploadSlideVideo(testVideoFile())).resolves.toEqual({
      id: "asset-1",
      url: "/assets/clip.mp4",
    });
  });

  it("sends large videos as bounded chunks and returns the assembled URL", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const fileSize = 5_566_718;
    const file = largeVideoFile();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sessionId: "session-1", maxChunkBytes: chunkSize }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "asset-1", url: "/assets/clip.mp4" }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSlideVideo(file)).resolves.toEqual({
      id: "asset-1",
      url: "/assets/clip.mp4",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const startRequest = fetchMock.mock.calls[0];
    expect(startRequest[0]).toContain("/api/uploads-chunked/start");
    expect(JSON.parse(String(startRequest[1]?.body))).toMatchObject({
      filename: "clip.mp4",
      declaredSize: file.size,
      uploadType: "video",
    });
    const firstChunk = fetchMock.mock.calls[1][1]?.body as Blob;
    const finalChunk = fetchMock.mock.calls[2][1]?.body as Blob;
    expect(firstChunk.size).toBe(chunkSize);
    expect(finalChunk.size).toBe(fileSize - chunkSize);
    expect(fetchMock.mock.calls[1][0]).toContain("index=0&isFinal=0");
    expect(fetchMock.mock.calls[2][0]).toContain("index=1&isFinal=1");
  });

  it("cleans up the session after a chunk fails and preserves the upload error", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const file = new File([new Uint8Array(chunkSize * 2 + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sessionId: "session-1", maxChunkBytes: chunkSize }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Chunk storage failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSlideVideo(file)).rejects.toMatchObject({
      message: "Chunk storage failed",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toContain("index=1&isFinal=0");
    expect(fetchMock.mock.calls[3][0]).toContain(
      "/api/uploads-chunked/session-1",
    );
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: "DELETE",
      credentials: "include",
    });
  });

  it("cleans up the session after a chunk network failure", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const file = new File([new Uint8Array(chunkSize + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sessionId: "session-1", maxChunkBytes: chunkSize }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSlideVideo(file)).rejects.toThrow("connection lost");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });

  it("retries a final chunk after a lost response and does not abort the session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "session-1",
            maxChunkBytes: 4 * 1024 * 1024,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "asset-1", url: "/assets/clip.mp4" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const upload = uploadSlideVideo(largeVideoFile());
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toEqual({
      id: "asset-1",
      url: "/assets/clip.mp4",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toContain("index=1&isFinal=1");
    expect(fetchMock.mock.calls[3][0]).toBe(fetchMock.mock.calls[2][0]);
    expect(fetchMock.mock.calls[3][1]?.body).toBe(
      fetchMock.mock.calls[2][1]?.body,
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("retries a finalizing response until the completed video is available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "session-1",
            maxChunkBytes: 4 * 1024 * 1024,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Upload session is already finalizing" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "asset-1", url: "/assets/clip.mp4" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const upload = uploadSlideVideo(largeVideoFile());
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toEqual({
      id: "asset-1",
      url: "/assets/clip.mp4",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("leaves an ambiguous final chunk for server cleanup after bounded retries", async () => {
    const conflict = () =>
      new Response(
        JSON.stringify({ error: "Upload session is already finalizing" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "session-1",
            maxChunkBytes: 4 * 1024 * 1024,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockImplementation(async () => conflict());
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const upload = uploadSlideVideo(largeVideoFile());
    const uploadResult = upload.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.runAllTimersAsync();

    await expect(uploadResult).resolves.toMatchObject({
      error: { status: 409 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(18);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("surfaces an unreadable response as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })),
    );

    await expect(uploadSlideVideo(testVideoFile())).rejects.toMatchObject({
      message: "Video upload response was unreadable",
      status: 200,
    });
  });

  it("deletes a completed video asset when its pending placeholder is removed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(discardUploadedSlideVideo("asset 1")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/assets/video-uploads?id=asset%201"),
      { method: "DELETE", credentials: "include" },
    );
  });
});
