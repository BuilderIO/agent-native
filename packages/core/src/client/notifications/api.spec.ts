import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countClientUnreadNotifications,
  dismissClientNotification,
  getPersonalNotificationRouting,
  listClientNotifications,
  markAllClientNotificationsRead,
  markClientNotificationRead,
  NotificationRoutingClientError,
  updatePersonalNotificationRouting,
} from "./api.js";

const routing = {
  inbox: true,
  browser: true,
  email: false,
  personalSlack: false,
  personalSlackWebhookKey: null,
};

describe("notification routing client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads routing through the mounted framework path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(routing), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/content/page/one" } });
    vi.stubEnv("VITE_APP_BASE_PATH", "/content");

    await expect(getPersonalNotificationRouting()).resolves.toEqual(routing);
    expect(fetch).toHaveBeenCalledWith(
      "/content/_agent-native/notifications/routing",
      { signal: undefined },
    );
  });

  it("writes only the routing profile supplied by the caller", async () => {
    const next = {
      ...routing,
      email: true,
      personalSlack: true,
      personalSlackWebhookKey: "PERSONAL_SLACK_WEBHOOK",
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(next), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/" } });

    await expect(updatePersonalNotificationRouting(next)).resolves.toEqual(
      next,
    );
    expect(fetch).toHaveBeenCalledWith("/_agent-native/notifications/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
      signal: undefined,
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("hooks.slack.com");
  });

  it("surfaces route validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Secret key required" }), {
          status: 400,
        }),
      ),
    );
    vi.stubGlobal("window", { location: { pathname: "/" } });

    await expect(updatePersonalNotificationRouting(routing)).rejects.toEqual(
      new NotificationRoutingClientError("Secret key required", 400),
    );
  });

  it("keeps inbox transport details behind named helpers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2 })))
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/" } });

    await listClientNotifications({ unreadOnly: true, limit: 20 });
    await expect(countClientUnreadNotifications()).resolves.toBe(2);
    await markClientNotificationRead("notification/one");
    await markAllClientNotificationsRead();
    await dismissClientNotification("notification/one");

    expect(fetch.mock.calls).toEqual([
      [
        "/_agent-native/notifications?unread=true&limit=20",
        { signal: undefined },
      ],
      ["/_agent-native/notifications/count", { signal: undefined }],
      [
        "/_agent-native/notifications/notification%2Fone/read",
        { method: "POST", keepalive: true, signal: undefined },
      ],
      [
        "/_agent-native/notifications/read-all",
        { method: "POST", signal: undefined },
      ],
      [
        "/_agent-native/notifications/notification%2Fone",
        { method: "DELETE", signal: undefined },
      ],
    ]);
  });
});
