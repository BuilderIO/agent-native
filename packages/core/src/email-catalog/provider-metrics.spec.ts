import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmailProvider: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("../server/email.js", () => ({
  getEmailProvider: mocks.getEmailProvider,
}));
vi.mock("../server/credential-provider.js", () => ({
  resolveSecret: mocks.resolveSecret,
}));

import { getScopedEmailProviderCategory } from "./log.js";
import {
  fetchEmailActivity,
  fetchEmailEngagement,
} from "./provider-metrics.js";

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

    const result = await fetchEmailEngagement(
      ["core.reset-password"],
      30,
      "org-1",
    );

    expect(result).toEqual({
      available: false,
      reason:
        "Email delivery uses Resend, so SendGrid metrics do not describe the active transport.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses whole-window category sums without exposing unrelated categories", async () => {
    mocks.getEmailProvider.mockResolvedValue("sendgrid");
    mocks.resolveSecret.mockResolvedValue("sendgrid-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        stats: [
          {
            name: getScopedEmailProviderCategory(
              "calendar.booking-confirmed",
              "org-1",
            ),
            metrics: {
              delivered: 4,
              unique_opens: 3,
              unique_clicks: 2,
            },
          },
          {
            name: "unrelated.private-category",
            metrics: {
              delivered: 100,
              unique_opens: 99,
              unique_clicks: 50,
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEmailEngagement(
      ["calendar.booking-confirmed"],
      30,
      "org-1",
    );

    expect(result).toEqual({
      available: true,
      data: [
        {
          templateId: "calendar.booking-confirmed",
          delivered: 4,
          uniqueOpens: 3,
          uniqueClicks: 2,
          openRate: 0.75,
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v3/categories/stats/sums");
    expect(url.searchParams.get("aggregated_by")).toBeNull();
  });

  it("always scopes SendGrid activity to the requested template category", async () => {
    mocks.getEmailProvider.mockResolvedValue("sendgrid");
    mocks.resolveSecret.mockResolvedValue("sendgrid-key");
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [] }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchEmailActivity({
      templateId: "core.reset-password",
      limit: 25,
      orgId: "org-1",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v3/messages");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("query")).toBe(
      `category="${getScopedEmailProviderCategory("core.reset-password", "org-1")}"`,
    );
  });

  it("fails closed when provider metrics lack an organization", async () => {
    mocks.getEmailProvider.mockResolvedValue("sendgrid");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchEmailEngagement(["core.reset-password"], 30),
    ).resolves.toEqual({
      available: false,
      reason: "Organization context is required for provider email metrics.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
