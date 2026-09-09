import { describe, expect, it } from "vitest";

import { resolveEmailPreviewAssets } from "./transactional-email-preview";

const CSP_HEAD =
  "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\"></head>";

describe("resolveEmailPreviewAssets", () => {
  it("uses the canonical logo for browser previews", () => {
    expect(
      resolveEmailPreviewAssets(
        '<img src="cid:agent-native-logo" alt="Agent-Native" />',
      ),
    ).toBe(`${CSP_HEAD}<img src="/favicon.png" alt="Agent-Native" />`);
  });

  it("leaves an explicit brand logo URL as text but blocks it from loading via CSP", () => {
    const html = '<img src="https://example.com/logo.png" />';
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(`${CSP_HEAD}${html}`);
  });

  it("prepends the CSP before an existing <head>/<html> instead of merging into it", () => {
    const html = "<html><head><title>Hi</title></head><body>Hi</body></html>";
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(`${CSP_HEAD}${html}`);
  });

  it("prepends the CSP to a fragment with no <html>/<head>", () => {
    const html = "<p>Hi</p>";
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(`${CSP_HEAD}${html}`);
  });

  it("stays first even when a resource tag appears before a stray <head>", () => {
    // The reported bypass: a regex that looks for the first `<head>` would
    // insert after this `<img>`, letting it tokenize (and start loading)
    // first. Prepending unconditionally means our meta is always first.
    const html = '<img src="https://tracker.example/pixel"><head></head>';
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved.startsWith(CSP_HEAD)).toBe(true);
    expect(resolved.indexOf("Content-Security-Policy")).toBeLessThan(
      resolved.indexOf("tracker.example"),
    );
  });
});
