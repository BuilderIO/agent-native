import { fileURLToPath } from "node:url";

import {
  conformanceMcpConfig,
  listMcpCatalogTools,
  loadTemplateMcpActions,
  providerSchemaViolations,
  type McpCatalogMode,
} from "@agent-native/core/testing";
import { beforeAll, describe, expect, it } from "vitest";

const MODES: McpCatalogMode[] = ["default", "full", "app", "oauth-read"];

describe("Dispatch MCP catalogs", () => {
  let config: ReturnType<typeof conformanceMcpConfig>;

  beforeAll(async () => {
    const actions = await loadTemplateMcpActions(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    config = conformanceMcpConfig("dispatch", actions);
  }, 180_000);

  it.each(MODES)(
    "advertises only schemas every provider accepts in the %s catalog",
    async (mode) => {
      const tools = await listMcpCatalogTools(config, mode);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.flatMap((tool) => providerSchemaViolations(tool))).toEqual(
        [],
      );
    },
    60_000,
  );
});
