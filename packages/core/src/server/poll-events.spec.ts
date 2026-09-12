import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSession = vi.hoisted(() => ({
  value: { email: "test@example.com", orgId: "org-1" } as {
    email: string;
    orgId?: string;
  } | null,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  setResponseStatus: (event: any, status: number) => {
    event.status = status;
  },
  createEventStream: (event: any) => ({
    push: (data: unknown) => {
      event.pushed.push(data);
    },
    onClosed: (callback: () => void) => {
      event.close = callback;
    },
    // h3's `close()` resolves the writer promise that `onClosed` subscribes to,
    // so a self-close runs the handler's teardown. Mirror that here, or the
    // lifespan test would pass against an implementation that leaks listeners.
    close: async () => {
      event.closed = true;
      event.close?.();
    },
    send: () => ({ stream: true }),
  }),
}));

vi.mock("./auth.js", () => ({
  getSession: async () => mockSession.value,
}));

describe("poll event SSE handler", () => {
  beforeEach(() => {
    mockSession.value = { email: "test@example.com", orgId: "org-1" };
  });

  it("streams only events visible to the authenticated user", async () => {
    const { createPollEventsHandler } = await import("./poll-events.js");
    const { recordChange } = await import("./poll.js");
    const handler = createPollEventsHandler() as any;
    const event = { pushed: [] as unknown[], close: undefined as any };

    await handler(event);

    recordChange({
      source: "action",
      type: "change",
      key: "own",
      owner: "test@example.com",
    });
    recordChange({
      source: "action",
      type: "change",
      key: "org",
      orgId: "org-1",
    });
    recordChange({
      source: "action",
      type: "change",
      key: "other",
      owner: "other@example.com",
    });
    recordChange({
      source: "action",
      type: "change",
      key: "global",
    });

    expect(
      event.pushed
        .filter((data): data is string => typeof data === "string")
        .map((data) => JSON.parse(data).key),
    ).toEqual(["own", "org", "global"]);

    event.close?.();
  });

  it("sends named heartbeats while the stream is idle", async () => {
    vi.useFakeTimers();
    try {
      const { createPollEventsHandler } = await import("./poll-events.js");
      const handler = createPollEventsHandler() as any;
      const event = { pushed: [] as unknown[], close: undefined as any };

      await handler(event);
      expect(event.pushed).toEqual([{ event: "heartbeat", data: "" }]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(event.pushed).toEqual([
        { event: "heartbeat", data: "" },
        { event: "heartbeat", data: "" },
      ]);

      event.close?.();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(event.pushed).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the stream open indefinitely when no max duration is set", async () => {
    vi.useFakeTimers();
    try {
      const { createPollEventsHandler } = await import("./poll-events.js");
      const handler = createPollEventsHandler() as any;
      const event = {
        pushed: [] as unknown[],
        close: undefined as any,
        closed: false,
      };

      await handler(event);
      await vi.advanceTimersByTimeAsync(60 * 60_000);

      expect(event.closed).toBe(false);

      event.close?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the stream and tears down its listeners at the max duration", async () => {
    vi.useFakeTimers();
    try {
      const { createPollEventsHandler } = await import("./poll-events.js");
      const { getPollEmitter, POLL_CHANGE_EVENT, recordChange } = await import(
        "./poll.js"
      );
      const { getAwarenessEmitter, AWARENESS_CHANGE_EVENT } = await import(
        "../collab/awareness.js"
      );
      const listeners = () => ({
        poll: getPollEmitter().listenerCount(POLL_CHANGE_EVENT),
        awareness: getAwarenessEmitter().listenerCount(AWARENESS_CHANGE_EVENT),
      });
      const before = listeners();
      const handler = createPollEventsHandler(undefined, {
        maxDurationMs: 280_000,
      }) as any;
      const event = {
        pushed: [] as unknown[],
        close: undefined as any,
        closed: false,
      };

      await handler(event);
      expect(listeners()).toEqual({
        poll: before.poll + 1,
        awareness: before.awareness + 1,
      });

      await vi.advanceTimersByTimeAsync(279_000);
      expect(event.closed).toBe(false);
      const beforeClose = event.pushed.length;
      expect(beforeClose).toBeGreaterThan(1);

      // A heartbeat scheduled for the same tick may land immediately before the
      // close — harmless, and why the assertion below counts from after it.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(event.closed).toBe(true);
      const afterClose = event.pushed.length;

      // The teardown must have run. Listener counts are the assertion that
      // matters: the handler's `closed` flag alone would silence the pushes
      // below while leaving both subscriptions attached for the life of the
      // process — a worse leak than the timeout this option removes.
      expect(listeners()).toEqual(before);

      await vi.advanceTimersByTimeAsync(60_000);
      recordChange({
        source: "action",
        type: "change",
        key: "after-close",
        owner: "test@example.com",
      });
      expect(event.pushed).toHaveLength(afterClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unauthenticated streams", async () => {
    mockSession.value = null;
    const { createPollEventsHandler } = await import("./poll-events.js");
    const handler = createPollEventsHandler() as any;
    const event = { pushed: [] as string[] };

    const response = await handler(event);

    expect(event.status).toBe(401);
    expect(response).toEqual({ error: "Unauthenticated" });
  });
});
