// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { shortcutLabel } from "./utils";

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  });
});

describe("shortcutLabel", () => {
  it("keeps Mac shortcut symbols compact", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    const label = shortcutLabel("cmd+alt+c");

    expect(label).toBe("⌘⌥C");
  });

  it("keeps word modifiers readable on non-Mac platforms", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    expect(shortcutLabel("cmd+alt+c")).toBe("Ctrl Alt C");
  });
});
