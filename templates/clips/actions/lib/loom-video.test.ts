import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSsrfSafeFetch = vi.fn();

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

import { downloadLoomVideo, LoomVideoUnavailableError } from "./loom-video";

describe("downloadLoomVideo", () => {
  beforeEach(() => {
    mockSsrfSafeFetch.mockReset();
  });

  it("fetches Loom's signed MP4 URL and downloads bounded bytes", async () => {
    mockSsrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://cdn.loom.com/sessions/transcoded/video-id.mp4?Policy=signed",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-length": "3",
            "content-type": "video/mp4",
          },
        }),
      );

    const result = await downloadLoomVideo({
      loomId: "abcDEF_123456",
      shareUrl: "https://www.loom.com/share/abcDEF_123456",
    });

    expect(result).toMatchObject({
      mimeType: "video/mp4",
      sizeBytes: 3,
      sourceUrl:
        "https://cdn.loom.com/sessions/transcoded/video-id.mp4?Policy=signed",
    });
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(mockSsrfSafeFetch).toHaveBeenNthCalledWith(
      1,
      "https://www.loom.com/api/campaigns/sessions/abcDEF_123456/transcoded-url",
      expect.objectContaining({ method: "POST" }),
      { maxRedirects: 2 },
    );
  });

  it("rejects non-Loom download hosts", async () => {
    mockSsrfSafeFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://example.com/video.mp4" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      downloadLoomVideo({
        loomId: "abcDEF_123456",
        shareUrl: "https://www.loom.com/share/abcDEF_123456",
      }),
    ).rejects.toThrow(/cannot import safely/i);
  });

  it("returns a user-facing error when Loom exposes no MP4", async () => {
    mockSsrfSafeFetch.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    const download = downloadLoomVideo({
      loomId: "abcDEF_123456",
      shareUrl: "https://www.loom.com/share/abcDEF_123456",
    });

    await expect(download).rejects.toMatchObject({
      name: "LoomVideoUnavailableError",
      statusCode: 422,
    });
    await expect(download).rejects.toBeInstanceOf(LoomVideoUnavailableError);
  });

  it("rejects videos larger than the Clips upload limit", async () => {
    mockSsrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://cdn.loom.com/sessions/transcoded/video-id.mp4",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(), {
          status: 200,
          headers: {
            "content-length": String(MAX_UPLOAD_BYTES + 1),
            "content-type": "video/mp4",
          },
        }),
      );

    await expect(
      downloadLoomVideo({
        loomId: "abcDEF_123456",
        shareUrl: "https://www.loom.com/share/abcDEF_123456",
      }),
    ).rejects.toThrow(/too large/i);
  });
});
