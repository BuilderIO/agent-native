import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertNotification = vi.fn();
const mockEmit = vi.fn();

vi.mock("./store.js", () => ({
  insertNotification: (...args: unknown[]) => mockInsertNotification(...args),
}));

vi.mock("../event-bus/bus.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

import {
  notify,
  registerNotificationChannel,
  unregisterNotificationChannel,
  listNotificationChannels,
  __resetNotificationChannels,
} from "./registry.js";

describe("notifications registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationChannels();
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

// Re-import the type inline so the cast above compiles without circularity.
type NotificationChannel = {
  name: string;
  deliver: (...args: unknown[]) => unknown;
};
