import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCaptureGrant: vi.fn(),
  resolvePageSession: vi.fn(),
  getTab: vi.fn(),
}));

vi.mock("./capture-grants", () => ({
  hasCaptureGrant: mocks.hasCaptureGrant,
}));

vi.mock("./page-session", () => ({
  resolvePageSession: mocks.resolvePageSession,
}));

import { attachCommand } from "./remote-relay";

describe("remote relay attach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePageSession.mockResolvedValue({
      tabId: 42,
      origin: "https://example.com",
    });
    mocks.getTab.mockResolvedValue({
      active: true,
      url: "https://example.com",
    });
    (globalThis as { chrome: unknown }).chrome = {
      tabs: { get: mocks.getTab },
    };
  });

  it("refuses to attach after the user revokes page access", async () => {
    mocks.hasCaptureGrant.mockResolvedValue(false);

    await expect(attachCommand("bsn_example")).rejects.toThrow(
      "Page access expired",
    );

    expect(mocks.hasCaptureGrant).toHaveBeenCalledWith(
      42,
      "https://example.com",
    );
  });

  it("attaches only to the active granted tab", async () => {
    mocks.hasCaptureGrant.mockResolvedValue(true);

    await expect(attachCommand("bsn_example")).resolves.toEqual({
      type: "attach",
      tabId: 42,
      allowedOrigins: ["https://example.com"],
    });
  });
});
