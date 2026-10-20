import { afterEach, describe, expect, it } from "vitest";

import { shortcutLabel } from "./utils";

const originalUserAgent = navigator.userAgent;

function setUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

afterEach(() => setUserAgent(originalUserAgent));

describe("shortcutLabel", () => {
  it("uses space-separated human-readable names on Apple platforms", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)");

    expect(shortcutLabel("cmd+shift+space")).toBe("Cmd Shift Space");
  });

  it("uses space-separated human-readable names elsewhere", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");

    expect(shortcutLabel("cmd+shift+space")).toBe("Ctrl Shift Space");
  });
});
