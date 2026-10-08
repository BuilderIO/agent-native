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
      const { getPollEmitter, POLL_CHANGE_EVENT, recordChange } =
        await import("./poll.js");
      const { getAwarenessEmitter, AWARENESS_CHANGE_EVENT } =
        await import("../collab/awareness.js");
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

      await vi.advanceTimersByTimeAsync(2_000);
      expect(event.closed).toBe(true);
      const afterClose = event.pushed.length;

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

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
    "280000",
  ])(
    "rejects an invalid max duration (%s) instead of treating it as unset",
    async (maxDurationMs) => {
      const { createPollEventsHandler, validateSseMaxDurationMs } =
        await import("./poll-events.js");

      expect(() =>
        createPollEventsHandler(undefined, {
          maxDurationMs: maxDurationMs as number,
        }),
      ).toThrow(RangeError);
      expect(() =>
        validateSseMaxDurationMs(maxDurationMs, "sseMaxDurationMs"),
      ).toThrow(/^sseMaxDurationMs must be a positive finite number/);
    },
  );

  describe("events awaiting an access check", () => {
    const deckChange = (key: string, owner = "alice@example.com") => ({
      source: "deck",
      type: "deck-changed",
      key,
      owner,
      resourceType: "deck",
      resourceId: "deck-1",
    });

    async function openStream(
      resolveAccess: (
        type: string,
        id: string,
        ctx: { userEmail: string },
      ) => Promise<unknown>,
    ) {
      const { createPollEventsHandler } = await import("./poll-events.js");
      const { AppSyncState } = await import("./poll.js");
      mockSession.value = { email: "bob@example.com", orgId: undefined };
      const state = new AppSyncState({
        getDb: () =>
          ({
            execute: async () => ({ rows: [], rowsAffected: 0 }),
          }) as never,
        resolveAccess: resolveAccess as never,
      });
      const event = { pushed: [] as unknown[], close: undefined as any };
      await (createPollEventsHandler(state) as any)(event);
      const keys = () =>
        event.pushed
          .filter((data): data is string => typeof data === "string")
          .map((data) => JSON.parse(data).key);
      return { state, event, keys };
    }

    it("delivers a collaborator's first event once access is confirmed instead of dropping it", async () => {
      const { state, event, keys } = await openStream(async () => ({
        role: "editor",
      }));

      state.recordChange(deckChange("first"));
      await vi.waitFor(() => expect(keys()).toEqual(["first"]));

      state.recordChange(deckChange("second"));
      expect(keys()).toEqual(["first", "second"]);

      event.close?.();
    });

    it("keeps stream order when a later event is visible before the held one", async () => {
      let confirm!: () => void;
      const { state, event, keys } = await openStream(
        () =>
          new Promise((resolve) => {
            confirm = () => resolve({ role: "viewer" });
          }),
      );

      state.recordChange(deckChange("held"));
      state.recordChange({
        ...deckChange("own"),
        owner: "bob@example.com",
        resourceType: undefined,
        resourceId: undefined,
      });
      await Promise.resolve();
      expect(keys()).toEqual([]);

      confirm();
      await vi.waitFor(() => expect(keys()).toEqual(["held", "own"]));

      event.close?.();
    });

    it("withholds a held event the resolver denies and keeps delivering later ones", async () => {
      const { state, event, keys } = await openStream(async () => null);

      state.recordChange(deckChange("secret"));
      state.recordChange({
        ...deckChange("own"),
        owner: "bob@example.com",
        resourceType: undefined,
        resourceId: undefined,
      });
      await vi.waitFor(() => expect(keys()).toEqual(["own"]));

      event.close?.();
    });

    it("closes the stream when the access check outlasts the wait so the client polls", async () => {
      vi.useFakeTimers();
      try {
        const { state, event, keys } = await openStream(
          () => new Promise(() => {}),
        );

        state.recordChange(deckChange("stuck"));
        await vi.advanceTimersByTimeAsync(10_000);

        expect(keys()).toEqual([]);
        expect((event as any).closed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
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
