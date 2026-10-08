import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadSlideVideo } from "./video-upload";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testVideoFile(): File {
  return new File(["video"], "clip.mp4", { type: "video/mp4" });
}

describe("uploadSlideVideo", () => {
  it("returns the uploaded video URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: "/assets/clip.mp4" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(uploadSlideVideo(testVideoFile())).resolves.toBe(
      "/assets/clip.mp4",
    );
  });

  it("sends large videos as bounded chunks and returns the assembled URL", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const fileSize = 5_566_718;
    const file = new File([new Uint8Array(fileSize)], "clip.mp4", {
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
        new Response(JSON.stringify({ url: "/assets/clip.mp4" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSlideVideo(file)).resolves.toBe("/assets/clip.mp4");

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
});
