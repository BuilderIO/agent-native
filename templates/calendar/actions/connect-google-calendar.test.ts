import { runWithRequestContext } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import action from "./connect-google-calendar";

describe("connect-google-calendar action", () => {
  it("returns a browser-openable Google Calendar connect URL for signed-in users", async () => {
    const result = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () => action.run({ returnPath: "/settings?tab=google" }),
    );

    expect(result).toMatchObject({
      provider: "google_calendar",
      label: "Connect Google Calendar",
      markdown: expect.stringContaining("[Connect Google Calendar]("),
      requiresUserGesture: true,
      message: expect.stringContaining("Open this link"),
    });

    const url = new URL(result.url, "https://calendar.agent-native.local");
    expect(url.pathname).toBe("/_agent-native/google/auth-url");
    expect(url.searchParams.get("calendar")).toBe("1");
    expect(url.searchParams.get("redirect")).toBe("1");
    expect(url.searchParams.get("return")).toBe("/settings?tab=google");
  });

  it("uses the add-account OAuth starter when requested", async () => {
    const result = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () => action.run({ addAccount: true }),
    );

    const url = new URL(result.url, "https://calendar.agent-native.local");
    expect(url.pathname).toBe("/_agent-native/google/add-account/auth-url");
    expect(url.searchParams.get("calendar")).toBeNull();
    expect(url.searchParams.get("redirect")).toBe("1");
  });

  it("rejects unauthenticated contexts before creating a connect link", async () => {
    await expect(
      runWithRequestContext({ userEmail: undefined }, () => action.run({})),
    ).rejects.toThrow("Sign in to Calendar before connecting Google Calendar.");
  });

  it("builds a deep link for tool hosts", async () => {
    const result = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () => action.run({}),
    );

    expect(action.link?.({ args: {}, result })).toEqual({
      url: result.url,
      label: "Connect Google Calendar",
      view: "settings",
    });
  });
});
