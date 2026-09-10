import { describe, expect, it } from "vitest";

import { isTrustedBuilderPreviewUrl } from "./design-system-data";

describe("isTrustedBuilderPreviewUrl", () => {
  it("accepts an absolute https URL on builder.io", () => {
    expect(
      isTrustedBuilderPreviewUrl(
        "https://builder.io/app/design-system-intelligence/ds-1",
      ),
    ).toBe(true);
  });

  it("accepts a builder.io subdomain", () => {
    expect(
      isTrustedBuilderPreviewUrl("https://cdn.builder.io/design-system/ds-1"),
    ).toBe(true);
  });

  it("rejects a non-Builder origin", () => {
    expect(isTrustedBuilderPreviewUrl("https://evil.example.com")).toBe(false);
  });

  it("rejects a lookalike hostname", () => {
    expect(isTrustedBuilderPreviewUrl("https://notbuilder.io.evil.com")).toBe(
      false,
    );
  });

  it("rejects a non-https protocol", () => {
    expect(isTrustedBuilderPreviewUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects http (non-https)", () => {
    expect(isTrustedBuilderPreviewUrl("http://builder.io")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isTrustedBuilderPreviewUrl("not a url")).toBe(false);
  });
});
