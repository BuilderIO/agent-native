import { describe, expect, it } from "vitest";

import {
  extensionIdFromPathname,
  extensionNameToSlug,
  extensionPath,
  isExtensionPathname,
} from "./path.js";

describe("extension URL paths", () => {
  it("dasherizes extension names for display slugs", () => {
    expect(extensionNameToSlug("GitHub Stars Over Time")).toBe(
      "github-stars-over-time",
    );
    expect(extensionNameToSlug("  MRR / ARR: Q2!  ")).toBe("mrr-arr-q2");
  });

  it("caps slugs and trims trailing separators", () => {
    expect(extensionNameToSlug("One Two Three Four", 9)).toBe("one-two");
  });

  it("falls back when a name has no slug characters", () => {
    expect(extensionNameToSlug("!!!")).toBe("extension");
  });

  it("builds legacy id-only paths when no name is available", () => {
    expect(extensionPath("abc 123")).toBe("/extensions/abc%20123");
  });

  it("builds SEO-friendly paths when a name is available", () => {
    expect(extensionPath("abc-123", "GitHub Stars Over Time")).toBe(
      "/extensions/abc-123/github-stars-over-time",
    );
  });

  it("extracts ids from legacy and slugged paths", () => {
    expect(extensionIdFromPathname("/extensions/abc-123")).toBe("abc-123");
    expect(extensionIdFromPathname("/extensions/abc-123/github-stars")).toBe(
      "abc-123",
    );
    expect(
      isExtensionPathname("/extensions/abc-123/wrong-slug", "abc-123"),
    ).toBe(true);
  });
});
