import { describe, expect, it, vi } from "vitest";

import { openBoundOAuthWindow } from "./desktop-oauth-window";

describe("openBoundOAuthWindow", () => {
  it("opens the callback in the bound WebView window", () => {
    const oauthWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    const openWindow = vi.fn(() => oauthWindow);

    const result = openBoundOAuthWindow(openWindow);
    result.location.href = "https://accounts.google.com/o/oauth2/v2/auth";

    expect(openWindow).toHaveBeenCalledWith("about:blank", "_blank");
    expect(result).toBe(oauthWindow);
    expect(result.location.href).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });
});
