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

  it("renders generated source kind, model type, status, and grain", () => {
    const context = renderDataDictionary([
      {
        metric: "model:user_organization_role",
        definition: "One row per user-organization membership.",
        source: "dbt",
        sourceKind: "dbt",
        entryType: "model",
        status: "active",
        grain: "Unique key: user_id, organization_id",
        primaryEntity: "user",
        timeDimension: "created_at",
        semanticModel: "users",
        approved: false,
        aiGenerated: true,
      },
    ]);

    expect(context).toContain("source kind: dbt");
    expect(context).toContain("entry type: model");
    expect(context).toContain("source status: active");
    expect(context).toContain("grain: Unique key: user_id, organization_id");
    expect(context).toContain("primary entity: user");
    expect(context).toContain("time dimension: created_at");
    expect(context).toContain("semantic model: users");
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
    expect(context).toContain("find-data");
    expect(context).toContain("search-bigquery-schema");
  });

  it("labels inferred SQL output columns as unverified and grain keys as inferred", () => {
    const context = renderDataDictionary([
      {
        metric: "model:user_organization_role",
        definition: "Generated dbt source metadata.",
        sqlProjectedColumns: "user_id, organization_id, role",
        inferredMembershipKeys: ["user_id", "organization_id"],
        inferredMembershipKeyRoles: {
          user: "user_id",
          organization: "organization_id",
        },
        approved: false,
        aiGenerated: true,
      },
    ]);

    expect(context).toContain(
      "SQL projected columns (inferred; verify against schema): user_id, organization_id, role",
    );
    expect(context).toContain(
      "membership row keys inferred from structural dbt SQL analysis: user_id, organization_id",
    );
    expect(context).toContain(
      "inferred membership key roles: user key user_id; organization key organization_id",
    );
  });

  it("caps the total rendered block at a total char budget even under the 40-entry count cap", () => {
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

    expect(context.length).toBeLessThan(15_000);
    expect(context).toContain("Metric 01** (approved/canonical)");
    expect(context).toContain(
      "additional data-dictionary entries were omitted",
    );
    expect(context).toContain("find-data");
    const definitionLines = context
      .split("\n")
      .filter((line) => line.startsWith("- **Metric"));
    for (const line of definitionLines) {
      expect(line).toContain("(approved/canonical) - definition ");
    }
  });
});
