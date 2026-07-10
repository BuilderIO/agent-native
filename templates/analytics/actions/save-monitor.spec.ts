import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMonitorLib = vi.fn(
  (input: { id?: string; name: string; url: string }) => ({
    id: input.id ?? "monitor-1",
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
