import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertNotification = vi.fn();
const mockUpdateDeliveredChannels = vi.fn();
const mockAddDeliveredChannel = vi.fn();
const mockClaimNotificationDelivery = vi.fn();
const mockMarkNotificationDeliveryDispatching = vi.fn();
const mockMarkNotificationDeliveryUncertain = vi.fn();
const mockCompleteNotificationDelivery = vi.fn();
const mockReleaseNotificationDelivery = vi.fn();
const mockListCompletedNotificationChannels = vi.fn();
const mockNotificationIdForIdempotencyKey = vi.fn();
const mockListNotifications = vi.fn();
const mockCountUnread = vi.fn();
const mockMarkNotificationRead = vi.fn();
const mockMarkAllNotificationsRead = vi.fn();
const mockDeleteNotification = vi.fn();
const mockEmitAsync = vi.fn();
const mockGetSession = vi.fn();
const completedDeliveries = new Set<string>();
const pendingDeliveries = new Map<string, string>();
const dispatchingDeliveries = new Map<string, string>();
const uncertainDeliveries = new Set<string>();

function deliveryStateKey(
  notificationId: string,
  key: string,
  kind = "channel",
) {
  return `${notificationId}\0${kind}\0${key}`;
}

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) =>
    Object.fromEntries(event.url?.searchParams?.entries?.() ?? []),
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  createError: ({
    statusCode,
    statusMessage,
  }: {
    statusCode: number;
    statusMessage?: string;
  }) =>
    Object.assign(new Error(statusMessage ?? String(statusCode)), {
      statusCode,
    }),
}));

vi.mock("./store.js", () => ({
  insertNotification: (...args: unknown[]) => mockInsertNotification(...args),
  updateDeliveredChannels: (...args: unknown[]) =>
    mockUpdateDeliveredChannels(...args),
  addDeliveredChannel: (...args: unknown[]) => mockAddDeliveredChannel(...args),
  claimNotificationDelivery: (...args: unknown[]) =>
    mockClaimNotificationDelivery(...args),
  markNotificationDeliveryDispatching: (...args: unknown[]) =>
    mockMarkNotificationDeliveryDispatching(...args),
  markNotificationDeliveryUncertain: (...args: unknown[]) =>
    mockMarkNotificationDeliveryUncertain(...args),
  completeNotificationDelivery: (...args: unknown[]) =>
    mockCompleteNotificationDelivery(...args),
  releaseNotificationDelivery: (...args: unknown[]) =>
    mockReleaseNotificationDelivery(...args),
  listCompletedNotificationChannels: (...args: unknown[]) =>
    mockListCompletedNotificationChannels(...args),
  notificationIdForIdempotencyKey: (...args: unknown[]) =>
    mockNotificationIdForIdempotencyKey(...args),
  listNotifications: (...args: unknown[]) => mockListNotifications(...args),
  countUnread: (...args: unknown[]) => mockCountUnread(...args),
  markNotificationRead: (...args: unknown[]) =>
    mockMarkNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) =>
    mockMarkAllNotificationsRead(...args),
  deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),
}));

