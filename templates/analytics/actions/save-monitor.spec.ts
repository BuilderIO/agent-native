import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMonitorLib = vi.fn(
  (input: { id?: string; name: string; url: string }) => ({
    id: input.id ?? "monitor-1",
    requestHeaders: {},
    requestBody: null,
    slackWebhookUrl: null,
    webhookUrl: null,
    ...input,
  }),
);

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "brent@builder.io",
  getRequestOrgId: () => "org-1",
  buildDeepLink: (input: { to: string }) =>
    `https://analytics.agent-native.test${input.to}`,
  getAppProductionUrl: () => "https://analytics.agent-native.test",
}));

vi.mock("../server/lib/uptime-monitors", () => ({
  saveMonitor: saveMonitorLib,
  hostFromUrl: (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  },
}));

const { default: saveMonitorAction } = await import("./save-monitor");

describe("save-monitor action name defaulting", () => {
  beforeEach(() => {
    saveMonitorLib.mockClear();
  });

  it("defaults the name to the URL host (without www) when omitted", async () => {
    await saveMonitorAction.run({
      url: "https://www.example.com/health",
    } as never);

    expect(saveMonitorLib).toHaveBeenCalledWith(
      expect.objectContaining({ name: "example.com" }),
      { email: "brent@builder.io", orgId: "org-1" },
    );
  });

  it("falls back to the host when the name is blank/whitespace", async () => {
    await saveMonitorAction.run({
      name: "   ",
      url: "https://api.acme.io/status",
    } as never);

    expect(saveMonitorLib).toHaveBeenCalledWith(
      expect.objectContaining({ name: "api.acme.io" }),
      expect.anything(),
    );
  });

  it("keeps an explicit name", async () => {
    await saveMonitorAction.run({
      name: "Marketing site",
      url: "https://example.com",
    } as never);

    expect(saveMonitorLib).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Marketing site" }),
      expect.anything(),
    );
  });

  it.each(["frontend", "mcp"] as const)(
    "tells the save which caller it is serving (%s)",
    async (caller) => {
      await saveMonitorAction.run(
        { url: "https://example.com" } as never,
        { caller } as never,
      );

      expect(saveMonitorLib).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ caller }),
      );
    },
  );

  it("returns a focused link for the saved monitor", () => {
    expect(
      saveMonitorAction.link?.({
        args: { url: "https://clips.agent-native.com" },
        result: {
          id: "monitor/clips",
          monitorAppUrl:
            "https://analytics.agent-native.test/monitoring?view=uptime&monitor=monitor%2Fclips",
        },
      }),
    ).toEqual({
      url: "https://analytics.agent-native.test/monitoring?view=uptime&monitor=monitor%2Fclips",
      label: "Open monitor in Analytics",
      view: "monitoring",
    });
  });

  it("returns the exact monitor link in the action result", async () => {
    const result = await saveMonitorAction.run({
      url: "https://clips.agent-native.com",
    } as never);

    expect(result).toMatchObject({
      id: "monitor-1",
      monitorAppUrl:
        "https://analytics.agent-native.test/monitoring?view=uptime&monitor=monitor-1",
    });
  });
});

describe("save-monitor result", () => {
  const saved = {
    id: "monitor-1",
    name: "Prod",
    url: "https://api.example.com/h?api_key=key-fixture",
    requestHeaders: { Authorization: "Bearer bearer-fixture" },
    requestBody: "body-fixture",
    slackWebhookUrl: "https://hooks.example.test/services/slack-fixture",
    webhookUrl: null,
  };

  it("gives the agent no stored header values, body or webhook URL", async () => {
    saveMonitorLib.mockReturnValueOnce(saved as never);
    const result = await saveMonitorAction.run(
      { url: saved.url } as never,
      { caller: "tool" } as never,
    );

    const text = JSON.stringify(result);
    for (const secret of [
      "key-fixture",
      "bearer-fixture",
      "body-fixture",
      "slack-fixture",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(result).toMatchObject({ id: "monitor-1", hasAuthHeader: true });
  });

  it("keeps the stored values for the app UI", async () => {
    saveMonitorLib.mockReturnValueOnce(saved as never);
    const result = await saveMonitorAction.run(
      { url: saved.url } as never,
      { caller: "frontend" } as never,
    );

    expect(result).toMatchObject({
      requestHeaders: saved.requestHeaders,
      requestBody: "body-fixture",
    });
  });
});
