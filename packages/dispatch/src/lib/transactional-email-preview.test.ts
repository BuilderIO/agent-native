import { describe, expect, it } from "vitest";

import { resolveEmailPreviewAssets } from "./transactional-email-preview";

describe("resolveEmailPreviewAssets", () => {
  it("uses the canonical logo for browser previews", () => {
    expect(
      resolveEmailPreviewAssets(
        '<img src="cid:agent-native-logo" alt="Agent-Native" />',
      ),
    ).toBe(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\">" +
        '<img src="/favicon.png" alt="Agent-Native" />',
    );
  });

  it("leaves an explicit brand logo URL as text but blocks it from loading via CSP", () => {
    const html = '<img src="https://example.com/logo.png" />';
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toContain(html);
    expect(resolved).toContain("Content-Security-Policy");
    expect(resolved).toContain("default-src 'none'");
  });

  it("inserts the CSP into an existing <head> instead of duplicating one", () => {
    const html = "<html><head><title>Hi</title></head><body>Hi</body></html>";
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(
      "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\"><title>Hi</title></head><body>Hi</body></html>",
    );
  });

  it("wraps a full document with no <head> in a new one", () => {
    const html = "<html><body>Hi</body></html>";
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(
      "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\"></head><body>Hi</body></html>",
    );
  });

  it("prepends the CSP to a fragment with no <html>/<head>", () => {
    const html = "<p>Hi</p>";
    const resolved = resolveEmailPreviewAssets(html);

    expect(resolved).toBe(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\"><p>Hi</p>",
    );
  });
});