vi.mock("../event-bus/bus.js", () => ({
  emitAsync: (...args: unknown[]) => mockEmitAsync(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

import { createNotificationToolEntries } from "./actions.js";
import {
  notify,
  notifyWithDelivery,
  registerNotificationChannel,
  unregisterNotificationChannel,
  listNotificationChannels,
  __resetNotificationChannels,
} from "./registry.js";
import { createNotificationsHandler } from "./routes.js";

function createEvent(path: string, method = "GET") {
  return {
    method,
    url: new URL(`http://app.test${path}`),
    context: {},
    _status: 200,
  };
}

describe("notifications registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitAsync.mockResolvedValue(undefined);
    __resetNotificationChannels();
    mockGetSession.mockResolvedValue({ email: "boni@local" });
    mockListNotifications.mockResolvedValue([]);
    mockCountUnread.mockResolvedValue(0);
    mockInsertNotification.mockResolvedValue({
      id: "n-1",
      owner: "boni@local",
      severity: "info",
      title: "Hi",
      body: undefined,
      metadata: undefined,
      deliveredChannels: ["inbox"],
      createdAt: "2026-04-22T16:00:00.000Z",
      readAt: null,
    });
    completedDeliveries.clear();
    pendingDeliveries.clear();
    dispatchingDeliveries.clear();
    uncertainDeliveries.clear();
    mockNotificationIdForIdempotencyKey.mockImplementation(
      (owner: string, key: string) => `idem:${owner}:${key}`,
    );
    mockClaimNotificationDelivery.mockImplementation(
      async (id: string, key: string, kind = "channel") => {
        const stateKey = deliveryStateKey(id, key, kind);
        if (
          completedDeliveries.has(stateKey) ||
          uncertainDeliveries.has(stateKey) ||
          dispatchingDeliveries.has(stateKey) ||
          pendingDeliveries.has(stateKey)
        ) {
          return undefined;
        }
        const token = `claim-${stateKey}`;
        pendingDeliveries.set(stateKey, token);
        return token;
      },
    );
    mockMarkNotificationDeliveryDispatching.mockImplementation(
      async (id: string, key: string, token: string, kind = "channel") => {
        const stateKey = deliveryStateKey(id, key, kind);
        if (pendingDeliveries.get(stateKey) !== token) {
          throw new Error("claim token mismatch");
        }
        pendingDeliveries.delete(stateKey);
        dispatchingDeliveries.set(stateKey, token);
      },
    );
    mockCompleteNotificationDelivery.mockImplementation(
      async (id: string, key: string, token: string, kind = "channel") => {
        const stateKey = deliveryStateKey(id, key, kind);
        if (dispatchingDeliveries.get(stateKey) !== token) {
          throw new Error("claim token mismatch");
        }
        dispatchingDeliveries.delete(stateKey);
        completedDeliveries.add(stateKey);
      },
    );
    mockMarkNotificationDeliveryUncertain.mockImplementation(
      async (id: string, key: string, token: string, kind = "channel") => {
        const stateKey = deliveryStateKey(id, key, kind);
        if (dispatchingDeliveries.get(stateKey) !== token) {
          throw new Error("claim token mismatch");
        }
        dispatchingDeliveries.delete(stateKey);
        uncertainDeliveries.add(stateKey);
      },
    );
    mockReleaseNotificationDelivery.mockImplementation(
      async (id: string, key: string, token: string, kind = "channel") => {
        const stateKey = deliveryStateKey(id, key, kind);
        if (pendingDeliveries.get(stateKey) === token) {
          pendingDeliveries.delete(stateKey);
        }
        if (dispatchingDeliveries.get(stateKey) === token) {
          dispatchingDeliveries.delete(stateKey);
        }
      },
    );
    mockListCompletedNotificationChannels.mockImplementation(
      async (id: string) =>
        Array.from(completedDeliveries)
          .filter((key) => key.startsWith(`${id}\0channel\0`))
          .map((key) => key.slice(`${id}\0channel\0`.length)),
    );
  });

  describe("notify()", () => {
    it("persists an inbox row by default and emits notification.sent", async () => {
      const stored = await notify(
        { severity: "info", title: "Booking confirmed" },
        { owner: "boni@local" },
      );

      expect(mockInsertNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "boni@local",
          severity: "info",
          title: "Booking confirmed",
        }),
      );
      expect(stored?.id).toBe("n-1");
      expect(mockEmitAsync).toHaveBeenCalledWith(
        "notification.sent",
        expect.objectContaining({
          notificationId: "n-1",
          severity: "info",
          deliveredChannels: ["inbox"],
        }),
        { owner: "boni@local", eventId: "notification.sent:n-1" },
      );
    });

    it("does not deliver or emit after an inbox persist finishes after abort", async () => {
      let finishInsert!: (notification: {
        id: string;
        owner: string;
        severity: "info";
        title: string;
        deliveredChannels: string[];
        createdAt: string;
        readAt: null;
      }) => void;
      mockInsertNotification.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInsert = resolve;
          }),
      );
      const deliver = vi.fn();
      registerNotificationChannel({ name: "slow", deliver });
      const controller = new AbortController();
      const request = notify(
        { severity: "info", title: "Mail arrived" },
        { owner: "boni@local" },
        { signal: controller.signal },
      );

      await vi.waitFor(() => expect(finishInsert).toBeTypeOf("function"));
      controller.abort();
      finishInsert({
        id: "n-1",
        owner: "boni@local",
        severity: "info",
        title: "Mail arrived",
        deliveredChannels: ["inbox"],
        createdAt: "2026-09-28T16:00:00.000Z",
        readAt: null,
      });

      await expect(request).rejects.toBe(controller.signal.reason);
      expect(deliver).not.toHaveBeenCalled();
      expect(mockEmitAsync).not.toHaveBeenCalled();
    });

    it("retries an idempotent inbox commit that finished just before abort", async () => {
      let finishInsert!: (notification: {
        id: string;
        owner: string;
        severity: "info";
        title: string;
        deliveredChannels: string[];
        createdAt: string;
        readAt: null;
      }) => void;
      mockInsertNotification.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInsert = resolve;
          }),
      );
      const deliver = vi.fn();
      registerNotificationChannel({ name: "slack", deliver });
      const controller = new AbortController();
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-1",
      };
      const request = notifyWithDelivery(
        input,
        { owner: "boni@local" },
        {
          signal: controller.signal,
        },
      );

      await vi.waitFor(() => expect(finishInsert).toBeTypeOf("function"));
      controller.abort();
      finishInsert({
        id: "n-1",
        owner: "boni@local",
        severity: "info",
        title: "Mail arrived",
        deliveredChannels: ["inbox"],
        createdAt: "2026-09-28T16:00:00.000Z",
        readAt: null,
      });

      await expect(request).rejects.toBe(controller.signal.reason);
      expect(deliver).not.toHaveBeenCalled();
      expect(mockEmitAsync).not.toHaveBeenCalled();

      await notifyWithDelivery(input, { owner: "boni@local" });

      expect(deliver).toHaveBeenCalledTimes(1);
      expect(mockEmitAsync).toHaveBeenCalledTimes(1);
      expect(mockEmitAsync).toHaveBeenCalledWith(
        "notification.sent",
        expect.objectContaining({ notificationId: "n-1" }),
        {
          owner: "boni@local",
          eventId:
            "notification.sent:idem:boni@local:mail-rule:rule-1:message-1",
        },
      );
    });

    it("records channel and sent-event completion before returning an abort", async () => {
      const controller = new AbortController();
      const deliver = vi.fn(() => {
        controller.abort();
      });
      registerNotificationChannel({ name: "slack", deliver });
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-2",
      };

      await expect(
        notifyWithDelivery(
          input,
          { owner: "boni@local" },
          {
            signal: controller.signal,
          },
        ),
      ).rejects.toMatchObject({ name: "AbortError" });

      await notifyWithDelivery(input, { owner: "boni@local" });

      expect(deliver).toHaveBeenCalledTimes(1);
      expect(mockEmitAsync).toHaveBeenCalledTimes(1);
      expect(mockCompleteNotificationDelivery).toHaveBeenCalledWith(
        "idem:boni@local:mail-rule:rule-1:message-2",
        "slack",
        expect.any(String),
      );
      expect(mockCompleteNotificationDelivery).toHaveBeenCalledWith(
        "idem:boni@local:mail-rule:rule-1:message-2",
        "notification.sent",
        expect.any(String),
        "event",
      );
    });

    it("waits for notification.sent subscribers before completing its receipt", async () => {
      let acceptEvent!: () => void;
      mockEmitAsync.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            acceptEvent = resolve;
          }),
      );
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-async-acceptance",
      };
      const deliveryId =
        "idem:boni@local:mail-rule:rule-1:message-async-acceptance";
      let settled = false;
      const request = notifyWithDelivery(input, { owner: "boni@local" }).then(
        (result) => {
          settled = true;
          return result;
        },
      );

      await vi.waitFor(() => expect(acceptEvent).toBeTypeOf("function"));
      expect(mockEmitAsync).toHaveBeenCalledWith(
        "notification.sent",
        expect.objectContaining({ notificationId: "n-1" }),
        {
          owner: "boni@local",
          eventId: `notification.sent:${deliveryId}`,
        },
      );
      expect(settled).toBe(false);
      expect(mockCompleteNotificationDelivery).not.toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );

      acceptEvent();
      await request;

      expect(mockCompleteNotificationDelivery).toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );
    });

    it("releases a rejected sent-event receipt and retries with the same event id", async () => {
      mockEmitAsync
        .mockRejectedValueOnce(new Error("trigger queue unavailable"))
        .mockResolvedValueOnce(undefined);
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-event-retry",
      };
      const deliveryId = "idem:boni@local:mail-rule:rule-1:message-event-retry";
      const eventId = `notification.sent:${deliveryId}`;

      await notifyWithDelivery(input, { owner: "boni@local" });
      const eventReceiptRelease =
        mockReleaseNotificationDelivery.mock.calls.find(
          ([id, key, , kind]) =>
            id === deliveryId &&
            key === "notification.sent" &&
            kind === "event",
        );
      expect(eventReceiptRelease).toBeDefined();
      expect(mockMarkNotificationDeliveryUncertain).not.toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );

      await notifyWithDelivery(input, { owner: "boni@local" });

      expect(mockEmitAsync).toHaveBeenCalledTimes(2);
      expect(mockEmitAsync.mock.calls.map(([, , meta]) => meta)).toEqual([
        { owner: "boni@local", eventId },
        { owner: "boni@local", eventId },
      ]);
      expect(mockCompleteNotificationDelivery).toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );
    });

    it("keeps the sent-event receipt uncertain if acceptance is confirmed but completion is ambiguous", async () => {
      mockCompleteNotificationDelivery.mockRejectedValueOnce(
        new Error("receipt write timed out"),
      );
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey:
          "mail-rule:rule-1:message-accepted-completion-uncertain",
      };
      const deliveryId =
        "idem:boni@local:mail-rule:rule-1:message-accepted-completion-uncertain";

      await notifyWithDelivery(input, { owner: "boni@local" });
      await notifyWithDelivery(input, { owner: "boni@local" });

      expect(mockEmitAsync).toHaveBeenCalledTimes(1);
      expect(mockMarkNotificationDeliveryUncertain).toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );
      expect(mockReleaseNotificationDelivery).not.toHaveBeenCalledWith(
        deliveryId,
        "notification.sent",
        expect.any(String),
        "event",
      );
    });

    it("skips completed idempotent channels and does not re-emit the sent event", async () => {
      const deliver = vi.fn();
      registerNotificationChannel({ name: "slack", deliver });
      const input = {
        severity: "info" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-3",
      };

      await notifyWithDelivery(input, { owner: "boni@local" });
      await notifyWithDelivery(input, { owner: "boni@local" });

      expect(deliver).toHaveBeenCalledTimes(1);
      expect(mockEmitAsync).toHaveBeenCalledTimes(1);
    });

    it("suppresses an idempotent retry after a channel throws during dispatch", async () => {
      const deliver = vi.fn(async () => {
        throw new Error("connection ended after the request was sent");
      });
      registerNotificationChannel({ name: "slack", deliver });
      const input = {
        severity: "critical" as const,
        title: "Mail arrived",
        idempotencyKey: "mail-rule:rule-1:message-4",
      };

      await notifyWithDelivery(input, { owner: "boni@local" });
      await notifyWithDelivery(input, { owner: "boni@local" });

      const stateKey = deliveryStateKey(
        "idem:boni@local:mail-rule:rule-1:message-4",
        "slack",
      );
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(mockMarkNotificationDeliveryUncertain).toHaveBeenCalledTimes(1);
      expect(uncertainDeliveries.has(stateKey)).toBe(true);
      expect(mockReleaseNotificationDelivery).not.toHaveBeenCalledWith(
        "idem:boni@local:mail-rule:rule-1:message-4",
        "slack",
        expect.any(String),
      );
    });

    it("requires meta.owner", async () => {
      await expect(
        notify({ severity: "info", title: "x" }, { owner: "" }),
      ).rejects.toThrow(/owner is required/);
    });

    it("does not persist delivery-only webhook metadata in the inbox row", async () => {
      await notify(
        {
          severity: "critical",
          title: "DB offline",
          metadata: {
            monitorId: "mon_1",
            delivery: {
              webhookUrl: "https://hooks.example.com/per-monitor",
              slackWebhookUrl: "https://hooks.slack.example.com/services/T/B/C",
            },
            webhookUrl: "https://hooks.example.com/legacy",
          },
        },
        { owner: "boni@local" },
      );

      expect(mockInsertNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { monitorId: "mon_1" },
        }),
      );
    });

    it("fans out to registered channels in addition to the inbox row", async () => {
      const deliver = vi.fn();
      registerNotificationChannel({ name: "slack", deliver });

      await notify(
        { severity: "warning", title: "Disk low" },
        { owner: "boni@local" },
      );

      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "warning", title: "Disk low" }),
        { owner: "boni@local" },
      );
      expect(mockInsertNotification).toHaveBeenCalledTimes(1);
    });

    it("passes cancellation to registered notification channels", async () => {
      const controller = new AbortController();
      const deliver = vi.fn();
      registerNotificationChannel({ name: "slow", deliver });

      await notifyWithDelivery(
        { severity: "info", title: "Mail arrived", channels: ["slow"] },
        { owner: "boni@local" },
        { signal: controller.signal },
      );

      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Mail arrived" }),
        { owner: "boni@local" },
        { signal: controller.signal },
      );
    });

    it("channel throws — other channels still run and inbox still persists", async () => {
      const badDeliver = vi.fn(() => {
        throw new Error("slack is down");
      });
      const goodDeliver = vi.fn();
      registerNotificationChannel({ name: "slack", deliver: badDeliver });
      registerNotificationChannel({ name: "pager", deliver: goodDeliver });

      await notify(
        { severity: "critical", title: "DB offline" },
        { owner: "boni@local" },
      );

      expect(badDeliver).toHaveBeenCalled();
      expect(goodDeliver).toHaveBeenCalled();
      expect(mockInsertNotification).toHaveBeenCalled();
    });

    it("failed channels are excluded from deliveredChannels on the emit event", async () => {
      registerNotificationChannel({
        name: "slack",
        deliver: () => {
          throw new Error("slack is down");
        },
      });
      registerNotificationChannel({
        name: "pager",
        deliver: async () => {},
      });

      await notify(
        { severity: "critical", title: "DB offline" },
        { owner: "boni@local" },
      );

      const eventCall = mockEmitAsync.mock.calls.find(
        ([name]) => name === "notification.sent",
      );
      expect(eventCall).toBeDefined();
      const [, payload] = eventCall!;
      expect(payload.deliveredChannels).toEqual(
        expect.arrayContaining(["inbox", "pager"]),
      );
      expect(payload.deliveredChannels).not.toContain("slack");
      expect(mockAddDeliveredChannel).toHaveBeenCalledWith("n-1", "pager");
    });

    it("truncates overlong titles + bodies", async () => {
      const longTitle = "x".repeat(150);
      const longBody = "y".repeat(3000);

      await notify(
        { severity: "info", title: longTitle, body: longBody },
        { owner: "boni@local" },
      );

      const call = mockInsertNotification.mock.calls[0][0];
      expect(call.title.length).toBeLessThanOrEqual(100);
      expect(call.title.endsWith("…")).toBe(true);
      expect(call.body.length).toBeLessThanOrEqual(2000);
      expect(call.body.endsWith("…")).toBe(true);
    });

    it("explicit channels allowlist scopes delivery and excludes inbox when omitted", async () => {
      const deliverSlack = vi.fn();
      const deliverPager = vi.fn();
      registerNotificationChannel({ name: "slack", deliver: deliverSlack });
      registerNotificationChannel({ name: "pager", deliver: deliverPager });

      await notify(
        { severity: "info", title: "Test", channels: ["slack"] },
        { owner: "boni@local" },
      );

      expect(deliverSlack).toHaveBeenCalled();
      expect(deliverPager).not.toHaveBeenCalled();
      expect(mockInsertNotification).not.toHaveBeenCalled();
    });

    it("exposes custom-channel delivery even when there is no inbox row", async () => {
      const deliverSlack = vi.fn();
      registerNotificationChannel({ name: "slack", deliver: deliverSlack });

      const delivery = await notifyWithDelivery(
        { severity: "critical", title: "Test", channels: ["slack"] },
        { owner: "boni@local" },
      );

      expect(delivery.notification).toBeUndefined();
      expect(delivery.deliveredChannels).toEqual(["slack"]);
      expect(mockInsertNotification).not.toHaveBeenCalled();
      expect(mockEmitAsync).toHaveBeenCalledWith(
        "notification.sent",
        expect.objectContaining({
          notificationId: undefined,
          deliveredChannels: ["slack"],
        }),
        { owner: "boni@local" },
      );
    });

    it("channels=['inbox'] persists but skips custom channels", async () => {
      const deliverSlack = vi.fn();
      registerNotificationChannel({ name: "slack", deliver: deliverSlack });

      await notify(
        { severity: "info", title: "Test", channels: ["inbox"] },
        { owner: "boni@local" },
      );

      expect(mockInsertNotification).toHaveBeenCalled();
      expect(deliverSlack).not.toHaveBeenCalled();
    });
  });

  describe("channel registration", () => {
    it("requires a name", () => {
      expect(() =>
        registerNotificationChannel({
          name: "",
          deliver: () => undefined,
        }),
      ).toThrow(/name is required/);
    });

    it("requires deliver to be a function", () => {
      expect(() =>
        registerNotificationChannel({
          name: "bad",
          deliver: "nope" as unknown as NotificationChannel["deliver"],
        }),
      ).toThrow(/must be a function/);
    });

    it("listNotificationChannels reflects registered channels", () => {
      registerNotificationChannel({ name: "a", deliver: () => undefined });
      registerNotificationChannel({ name: "b", deliver: () => undefined });
      expect(listNotificationChannels().sort()).toEqual(["a", "b"]);
      unregisterNotificationChannel("a");
      expect(listNotificationChannels()).toEqual(["b"]);
    });
  });
});

