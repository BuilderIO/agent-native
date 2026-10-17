// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

import { startCalendarOAuth } from "./calendar-oauth";

describe("startCalendarOAuth", () => {
  let popup: {
    closed: boolean;
    close: ReturnType<typeof vi.fn>;
    location: { href: string };
  };

  beforeEach(() => {
    popup = {
      closed: false,
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.callAction.mockReset();
  });

  it("opens the popup before the URL request and asks through the action helper", async () => {
    let resolveUrl!: (value: { url: string }) => void;
    mocks.callAction.mockReturnValue(
      new Promise((resolve) => {
        resolveUrl = resolve;
      }),
    );
    const pending = startCalendarOAuth("acct-1");
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "clips-calendar-oauth",
      "width=600,height=700",
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "connect-calendar",
      expect.objectContaining({
        provider: "google",
        calendarAccountId: "acct-1",
      }),
      { method: "GET" },
    );

    // The user closes the popup while the URL is still loading.
    popup.closed = true;
    resolveUrl({ url: "/_agent-native/google/auth-url?x=1" });
    await expect(pending).resolves.toBeNull();
    expect(popup.location.href).toBe("about:blank");
  });

  it("closes the popup when the URL request fails", async () => {
    mocks.callAction.mockRejectedValue(new Error("Not signed in"));
    await expect(startCalendarOAuth()).rejects.toThrow("Not signed in");
    expect(popup.close).toHaveBeenCalled();
  });
});
