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

  it("recovers a lost final response through upload status", async () => {
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
          JSON.stringify({
            status: "complete",
            video: { id: "asset-1", url: "/assets/clip.mp4" },
          }),
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
    expect(fetchMock.mock.calls[3][0]).toContain(
      "/api/uploads-chunked/session-1/status",
    );
    expect(fetchMock.mock.calls[3][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ cache: "no-store" });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("polls a finalizing response until the completed video is available", async () => {
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
          JSON.stringify({ status: "processing", retryAfterMs: 1500 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "complete",
            video: { id: "asset-1", url: "/assets/clip.mp4" },
          }),
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3][0]).toContain("/status");
    expect(fetchMock.mock.calls[4][0]).toContain("/status");
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("keeps polling beyond the old retry window while finalization is active", async () => {
    const processing = () =>
      new Response(
        JSON.stringify({ status: "processing", retryAfterMs: 1500 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    const fetchMock = vi.fn();
    fetchMock
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
        new Response(JSON.stringify({ error: "Commit still running" }), {
          status: 504,
          headers: { "Content-Type": "application/json" },
        }),
      );
    for (let i = 0; i < 7; i++) {
      fetchMock.mockResolvedValueOnce(processing());
    }
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "complete",
          video: { id: "asset-1", url: "/assets/clip.mp4" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
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
    const finalChunkCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("index=1&isFinal=1"),
    );
    const statusCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/status"),
    );
    expect(finalChunkCalls).toHaveLength(1);
    expect(statusCalls).toHaveLength(8);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });

  it("bounds recovery when storage keeps failing while the session is uploading", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/uploads-chunked/start")) {
        return new Response(
          JSON.stringify({
            sessionId: "session-1",
            maxChunkBytes: 4 * 1024 * 1024,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("index=0&isFinal=0")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify({ status: "uploading" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ error: "Video storage is unavailable" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const upload = uploadSlideVideo(largeVideoFile());
    const rejected = expect(upload).rejects.toMatchObject({
      message: "Video storage is unavailable",
      status: 503,
    });
    await vi.runAllTimersAsync();
    await rejected;

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/status")),
    ).toHaveLength(24);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("index=1&isFinal=1"),
      ),
    ).toHaveLength(25);
  });

  it("does not retry a malformed successful final response", async () => {
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
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSlideVideo(largeVideoFile())).rejects.toMatchObject({
      message: "Video upload response was invalid",
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      "missing",
      new Response(JSON.stringify({ error: "Upload session was not found" }), {
        status: 404,
      }),
    ],
    [
      "expired",
      new Response(JSON.stringify({ status: "expired" }), { status: 200 }),
    ],
  ])(
    "preserves the finalization error when the session is %s",
    async (_kind, statusResponse) => {
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
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: "No object storage is connected" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          ),
        )
        .mockResolvedValueOnce(statusResponse);
      vi.stubGlobal("fetch", fetchMock);
      vi.useFakeTimers();

      const upload = uploadSlideVideo(largeVideoFile());
      const rejected = expect(upload).rejects.toMatchObject({
        message: "No object storage is connected",
        status: 503,
      });
      await vi.runAllTimersAsync();
      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

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