describe("notifications routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "boni@local" });
    mockListNotifications.mockResolvedValue([]);
    mockCountUnread.mockResolvedValue(3);
  });

  it("handles HEAD like GET for read endpoints", async () => {
    const handler = createNotificationsHandler() as any;

    await expect(handler(createEvent("/count", "HEAD"))).resolves.toEqual({
      count: 3,
    });

    expect(mockCountUnread).toHaveBeenCalledWith("boni@local");
  });

  it("clamps invalid list limits before reaching the store", async () => {
    const handler = createNotificationsHandler() as any;

    await handler(createEvent("/?limit=-1&unread=true"));

    expect(mockListNotifications).toHaveBeenCalledWith("boni@local", {
      unreadOnly: true,
      limit: 50,
      before: undefined,
    });
  });

  it("short-circuits OPTIONS before auth", async () => {
    const handler = createNotificationsHandler() as any;
    mockGetSession.mockRejectedValue(new Error("should not authenticate"));

    const event = createEvent("/", "OPTIONS");
    await expect(handler(event)).resolves.toBe("");

    expect(event._status).toBe(204);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockListNotifications).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    const handler = createNotificationsHandler() as any;
    mockGetSession.mockResolvedValue(null);

    await expect(handler(createEvent("/"))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("allows only list in Plan mode", () => {
    const tool = createNotificationToolEntries(() => "boni@local")[
      "manage-notifications"
    ];
    const effect = tool.planMode?.effect;
    expect(typeof effect).toBe("function");
    if (typeof effect !== "function") throw new Error("Missing classifier");

    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "send" })).toBe("write");
    expect(tool.planMode?.allowedValues).toEqual({ action: ["list"] });
  });
});

describe("notification action entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListNotifications.mockResolvedValue([]);
    mockCountUnread.mockResolvedValue(0);
  });

  it("clamps invalid list limits before reaching the store", async () => {
    const tool = createNotificationToolEntries(() => "boni@local")[
      "manage-notifications"
    ];

    await tool.run({ action: "list", limit: -1 });

    expect(mockListNotifications).toHaveBeenCalledWith("boni@local", {
      unreadOnly: false,
      limit: 20,
    });
  });
});

type NotificationChannel = {
  name: string;
  deliver: (...args: unknown[]) => unknown;
};
