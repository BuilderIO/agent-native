import { fileURLToPath } from "node:url";

import {
  AGENT_PATH_PROVIDERS,
  loadTemplateMcpConformance,
  providerSchemaViolations,
  templateMcpCatalogModes,
  type TemplateMcpConformance,
} from "@agent-native/core/testing";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Design MCP catalogs", () => {
  let template: TemplateMcpConformance;

  beforeAll(async () => {
    template = await loadTemplateMcpConformance(projectRoot);
  }, 180_000);

  it.each(templateMcpCatalogModes(projectRoot))(
    "advertises only schemas that pass every pinned provider rule in the %s catalog",
    async (mode) => {
      const tools = await template.listCatalog(mode);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.flatMap((tool) => providerSchemaViolations(tool))).toEqual(
        [],
      );
    },
    60_000,
  );

  it("offers the in-app agent only schemas its providers accept", () => {
    const tools = template.listAgentTools();
    expect(tools.length).toBeGreaterThan(0);
    const violations = tools
      .flatMap((tool) => providerSchemaViolations(tool))
      .filter((violation) =>
        (AGENT_PATH_PROVIDERS as readonly string[]).includes(
          violation.provider,
        ),
      );
    expect(violations).toEqual([]);
  });
});
