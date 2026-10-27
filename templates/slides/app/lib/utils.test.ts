// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { normalizeLinkHref, shortcutLabel } from "./utils";

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

describe("normalizeLinkHref", () => {
  it("prefixes bare hosts, including ones that start with http", () => {
    expect(normalizeLinkHref(" example.com ")).toBe("https://example.com");
    expect(normalizeLinkHref("httpbin.org")).toBe("https://httpbin.org");
    expect(normalizeLinkHref("localhost:3000")).toBe("https://localhost:3000");
  });

  it("keeps explicit schemes and intentional relative links", () => {
    for (const href of [
      "HTTPS://example.com",
      "http://example.com",
      "mailto:a@example.com",
      "tel:5551234",
      "#section",
      "/docs",
      "./docs",
    ]) {
      expect(normalizeLinkHref(href)).toBe(href);
    }
  });

  it("returns null for blank input", () => {
    expect(normalizeLinkHref("  ")).toBeNull();
  });
});
