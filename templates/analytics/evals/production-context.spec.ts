import { describe, expect, it } from "vitest";

import { resolveProductionEvalContext } from "./production-context.js";

describe("Analytics production eval context", () => {
  it("uses the Analytics guard, explicit identity, and read-only query actions", () => {
    const context = resolveProductionEvalContext({
      ownerEmail: "eval-owner@example.com",
      orgId: "org_example",
    });

    expect(context).toMatchObject({
      ownerEmail: "eval-owner@example.com",
      orgId: "org_example",
      appId: "analytics",
      initialToolNames: expect.arrayContaining([
        "find-data",
        "bigquery",
        "search-bigquery-schema",
        "tool-search",
      ]),
    });
    expect(context.finalResponseGuard).toBeTypeOf("function");
    expect(context.systemPrompt).toContain("REAL DATA");
    expect(context.actions["find-data"]?.readOnly).toBe(true);
    expect(context.actions.bigquery?.readOnly).toBe(true);
    expect(context.actions["search-bigquery-schema"]?.readOnly).toBe(true);
    expect(
      Object.values(context.actions).every(
        (action) => action.readOnly === true,
      ),
    ).toBe(true);
  });

  it("rejects missing production identity before resolving actions", () => {
    expect(() =>
      resolveProductionEvalContext({ ownerEmail: " ", orgId: "org_example" }),
    ).toThrow("non-empty owner email and organization id");
  });

  it("exposes the shared production agent loop path", () => {
    const context = resolveProductionEvalContext({
      ownerEmail: "eval-owner@example.com",
      orgId: "org_example",
    });

    expect(context.productionChatPath?.run).toBeTypeOf("function");
  });
});
