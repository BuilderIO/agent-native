import { actionsToEngineTools } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import {
  filterAnalyticsEvalActions,
  resolveProductionEvalContext,
} from "./production-context.js";
import { METADATA_ONLY_ACTION_ALLOWLIST } from "./production-source-cases.eval.js";

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
        "query-dbt-semantic-metric",
        "bigquery",
        "search-bigquery-schema",
        "tool-search",
      ]),
    });
    expect(context.finalResponseGuard).toBeTypeOf("function");
    expect(context.systemPrompt).toContain("REAL DATA");
    expect(context.actions["find-data"]?.readOnly).toBe(true);
    expect(context.actions["query-dbt-semantic-metric"]?.readOnly).toBe(true);
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

  it("removes row queries before the model and tool-search see an eval action surface", async () => {
    const context = resolveProductionEvalContext({
      ownerEmail: "eval-owner@example.com",
      orgId: "org_example",
    });
    const actions = filterAnalyticsEvalActions(
      context.actions,
      METADATA_ONLY_ACTION_ALLOWLIST,
    );

    expect(Object.keys(actions).sort()).toEqual(
      [...METADATA_ONLY_ACTION_ALLOWLIST].sort(),
    );
    expect(
      actionsToEngineTools(actions)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...METADATA_ONLY_ACTION_ALLOWLIST].sort());

    const result = (await actions["tool-search"]!.run(
      { names: ["bigquery", "query-agent-native-analytics"] },
      { caller: "tool" } as never,
    )) as { results: Array<{ name: string }> };
    expect(result.results.map((tool) => tool.name)).not.toContain("bigquery");
    expect(result.results.map((tool) => tool.name)).not.toContain(
      "query-agent-native-analytics",
    );
  });

  it("rejects unknown allowlist entries before building an eval action surface", () => {
    const context = resolveProductionEvalContext({
      ownerEmail: "eval-owner@example.com",
      orgId: "org_example",
    });

    expect(() =>
      filterAnalyticsEvalActions(context.actions, ["query-not-in-registry"]),
    ).toThrow("unknown actions: query-not-in-registry");
  });
});
