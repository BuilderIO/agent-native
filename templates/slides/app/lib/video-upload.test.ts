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
