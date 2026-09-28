import { describe, expect, it } from "vitest";

import { resolveFragmentRedirect } from "./docs-slug-redirects";

describe("resolveFragmentRedirect", () => {
  it("resolves a renamed same-page heading to its new hash", () => {
    expect(
      resolveFragmentRedirect(
        "template-clips-features",
        "#browser-logs-with-the-chrome-extension",
      ),
    ).toBe("#chrome-extension-browser-logs");
  });

  it("accepts a bare hash without the leading #", () => {
    expect(
      resolveFragmentRedirect(
        "template-clips-features",
        "browser-logs-with-the-chrome-extension",
      ),
    ).toBe("#chrome-extension-browser-logs");
  });

  it("resolves content that moved to a different page entirely", () => {
    expect(
      resolveFragmentRedirect("template-clips-features", "#crm-call-evidence"),
    ).toBe("/docs/template-clips-integrations#crm-call-evidence");
  });

  it("returns undefined for a real, still-valid fragment", () => {
    expect(
      resolveFragmentRedirect("template-clips-features", "#library"),
    ).toBeUndefined();
  });

  it("returns undefined for a slug with no known legacy fragments", () => {
    expect(
      resolveFragmentRedirect("template-forms-features", "#anything"),
    ).toBeUndefined();
  });

  it("returns undefined for an empty hash", () => {
    expect(
      resolveFragmentRedirect("template-clips-features", ""),
    ).toBeUndefined();
    expect(
      resolveFragmentRedirect("template-clips-features", "#"),
    ).toBeUndefined();
  });

  it("resolves a Slides gerund-to-imperative heading rename", () => {
    expect(
      resolveFragmentRedirect(
        "template-slides-features",
        "#generating-a-deck-from-a-prompt",
      ),
    ).toBe("#generate-a-deck-from-a-prompt");
  });

  it("leaves the removed Slides image-generation fragment unmapped", () => {
    expect(
      resolveFragmentRedirect(
        "template-slides-features",
        "#generating-and-finding-images",
      ),
    ).toBeUndefined();
  });

  it("resolves a Design fragment that moved to the Developer Guide", () => {
    expect(
      resolveFragmentRedirect("template-design-features", "#components"),
    ).toBe("/docs/template-design-developers#components");
  });

  it("resolves a Design fragment that stayed on Features under a new id", () => {
    expect(
      resolveFragmentRedirect(
        "template-design-features",
        "#importing-brand-from-somewhere-else",
      ),
    ).toBe("#new-design-system");
  });
});
