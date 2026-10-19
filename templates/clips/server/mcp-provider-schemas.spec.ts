import { fileURLToPath } from "node:url";

import {
  loadTemplateMcpConformance,
  providerSchemaViolations,
  templateMcpCatalogModes,
  type TemplateMcpConformance,
} from "@agent-native/core/testing";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Clips MCP catalogs", () => {
  let template: TemplateMcpConformance;

  beforeAll(async () => {
    template = await loadTemplateMcpConformance(projectRoot);
  }, 180_000);

  it("offers chapter editing, comment replies and video imports in the compact catalog", async () => {
    const names = (await template.listCatalog("default")).map(
      (tool) => tool.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "set-chapters",
        "reply-to-comment",
        "import-loom-recording",
      ]),
    );
  }, 60_000);

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
