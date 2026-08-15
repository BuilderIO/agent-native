import { describe, expect, it } from "vitest";

import {
  isBlockedWebViewHost,
  isTrustedWebViewUrl,
  parseTrustedOrigin,
  shouldOpenExternalWebViewUrl,
} from "./webview-security";

describe("WebView origin policy", () => {
  it("only trusts URLs on the configured app origin", () => {
    const origin = parseTrustedOrigin("https://clips.example.com/library");

    expect(
      isTrustedWebViewUrl("https://clips.example.com/settings", origin),
    ).toBe(true);
    expect(
      isTrustedWebViewUrl("https://attacker.example/session", origin),
    ).toBe(false);
    expect(isTrustedWebViewUrl("not a URL", origin)).toBe(false);
  });

  it("blocks Vector tracking hosts from opening outside the WebView", () => {
    expect(isBlockedWebViewHost("api.vector.co")).toBe(true);
    expect(shouldOpenExternalWebViewUrl("https://api.vector.co/pixel/123")).toBe(
      false,
    );
    expect(shouldOpenExternalWebViewUrl("https://vector.co")).toBe(false);
    expect(shouldOpenExternalWebViewUrl("https://vector.co.evil.example")).toBe(
      true,
    );
  });

  it("keeps ordinary external links available", () => {
    expect(
      shouldOpenExternalWebViewUrl("https://calendar.google.com/event/123"),
    ).toBe(true);
    expect(shouldOpenExternalWebViewUrl("mailto:hello@example.com")).toBe(
      false,
    );
  });
});
