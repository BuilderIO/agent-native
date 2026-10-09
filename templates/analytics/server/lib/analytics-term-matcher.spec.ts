import { describe, expect, it } from "vitest";

import {
  decodeSearchCursor,
  matchSearchFields,
  paginateSearchResults,
  semanticScopeCompatibility,
  semanticScopeForSearch,
} from "./analytics-term-matcher";

describe("Analytics term matching", () => {
  it("weights exact entity terms and shared synonyms consistently", () => {
    const exact = matchSearchFields("workspace members", [
      { value: "organization_user_role", weight: 24 },
    ]);
    const unrelated = matchSearchFields("workspace members", [
      { value: "feature activation funnel", weight: 24 },
    ]);

    expect(exact.score).toBeGreaterThan(unrelated.score);
    expect(exact.matchedTerms).toEqual(
      expect.arrayContaining(["workspace", "member"]),
    );
  });

  it("normalizes the common phrase sign up to signup", () => {
    const match = matchSearchFields("sign up count", [
      { value: "Signup events", weight: 24 },
    ]);

    expect(match.score).toBeGreaterThan(0);
    expect(match.matchedTerms).toContain("signup");
  });

  it("distinguishes Builder product users from Analytics app users", () => {
    expect(semanticScopeForSearch("Builder.io users")).toBe("product_user");
    expect(semanticScopeForSearch("Builder users in organizations")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("workspace member roles")).toBe("membership");
    expect(semanticScopeForSearch("Agent-Native Analytics users")).toBe(
      "analytics_user",
    );
    expect(semanticScopeCompatibility("analytics_user", "product_user")).toBe(
      0,
    );
    expect(semanticScopeCompatibility("membership", "person")).toBe(2);
    expect(semanticScopeForSearch("product user dimension")).toBe(
      "product_user",
    );
    expect(semanticScopeForSearch("Analytics application users")).toBe(
      "analytics_user",
    );
  });

  it("binds page cursors to the query and reports the searched result window", () => {
    const firstPage = paginateSearchResults({
      search: "Builder.io users",
      results: ["users", "members", "organizations"],
      searched: 12,
      limit: 2,
      offset: 0,
    });

    expect(firstPage).toMatchObject({
      results: ["users", "members"],
      searched: 12,
      of: 3,
      truncated: true,
    });
    expect(firstPage.nextPage).not.toBeNull();
    expect(decodeSearchCursor("Builder.io users", firstPage.nextPage!)).toBe(2);
    expect(() =>
      decodeSearchCursor("Analytics users", firstPage.nextPage!),
    ).toThrow(/does not match this query/);
  });
});
