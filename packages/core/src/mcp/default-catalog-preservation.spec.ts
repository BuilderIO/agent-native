import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  listAdvertised,
  loadAppCatalogs,
  type AppCatalog,
} from "./advertised-catalog.harness.js";
import type { MCPConfig } from "./build-server.js";

// Cards an app declares that no chat host can open today. Outside a directory
// listing a card without a widget target opens the full app, so only cards kept
// off the production MCP catalog for other reasons remain; each says why.
const CARDS_WITHOUT_A_TARGET: Record<string, { why: string; tools: string[] }> =
  {
    design: {
      why: "The action sets mcpTool: false.",
      tools: ["show-design-questions"],
    },
  };
// Declares a card in every app, but no connector advertises it (#8070).
const NEVER_ADVERTISED_CARD = "context-manifest-get";

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

  it(
    "can offer every card an app declares, or lists why it can't",
    async () => {
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
      try {
        const missing: Record<string, string[]> = {};
        for (const app of apps) {
          const config = app.surfaces[0]!.config;
          const { tools } = await listAdvertised(config, {
            fullCatalog: true,
            fullSurface: false,
            inlineMcpApps: true,
          });
          const offered = new Set(
            tools
              .filter(
                (tool) =>
                  typeof (tool._meta?.ui as { resourceUri?: unknown })
                    ?.resourceUri === "string",
              )
              .map((tool) => tool.name),
          );
          const dark = Object.entries(
            config.productionActions ?? config.actions,
          )
            .filter(
              ([name, entry]) =>
                app.templateActionNames.has(name) &&
                name !== NEVER_ADVERTISED_CARD &&
                entry.mcpApp?.resource?.requiresEmbedSession === true &&
                !offered.has(name),
            )
            .map(([name]) => name)
            .sort();
          if (dark.length > 0) missing[app.appId] = dark;
        }
        expect(missing).toEqual(
          Object.fromEntries(
            Object.entries(CARDS_WITHOUT_A_TARGET).map(([appId, { tools }]) => [
              appId,
              [...tools].sort(),
            ]),
          ),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
    LOAD_TIMEOUT_MS,
  );

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
    "keeps Brain's existing default catalog when its policy is explicit",
    async () => {
      const brain = apps.find((app) => app.appId === "brain");
      const surface = brain?.surfaces[0];
      if (!surface) throw new Error("Brain catalog surface is missing");
      const config = surface.config;
      const { connectorCatalog: _catalog, ...implicit } = config;
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
      try {
        const options = { fullCatalog: false, fullSurface: false };
        const before = await listAdvertised(implicit, options);
        const after = await listAdvertised(config, options);
        expect(after.tools.map((tool) => tool.name).sort()).toEqual(
          before.tools.map((tool) => tool.name).sort(),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
    LOAD_TIMEOUT_MS,
  );

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
