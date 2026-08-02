import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { startSseKeepAlive, SSE_KEEP_ALIVE_EVENT } from "./sse-keep-alive.js";

describe("startSseKeepAlive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits immediately so the stream is never silent", () => {
    // A stream that emits nothing reads as a hung handler to workerd, which
    // cancels the request and — under wrangler dev — takes the server with it.
    const pushes: any[] = [];
    startSseKeepAlive({ push: (m) => pushes.push(m) });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].event).toBe(SSE_KEEP_ALIVE_EVENT);
  });

  it("names the frame so it never reaches the client's onmessage", () => {
    // A bare `data:` frame would be parsed as a change event and corrupt sync.
    const pushes: any[] = [];
    startSseKeepAlive({ push: (m) => pushes.push(m) });

    expect(typeof pushes[0]).not.toBe("string");
    expect(pushes[0].event).toBeTruthy();
  });

  it("keeps emitting while the stream is open", async () => {
    const pushes: any[] = [];
    startSseKeepAlive({ push: (m) => pushes.push(m) });

    await vi.advanceTimersByTimeAsync(46_000);

    expect(pushes.length).toBeGreaterThanOrEqual(4);
  });

  it("stops on the returned stopper", async () => {
    const pushes: any[] = [];
    const stop = startSseKeepAlive({ push: (m) => pushes.push(m) });
    stop();
    const afterStop = pushes.length;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushes).toHaveLength(afterStop);
  });

  it("survives a push against an already-dead connection", async () => {
    let attempts = 0;
    const stop = startSseKeepAlive({
      push: () => {
        attempts++;
        throw new Error("stream closed");
      },
    });

    // A throwing push must not take down the interval or the request.
    await vi.advanceTimersByTimeAsync(31_000);

    expect(attempts).toBeGreaterThanOrEqual(3);
    stop();
  });
});
