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
