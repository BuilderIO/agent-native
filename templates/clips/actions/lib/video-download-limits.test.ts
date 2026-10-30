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

  it("fails a stream that goes silent when pacing asks for it", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const silent = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel,
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(silent, { status: 200 }),
        1024,
        { idleMs: 1_000 },
      );
      const outcome = pending.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await outcome).toMatch(/stalled/);
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a trickle that never goes silent but delivers almost nothing", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const trickle = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!cancelled) controller.enqueue(new Uint8Array([1]));
            resolve();
          }, 400);
        }),
      cancel: () => {
        cancelled = true;
      },
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(trickle, { status: 200 }),
        1024,
        { idleMs: 1_000, minBytesPerIdleWindow: 100 },
      );
      const outcome = pending.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(1_300);
      expect(await outcome).toMatch(/too slow/);
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a slow but steady stream to the end without pacing complaints", async () => {
    vi.useFakeTimers();
    let sent = 0;
    const steady = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (sent === 3) controller.close();
            else controller.enqueue(new Uint8Array(200));
            sent += 1;
            resolve();
          }, 400);
        }),
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(steady, { status: 200 }),
        1024,
        { idleMs: 1_000, minBytesPerIdleWindow: 100 },
      );
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pending).byteLength).toBe(600);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a healthy-looking stream that outlives the total budget", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!cancelled) controller.enqueue(new Uint8Array(150));
            resolve();
          }, 100);
        }),
      cancel: () => {
        cancelled = true;
      },
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(endless, { status: 200 }),
        1024 * 1024,
        { idleMs: 1_000, minBytesPerIdleWindow: 100, maxTotalMs: 3_000 },
      );
      const outcome = pending.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(3_100);
      expect(await outcome).toMatch(/took longer/);
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a small file finish slowly when little of it is left", async () => {
    vi.useFakeTimers();
    let sent = 0;
    const small = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (sent === 3) controller.close();
            else controller.enqueue(new Uint8Array(10));
            sent += 1;
            resolve();
          }, 400);
        }),
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(small, {
          status: 200,
          headers: { "content-length": "30" },
        }),
        1024,
        { idleMs: 1_000, minBytesPerIdleWindow: 100 },
      );
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pending).byteLength).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });
});
