import { afterEach, describe, expect, it, vi } from "vitest";

import { seekVideoToTime } from "./thumbnail-capture";

type Listener = (event: Event) => void;

function createFakeVideo(
  options: { currentTime?: number; readyState?: number } = {},
) {
  const listeners = new Map<string, Set<Listener>>();
  const video = {
    currentTime: options.currentTime ?? 0,
    readyState: options.readyState ?? 1,
    addEventListener(type: string, listener: Listener) {
      const handlers = listeners.get(type) ?? new Set<Listener>();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as HTMLVideoElement;

  return {
    video,
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener({} as Event);
    },
  };
}

describe("seekVideoToTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves only after the video lands on the requested frame", async () => {
    const fake = createFakeVideo();
    const seeking = seekVideoToTime(fake.video, 1_200, { timeoutMs: 50 });

    fake.video.currentTime = 1.2;
    fake.emit("seeked");

    await expect(seeking).resolves.toBeUndefined();
  });

  it("rejects when the seek event lands on a different frame", async () => {
    const fake = createFakeVideo();
    const seeking = seekVideoToTime(fake.video, 1_200, { timeoutMs: 50 });

    fake.video.currentTime = 0.1;
    fake.emit("seeked");

    await expect(seeking).rejects.toThrow("wrong frame");
  });

  it("rejects when the video never becomes seekable", async () => {
    vi.useFakeTimers();
    const fake = createFakeVideo({ readyState: 0 });
    const seeking = seekVideoToTime(fake.video, 1_200, { timeoutMs: 50 });
    const rejected = expect(seeking).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(50);

    await rejected;
  });
});
