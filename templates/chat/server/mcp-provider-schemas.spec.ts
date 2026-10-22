import { fileURLToPath } from "node:url";

import {
  loadTemplateMcpConformance,
  providerSchemaViolations,
  templateMcpCatalogModes,
  type TemplateMcpConformance,
} from "@agent-native/core/testing";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Chat MCP catalogs", () => {
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
});
