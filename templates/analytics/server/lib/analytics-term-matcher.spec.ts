import { describe, expect, it } from "vitest";

import {
  dataDictionaryTrustRank,
  decodeSearchCursor,
  matchSearchFields,
  paginateSearchResults,
  semanticScopeCompatibility,
  semanticScopeForSearch,
  stripNonPositiveInstructions,
  unrelatedNameTerms,
} from "./analytics-term-matcher";

describe("Analytics term matching", () => {
  it("keeps approved and dbt definitions ahead of generated Sigma examples", () => {
    expect(
      dataDictionaryTrustRank({ approved: true, sourceKind: "sigma" }),
    ).toBeGreaterThan(
      dataDictionaryTrustRank({ sourceKind: "dbt", aiGenerated: true }),
    );
    expect(
      dataDictionaryTrustRank({ sourceKind: "dbt", aiGenerated: true }),
    ).toBeGreaterThan(
      dataDictionaryTrustRank({ sourceKind: "sigma", aiGenerated: true }),
    );
  });

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
    expect(exact.exactMatchedTerms).toEqual([]);
  });

  it("reports literal query coverage separately from synonym recall", () => {
    const match = matchSearchFields("Builder.io users organization", [
      {
        value: "Builder.io Connect Funnel; distinct users; org_id",
        weight: 24,
      },
    ]);

    expect(match.matchedTerms).toEqual(
      expect.arrayContaining(["builder", "io", "user", "organization"]),
    );
    expect(match.exactMatchedTerms).toEqual(
      expect.arrayContaining(["builder", "io", "user"]),
    );
    expect(match.exactMatchedTerms).not.toContain("organization");
  });

  it("treats synonymous labels as relevant but counts unrelated name terms", () => {
    expect(unrelatedNameTerms("error rate", "5xx Error Rate")).toEqual([]);
    expect(
      unrelatedNameTerms(
        "Builder.io users organization",
        "Builder.io Connect Funnel",
      ),
    ).toEqual(["connect", "funnel"]);
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
    expect(semanticScopeForSearch("active product users")).toBe(
      "product_activity",
    );
    expect(semanticScopeForSearch("active members")).toBe("membership");
    expect(semanticScopeForSearch("active Builder users")).toBe(
      "product_activity",
    );
    expect(semanticScopeForSearch("active Builder product users")).toBe(
      "product_activity",
    );
    expect(semanticScopeForSearch("Builder users in organizations")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("active workspace members")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("active workspace users")).toBe("membership");
    expect(semanticScopeForSearch("active organizations")).toBe("organization");
    expect(semanticScopeForSearch("active users")).toBe("product_activity");
    expect(semanticScopeForSearch("workspace member roles")).toBe(
      "membership_roster",
    );
    expect(
      semanticScopeForSearch("list active workspace members with roles"),
    ).toBe("membership_roster");
    expect(
      semanticScopeForSearch("show active workspace users and their roles"),
    ).toBe("membership_roster");
    expect(semanticScopeForSearch("monthly user count by organization")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("workspace users breakdown by role")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("monthly workspace users by role")).toBe(
      "membership",
    );
    expect(semanticScopeForSearch("workspace users split by role")).toBe(
      "membership",
    );
    expect(
      semanticScopeForSearch(
        "which organization had the highest monthly user count",
      ),
    ).toBe("membership");
    expect(
      semanticScopeForSearch("which users in organizations triggered events"),
    ).toBe("product_activity");
    expect(
      semanticScopeForSearch("which active workspace members triggered events"),
    ).toBe("product_activity");
    expect(
      semanticScopeForSearch("Builder.io product monthly active user count"),
    ).toBe("product_activity");
    expect(semanticScopeForSearch("monthly active users by region")).toBe(
      "product_activity",
    );
    expect(semanticScopeForSearch("who has access to the workspace")).toBe(
      "membership_roster",
    );
    expect(
      semanticScopeForSearch(
        "Find the current user roster by organization with roles. Metadata only; do not report live counts or values.",
      ),
    ).toBe("membership_roster");
    expect(
      stripNonPositiveInstructions(
        "workspace users, but don't report live counts",
      ),
    ).toBe("workspace users");
    expect(
      stripNonPositiveInstructions(
        "workspace users, don't report live counts but show the monthly trend",
      ),
    ).toBe("workspace users but show the monthly trend");
    expect(
      stripNonPositiveInstructions(
        "workspace users, do not report live counts by role",
      ),
    ).toBe("workspace users by role");
    const positiveContinuation =
      "by role and permission tier across region and department and product area and subscription plan and final request category";
    expect(
      stripNonPositiveInstructions(
        `workspace users with no counts ${positiveContinuation}`,
      ),
    ).toBe(`workspace users ${positiveContinuation}`);
    expect(
      semanticScopeForSearch(
        "workspace users, don't report live counts but show the monthly trend",
      ),
    ).toBe("membership");
    expect(
      stripNonPositiveInstructions("workspace users, no live counts"),
    ).toBe("workspace users");
    expect(
      stripNonPositiveInstructions("workspace users with no live counts"),
    ).toBe("workspace users");
    expect(
      stripNonPositiveInstructions("workspace users with no counts by role"),
    ).toBe("workspace users by role");
    expect(stripNonPositiveInstructions("Trino results")).toBe("Trino results");
    expect(
      stripNonPositiveInstructions(
        "workspace users, no live counts but show the monthly trend",
      ),
    ).toBe("workspace users but show the monthly trend");
    expect(
      stripNonPositiveInstructions("workspace users without a count"),
    ).toBe("workspace users");
    expect(
      stripNonPositiveInstructions(
        "workspace users, no live counts and their roles",
      ),
    ).toBe("workspace users and their roles");
    expect(
      stripNonPositiveInstructions(
        "workspace users without a count and their roles",
      ),
    ).toBe("workspace users and their roles");
    expect(
      stripNonPositiveInstructions(
        "workspace users without a count and show the monthly trend",
      ),
    ).toBe("workspace users and show the monthly trend");
    expect(
      semanticScopeForSearch("how many members have access per workspace"),
    ).toBe("membership");
    expect(semanticScopeForSearch("Agent-Native Analytics users")).toBe(
      "analytics_user",
    );
    expect(semanticScopeCompatibility("analytics_user", "product_user")).toBe(
      0,
    );
    expect(semanticScopeCompatibility("membership", "person")).toBe(2);
    expect(semanticScopeCompatibility("membership", "membership_roster")).toBe(
      0,
    );
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
