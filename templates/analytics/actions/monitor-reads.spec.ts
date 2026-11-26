import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = {
  id: "monitor-1",
  name: "Prod",
  url: "https://user:pass-fixture@api.example.com/h?api_key=key-fixture",
  requestHeaders: { Authorization: "Bearer bearer-fixture" },
  requestBody: "body-fixture",
  slackWebhookUrl: "https://hooks.example.test/services/slack-fixture",
  webhookUrl: "https://hooks.example.test/generic/webhook-fixture",
  uptime24h: 100,
  uptime7d: 100,
  checks24h: 12,
};

const listMonitors = vi.fn();
const getMonitor = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => "org-1",
}));

vi.mock("../server/lib/uptime-monitors", () => ({
  listMonitors: (...args: unknown[]) => listMonitors(...args),
  getMonitor: (...args: unknown[]) => getMonitor(...args),
}));

const { default: listMonitorsAction } = await import("./list-monitors");
const { default: getMonitorAction } = await import("./get-monitor");

const SECRETS = [
  "pass-fixture",
  "key-fixture",
  "bearer-fixture",
  "body-fixture",
  "slack-fixture",
  "webhook-fixture",
];

describe("monitor reads", () => {
  beforeEach(() => {
    listMonitors.mockReset().mockResolvedValue([stored]);
    getMonitor.mockReset().mockResolvedValue({
      monitor: stored,
      recentResults: [],
      incidents: [],
    });
  });

  it("list-monitors gives the agent no header values, body, webhook URLs or URL secrets", async () => {
    const result = await listMonitorsAction.run({}, {
      caller: "tool",
    } as never);

    for (const secret of SECRETS) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(result[0]).toMatchObject({
      id: "monitor-1",
      hasAuthHeader: true,
      uptime24h: 100,
    });
  });

  it("get-monitor gives the agent no header values, body, webhook URLs or URL secrets", async () => {
    const result = await getMonitorAction.run({ id: "monitor-1" }, {
      caller: "mcp",
    } as never);

    for (const secret of SECRETS) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(result).toMatchObject({
      monitor: { id: "monitor-1", hasAuthHeader: true },
      recentResults: [],
      incidents: [],
    });
  });

  it("keeps both reads whole for the app UI, whose edit form saves them back", async () => {
    const list = await listMonitorsAction.run({}, {
      caller: "frontend",
    } as never);
    const detail = await getMonitorAction.run({ id: "monitor-1" }, {
      caller: "frontend",
    } as never);

    expect(list[0]).toBe(stored);
    expect(detail.monitor).toBe(stored);
  });
});
