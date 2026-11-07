import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveTotalMs,
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

  it("arms the derived budget from Content-Length and fires it even when the pace is fine", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    // Claims 300 bytes, keeps sending: the floor is met every window, so
    // only the derived budget (three windows plus one) can end it.
    const overrun = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!cancelled) controller.enqueue(new Uint8Array(150));
            resolve();
          }, 300);
        }),
      cancel: () => {
        cancelled = true;
      },
    });
    try {
      const pending = readResponseBytesWithLimit(
        new Response(overrun, {
          status: 200,
          headers: { "content-length": "300" },
        }),
        1024 * 1024,
        { idleMs: 1_000, minBytesPerIdleWindow: 100 },
      );
      const outcome = pending.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(4_100);
      expect(await outcome).toMatch(/took longer than 4000ms/);
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives the total budget from the floor and the expected size", () => {
    const pacing = { idleMs: 60_000, minBytesPerIdleWindow: 1024 * 1024 };
    // 16 MB at 1 MB a minute: sixteen windows plus one.
    expect(deriveTotalMs(pacing, 16 * 1024 * 1024)).toBe(17 * 60_000);
    // An explicit figure wins.
    expect(deriveTotalMs({ ...pacing, maxTotalMs: 5_000 }, 1e12)).toBe(5_000);
    // No floor, no total.
    expect(deriveTotalMs({ idleMs: 60_000 }, 1e9)).toBeUndefined();
    // The size limit with no Content-Length is held to hours, not days.
    expect(deriveTotalMs(pacing, 50 * 1024 ** 3)).toBe(6 * 60 * 60_000);
  });
});
