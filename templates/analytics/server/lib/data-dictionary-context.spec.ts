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

  it("caps injected entries and points the agent to focused dictionary lookup", () => {
    const entries = Array.from({ length: 45 }, (_, index) => ({
      metric: `Metric ${String(index + 1).padStart(2, "0")}`,
      definition: `Definition ${index + 1}`,
      approved: true,
    }));

    const context = renderDataDictionary(entries);

    expect(context).toContain("Metric 40** (approved/canonical)");
    expect(context).not.toContain("Metric 41** (approved/canonical)");
    expect(context).toContain(
      "5 additional data-dictionary entries were omitted",
    );
    expect(context).toContain("list-data-dictionary");
    expect(context).toContain("search");
  });

  it("caps the total rendered block at a total char budget even under the 40-entry count cap", () => {
    // Every field maxed out renders roughly ~3-3.5K chars per entry (see the
    // per-field caps in renderEntry), so well under 40 entries is enough to
    // blow past a 10K total budget if there were no total-char guard.
    const longField = (label: string) => `${label} `.repeat(80);
    const entries = Array.from({ length: 40 }, (_, index) => ({
      metric: `Metric ${String(index + 1).padStart(2, "0")}`,
      definition: longField("definition"),
      table: longField("table"),
      columnsUsed: longField("columns"),
      cuts: longField("cuts"),
      queryTemplate: longField("query"),
      joinPattern: longField("joins"),
      updateFrequency: "hourly",
      dataLag: "15 minutes",
      dependencies: longField("deps"),
      validDateRange: longField("range"),
      owner: longField("owner"),
      commonQuestions: longField("questions"),
      knownGotchas: longField("gotchas"),
      approved: true,
    }));

    const context = renderDataDictionary(entries);

    // The rendered block should stay close to the ~10K budget, not balloon to
    // the ~130K theoretical ceiling from 40 maxed-out entries.
    expect(context.length).toBeLessThan(15_000);
    // At least one entry must always render, even under a tight budget.
    expect(context).toContain("Metric 01** (approved/canonical)");
    // Some later entry must have been omitted for the budget to have engaged.
    expect(context).toContain(
      "additional data-dictionary entries were omitted",
    );
    expect(context).toContain("list-data-dictionary");
    // No entry should be cut mid-render: every entry that appears must show
    // its full definition line intact (not truncated partway through a field).
    const definitionLines = context
      .split("\n")
      .filter((line) => line.startsWith("- **Metric"));
    for (const line of definitionLines) {
      expect(line).toContain("(approved/canonical) - definition ");
    }
  });
});
