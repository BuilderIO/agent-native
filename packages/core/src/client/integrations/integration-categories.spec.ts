import { describe, expect, it } from "vitest";

import {
  DEFAULT_MCP_INTEGRATIONS,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import {
  groupIntegrationsByCategory,
  integrationCategory,
  matchesIntegrationQuery,
} from "./integration-categories.js";

function integration(id: string, name = id): DefaultMcpIntegration {
  return {
    ...DEFAULT_MCP_INTEGRATIONS[0]!,
    id,
    name,
    keywords: [],
  };
}

describe("integration categories", () => {
  it("puts every built-in catalog tool in a named category", () => {
    const uncategorized = DEFAULT_MCP_INTEGRATIONS.filter(
      (entry) =>
        entry.id !== "builder-cms" && integrationCategory(entry.id) === "other",
    ).map((entry) => entry.id);
    expect(uncategorized).toEqual([]);
  });

  it("keeps a template's own preset on the page under Other", () => {
    expect(integrationCategory("acme-internal")).toBe("other");
  });

  it("orders groups by the page's category order and keeps catalog order", () => {
    const groups = groupIntegrationsByCategory([
      integration("stripe"),
      integration("acme-internal"),
      integration("gitlab"),
      integration("github"),
      integration("figma"),
    ]);
    expect(
      groups.map(({ category, integrations }) => [
        category,
        integrations.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["engineering", ["gitlab", "github"]],
      ["design", ["figma"]],
      ["finance", ["stripe"]],
      ["other", ["acme-internal"]],
    ]);
  });

  it("matches a query against names, keywords, and aliases", () => {
    const linear = DEFAULT_MCP_INTEGRATIONS.find(
      (entry) => entry.id === "linear",
    )!;
    expect(matchesIntegrationQuery(linear, "")).toBe(true);
    expect(matchesIntegrationQuery(linear, "linear")).toBe(true);
    expect(matchesIntegrationQuery(linear, "zzz-no-match")).toBe(false);
  });
});
