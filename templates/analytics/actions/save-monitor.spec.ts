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
});
