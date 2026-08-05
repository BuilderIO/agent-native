import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmailProvider: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getEmailProvider: mocks.getEmailProvider,
  resolveSecret: mocks.resolveSecret,
}));

import {
  fetchEmailActivity,
  fetchEmailEngagement,
} from "./email-provider-metrics.js";

describe("email provider metrics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.getEmailProvider.mockReset();
    mocks.resolveSecret.mockReset();
  });

  it("does not query SendGrid when Resend is the active transport", async () => {
    mocks.getEmailProvider.mockResolvedValue("resend");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEmailEngagement(["core.magic-link-sign-in"], 30);

    expect(result).toEqual({
      available: false,
      reason:
        "Email delivery uses Resend, so SendGrid metrics do not describe the active transport.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("always scopes SendGrid activity to the requested template category", async () => {
    mocks.getEmailProvider.mockResolvedValue("sendgrid");
    mocks.resolveSecret.mockResolvedValue("sendgrid-key");
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [] }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchEmailActivity({
      templateId: "core.magic-link-sign-in",
      limit: 25,
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v3/messages");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("query")).toBe(
      'category="core.magic-link-sign-in"',
    );
  });
});
