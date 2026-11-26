import { describe, expect, it } from "vitest";

import { checkEmbedAudience, isWiderVisibility } from "./embed-audience.js";

describe("isWiderVisibility", () => {
  it("orders invited people, the organization and anyone with the link", () => {
    expect(isWiderVisibility("org", "private")).toBe(true);
    expect(isWiderVisibility("public", "org")).toBe(true);
    expect(isWiderVisibility("org", "org")).toBe(false);
    expect(isWiderVisibility("private", "public")).toBe(false);
  });
});

describe("checkEmbedAudience", () => {
  it("lets any copy into a page only invited people can open", () => {
    expect(
      checkEmbedAudience({
        action: "insert",
        page: "private",
        source: null,
        strict: true,
      }),
    ).toEqual({ verdict: "ok", reason: null });
  });

  it("lets a copy into a page no wider than its source", () => {
    expect(
      checkEmbedAudience({ action: "insert", page: "org", source: "org" }),
    ).toEqual({ verdict: "ok", reason: null });
    expect(
      checkEmbedAudience({
        action: "insert",
        page: "public",
        source: "public",
        strict: true,
      }),
    ).toEqual({ verdict: "ok", reason: null });
  });

  it("blocks adding a copy to a public page unless its source is public", () => {
    for (const source of ["private", "org", null] as const) {
      expect(
        checkEmbedAudience({ action: "insert", page: "public", source }),
      ).toEqual({ verdict: "block", reason: "public-page" });
    }
  });

  it("warns when a chart goes into an organization page from a private source", () => {
    expect(
      checkEmbedAudience({ action: "insert", page: "org", source: "private" }),
    ).toEqual({ verdict: "warn", reason: "wider" });
  });

  it("warns when the source app won't say who can open the source", () => {
    expect(
      checkEmbedAudience({ action: "insert", page: "org", source: null }),
    ).toEqual({ verdict: "warn", reason: "unknown-source" });
  });

  it("warns, rather than blocks, before a page with charts goes public", () => {
    expect(
      checkEmbedAudience({ action: "widen", page: "public", source: "org" }),
    ).toEqual({ verdict: "warn", reason: "wider" });
  });

  it("never lets a strict copy reach wider than its source", () => {
    expect(
      checkEmbedAudience({
        action: "insert",
        page: "org",
        source: "private",
        strict: true,
      }),
    ).toEqual({ verdict: "block", reason: "wider" });
    expect(
      checkEmbedAudience({
        action: "widen",
        page: "public",
        source: "org",
        strict: true,
      }),
    ).toEqual({ verdict: "block", reason: "wider" });
    expect(
      checkEmbedAudience({
        action: "widen",
        page: "org",
        source: null,
        strict: true,
      }),
    ).toEqual({ verdict: "block", reason: "unknown-source" });
  });
});
