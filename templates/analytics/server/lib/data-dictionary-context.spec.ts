import { describe, expect, it } from "vitest";

import { renderDataDictionary } from "./data-dictionary-context";

describe("renderDataDictionary", () => {
  it("keeps approved and human-unreviewed entries visible", () => {
    const context = renderDataDictionary([
      {
        metric: "ARR",
        definition: "Annual recurring revenue",
        table: "finance.arr",
        columnsUsed: "account_id, arr",
        approved: true,
      },
      {
        metric: "Activation",
        definition: "First meaningful product use",
        table: "product.activation",
        columnsUsed: "user_id, activated_at",
        approved: false,
        aiGenerated: false,
      },
    ]);

    expect(context).toContain("Approved canonical entries");
    expect(context).toContain("ARR** (approved/canonical)");
    expect(context).toContain("Unreviewed human-authored entries");
    expect(context).toContain("Activation** (unreviewed/human)");
  });

  it("does not inject AI suggestions as canonical when human context exists", () => {
    const context = renderDataDictionary([
      {
        metric: "ARR",
        definition: "Annual recurring revenue",
        approved: true,
      },
      {
        metric: "Guessed Metric",
        definition: "Maybe a thing",
        approved: false,
        aiGenerated: true,
      },
    ]);

    expect(context).toContain("1 AI-generated unapproved suggestion");
    expect(context).not.toContain("Guessed Metric** (ai-suggestion)");
  });

  it("injects AI suggestions with a warning when they are the only context", () => {
    const context = renderDataDictionary([
      {
        metric: "Guessed Metric",
        definition: "Maybe a thing",
        approved: false,
        aiGenerated: true,
      },
    ]);

    expect(context).toContain("AI-generated suggestions");
    expect(context).toContain("Guessed Metric** (ai-suggestion)");
    expect(context).toContain("verify table, columns, and meaning");
  });

  it("renders join, freshness, ownership, and caveat metadata", () => {
    const context = renderDataDictionary([
      {
        metric: "Expansion Pipeline",
        definition: "Open expansion opportunity amount",
        table: "hubspot.deals",
        columnsUsed: "deal_id, company_id, amount",
        cuts: "stage, owner",
        joinPattern:
          "Join HubSpot companies on company_id, then usage by domain",
        updateFrequency: "hourly",
        dataLag: "15 minutes",
        dependencies: "hubspot sync",
        validDateRange: "2024-01-01 onward",
        commonQuestions: "Which accounts are stuck in procurement?",
        knownGotchas: "Merged companies can duplicate deal rows.",
        owner: "Sales Ops",
        approved: true,
      },
    ]);

    expect(context).toContain(
      "joins: Join HubSpot companies on company_id, then usage by domain",
    );
    expect(context).toContain("freshness: hourly; 15 minutes");
    expect(context).toContain("owner: Sales Ops");
    expect(context).toContain(
      "gotchas: Merged companies can duplicate deal rows.",
    );
  });
});
