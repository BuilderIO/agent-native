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

  it("routes recipient revoke invalidations across orgs without exposing them to other users", async () => {
    const { createPollEventsHandler } = await import("./poll-events.js");
    const { recordChange, getVersion, getChangesSinceForUser } =
      await import("./poll.js");
    const handler = createPollEventsHandler() as any;
    const recipient = { pushed: [] as unknown[], close: undefined as any };
    const outsider = { pushed: [] as unknown[], close: undefined as any };
    mockSession.value = {
      email: "recipient@example.test",
      orgId: "recipient-org",
    };
    await handler(recipient);
    mockSession.value = { email: "other@example.test", orgId: "recipient-org" };
    await handler(outsider);
    const before = getVersion();
    try {
      recordChange({
        source: "action",
        type: "change",
        key: "unshare-resource",
        owner: "recipient@example.test",
      });
      const messages = recipient.pushed.filter(
        (value) => typeof value === "string",
      );
      expect(messages).toHaveLength(1);
      const change = JSON.parse(messages[0] as string);
      expect(change).toMatchObject({
        key: "unshare-resource",
        owner: "recipient@example.test",
      });
      expect(change).not.toHaveProperty("resourceId");
      expect(change).not.toHaveProperty("orgId");
      expect(
        outsider.pushed.filter((value) => typeof value === "string"),
      ).toHaveLength(0);
      expect(
        getChangesSinceForUser(before, "recipient@example.test", "another-org")
          .events,
      ).toHaveLength(1);
      expect(
        getChangesSinceForUser(before, "other@example.test", "recipient-org")
          .events,
      ).toHaveLength(0);
    } finally {
      recipient.close?.();
      outsider.close?.();
    }
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
