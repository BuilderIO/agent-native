import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertNotification = vi.fn();
const mockUpdateDeliveredChannels = vi.fn();
const mockListNotifications = vi.fn();
const mockCountUnread = vi.fn();
const mockMarkNotificationRead = vi.fn();
const mockMarkAllNotificationsRead = vi.fn();
const mockDeleteNotification = vi.fn();
const mockEmit = vi.fn();
const mockGetSession = vi.fn();

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
  listNotifications: (...args: unknown[]) => mockListNotifications(...args),
  countUnread: (...args: unknown[]) => mockCountUnread(...args),
  markNotificationRead: (...args: unknown[]) =>
    mockMarkNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) =>
    mockMarkAllNotificationsRead(...args),
  deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),
}));

vi.mock("../event-bus/bus.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

import {
  notify,
  registerNotificationChannel,
  unregisterNotificationChannel,
  listNotificationChannels,
  __resetNotificationChannels,
} from "./registry.js";
import { createNotificationToolEntries } from "./actions.js";
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
      expect(mockEmit).toHaveBeenCalledWith(
        "notification.sent",
        expect.objectContaining({
          notificationId: "n-1",
          severity: "info",
          deliveredChannels: ["inbox"],
        }),
        { owner: "boni@local" },
      );
    });

    it("requires meta.owner", async () => {
      await expect(
        notify({ severity: "info", title: "x" }, { owner: "" }),
      ).rejects.toThrow(/owner is required/);
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

      const eventCall = mockEmit.mock.calls.find(
        ([name]) => name === "notification.sent",
      );
      expect(eventCall).toBeDefined();
      const [, payload] = eventCall!;
      expect(payload.deliveredChannels).toEqual(
        expect.arrayContaining(["inbox", "pager"]),
      );
      expect(payload.deliveredChannels).not.toContain("slack");
      expect(mockUpdateDeliveredChannels).toHaveBeenCalledWith(
        "n-1",
        expect.arrayContaining(["inbox", "pager"]),
      );
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

// Re-import the type inline so the cast above compiles without circularity.
type NotificationChannel = {
  name: string;
  deliver: (...args: unknown[]) => unknown;
};
