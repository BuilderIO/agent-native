import { describe, expect, it } from "vitest";

import { isValidSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("Acme Status")).toBe("acme-status");
    expect(slugify("  My  Page  ")).toBe("my-page");
    expect(slugify("API & Web!")).toBe("api-web");
  });

  it("collapses and trims dashes", () => {
    expect(slugify("--a---b--")).toBe("a-b");
    expect(slugify("!!!")).toBe("");
  });

  it("caps at 64 chars without a trailing dash", () => {
    const long = slugify("a".repeat(70));
    expect(long.length).toBe(64);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("isValidSlug", () => {
  it("accepts clean slugs", () => {
    expect(isValidSlug("acme-status")).toBe(true);
    expect(isValidSlug("status")).toBe(true);
    expect(isValidSlug("a1-b2-c3")).toBe(true);
  });

  it("rejects empty, uppercase, spaces, and bad dashes", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Acme")).toBe(false);
    expect(isValidSlug("acme status")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("a".repeat(65))).toBe(false);
  });

  it("round-trips slugify output as valid (when non-empty)", () => {
    for (const input of ["Acme Status", "My Page", "API & Web"]) {
      const slug = slugify(input);
      expect(isValidSlug(slug)).toBe(true);
    }
  });
});
