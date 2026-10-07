import { fileURLToPath } from "node:url";

import {
  conformanceMcpConfig,
  listMcpCatalogTools,
  loadTemplateMcpActions,
  providerSchemaViolations,
  type McpCatalogMode,
} from "@agent-native/core/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE } from "./lib/chatgpt-directory-tools.js";

const MODES: McpCatalogMode[] = [
  "default",
  "full",
  "app",
  "oauth-read",
  "directory",
];

describe("Slides MCP catalogs", () => {
  let config: ReturnType<typeof conformanceMcpConfig>;

  beforeAll(async () => {
    const actions = await loadTemplateMcpActions(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    config = conformanceMcpConfig("slides", actions);
  }, 180_000);

  it.each(MODES)(
    "advertises only schemas every provider accepts in the %s catalog",
    async (mode) => {
      const tools = await listMcpCatalogTools(
        config,
        mode,
        CHATGPT_DIRECTORY_PROFILE,
      );
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.flatMap((tool) => providerSchemaViolations(tool))).toEqual(
        [],
      );
    },
    60_000,
  );
});
