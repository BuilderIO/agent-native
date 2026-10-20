import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readResponseBytesWithLimit,
  VideoDownloadTooLargeError,
} from "./video-download-limits.js";

describe("video download byte limits", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels a response before reading when Content-Length exceeds the cap", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: {
          "content-length": "4",
          "content-type": "video/mp4",
        },
      },
    );

    await expect(
      readResponseBytesWithLimit(response, 3),
    ).rejects.toBeInstanceOf(VideoDownloadTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("cancels a streamed response as soon as cumulative bytes exceed the cap", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "video/mp4" } },
    );

    await expect(
      readResponseBytesWithLimit(response, 3),
    ).rejects.toBeInstanceOf(VideoDownloadTooLargeError);
    expect(cancelled).toBe(true);
  });
});
