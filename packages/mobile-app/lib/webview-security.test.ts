// @ts-expect-error Vitest is provided by the repository test workspace.
import { describe, expect, it } from "vitest";

import { isTrustedWebViewUrl, parseTrustedOrigin } from "./webview-security";

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
});
