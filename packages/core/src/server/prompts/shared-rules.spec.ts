import { describe, expect, it } from "vitest";
import { sharedRule8 } from "./shared-rules.js";

describe("shared framework prompt rules", () => {
  it("teaches provider API fallback and corpus-first coverage generically", () => {
    const rule = sharedRule8({
      providerActions: ["github-search", "notion-search"],
    });

    expect(rule).toContain("provider-api-catalog");
    expect(rule).toContain("provider-api-docs");
    expect(rule).toContain("provider-api-request");
    expect(rule).toContain("first-class provider actions are shortcuts");
    expect(rule).toContain("broad searches");
    expect(rule).toContain("absence claims");
    expect(rule).toContain("query-staged-dataset");
    expect(rule).toContain("run-code");
    expect(rule).toContain("never infer");
    expect(rule).not.toContain("Gong");
    expect(rule).not.toContain("HubSpot");
  });

  it("avoids naming raw db tools when database tools are disabled", () => {
    const rule = sharedRule8(
      {
        providerActions: ["github-search", "notion-search"],
      },
      { databaseTools: false },
    );

    expect(rule).toContain("Raw database tools are not available");
    expect(rule).toContain("typed actions");
    expect(rule).not.toContain("db-query");
    expect(rule).not.toContain("db-exec");
    expect(rule).not.toContain("db-patch");
  });
});
