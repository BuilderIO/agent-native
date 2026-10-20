import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  listAdvertised,
  loadAppCatalogs,
  type AppCatalog,
} from "./advertised-catalog.harness.js";
import type { MCPConfig } from "./build-server.js";

const ORGANIZATION_TOOLS = [
  "invite-organization-member",
  "list-organization-members",
];

function organizationToolFlags(config: MCPConfig, enabled: boolean): MCPConfig {
  const update = (entries: MCPConfig["actions"]) => {
    const result = { ...entries };
    for (const name of ORGANIZATION_TOOLS) {
      const entry = entries[name];
      if (entry) result[name] = { ...entry, mcpTool: enabled };
    }
    return result;
  };
  return {
    ...config,
    actions: update(config.actions),
    ...(config.productionActions
      ? { productionActions: update(config.productionActions) }
      : {}),
  };
}

describe("default template catalogs when organization tools opt in", () => {
  let apps: AppCatalog[];

  beforeAll(async () => {
    apps = await loadAppCatalogs();
  }, LOAD_TIMEOUT_MS);

  it("makes every template's declaration-based curated policy explicit", () => {
    const implicit = apps.filter((app) => {
      const { config, entries } = app.surfaces[0]!;
      return (
        config.connectorCatalog === undefined &&
        [...app.templateActionNames].some(
          (name) => entries[name]?.mcpTool === true,
        )
      );
    });
    expect(implicit.map((app) => app.appId)).toEqual([]);
  });

  it(
    "keeps each default list exactly, adding only mounted organization tools",
    async () => {
      expect(apps.length).toBeGreaterThan(0);
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
      try {
        for (const app of apps) {
          const { config } = app.surfaces[0]!;
          const presentOrganizationTools = ORGANIZATION_TOOLS.filter(
            (name) => config.actions[name] !== undefined,
          );
          expect(
            [0, ORGANIZATION_TOOLS.length],
            `${app.appId}: mount must include both organization actions or neither`,
          ).toContain(presentOrganizationTools.length);
          const before = await listAdvertised(
            organizationToolFlags(config, false),
            {
              fullCatalog: false,
              fullSurface: false,
            },
          );
          const after = await listAdvertised(
            organizationToolFlags(config, true),
            {
              fullCatalog: false,
              fullSurface: false,
            },
          );
          // Compare against the same app with the flags off, not a frozen list:
          // any app may add or drop tools, and a snapshot breaks every PR.
          const baseline = before.tools.map((tool) => tool.name).sort();
          expect(baseline, app.appId).not.toEqual([]);
          expect(
            after.tools.map((tool) => tool.name).sort(),
            app.appId,
          ).toEqual([...baseline, ...presentOrganizationTools].sort());
        }
      } finally {
        vi.unstubAllEnvs();
      }
    },
    LOAD_TIMEOUT_MS,
  );
});
