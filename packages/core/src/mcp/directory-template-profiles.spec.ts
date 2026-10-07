import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE as contentProfile } from "../../../../templates/content/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as designProfile } from "../../../../templates/design/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as slidesProfile } from "../../../../templates/slides/server/lib/chatgpt-directory-tools.js";
import {
  filterFrameworkToolGroups,
  type FrameworkToolGroup,
} from "../framework-tools.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import {
  filterAgentTools,
  filterMcpOnlyActions,
} from "../server/agent-chat/action-filters-a2a.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import { validateMcpDirectoryProfile } from "./build-server.js";
import { mcpToolInputSchema } from "./tool-input-schema.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const ACTION_REGISTRY_TEST_TIMEOUT_MS = 60_000;

const templateProfiles = [
  { appId: "slides", profile: slidesProfile },
  { appId: "design", profile: designProfile },
  { appId: "content", profile: contentProfile },
] as const;

function externalMcpActions(
  actions: Parameters<typeof filterAgentTools>[0],
  disabledGroups: ReadonlySet<FrameworkToolGroup>,
) {
  return {
    ...filterFrameworkToolGroups(filterMcpOnlyActions(actions), disabledGroups),
    ...filterFrameworkToolGroups(filterAgentTools(actions), disabledGroups),
  };
}

async function loadTemplateActions(appId: string) {
  const projectRoot = path.join(repoRoot, "templates", appId);
  generateActionRegistryForProject(projectRoot);
  const registrySource = fs.readFileSync(
    path.join(projectRoot, ".generated/actions-registry.ts"),
    "utf8",
  );
  const profile = templateProfiles.find(
    (profile) => profile.appId === appId,
  )?.profile;
  if (!profile) throw new Error(`Unknown ChatGPT directory template ${appId}.`);
  const toolNames = profile.connectorCatalog;
  const loadNames = [
    ...new Set([
      ...toolNames,
      ...Object.keys(profile.widgetReadActionArguments ?? {}),
    ]),
  ];
  const actionNames = [
    ...registrySource.matchAll(/^\s*"([^"]+)":\s*a_[\w]+,?$/gm),
  ].map(([, name]) => name!);
  const modules = Object.fromEntries(
    await Promise.all(
      loadNames.map(async (name) => {
        const symbol = `a_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
        if (!registrySource.includes(`"${name}": ${symbol}`)) {
          throw new Error(`${appId} action registry is missing "${name}".`);
        }
        const actionUrl =
          pathToFileURL(path.join(projectRoot, "actions", `${name}.ts`)).href +
          `?cacheBust=${Date.now()}`;
        return [name, await import(actionUrl)];
      }),
    ),
  );
  const actions = loadActionsFromStaticRegistry(modules);
  const productionActions = externalMcpActions(actions, new Set());
  return { actions, productionActions, actionNames };
}

function schemaDescriptions(
  value: unknown,
  seen = new WeakSet<object>(),
): string[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => schemaDescriptions(item, seen));
  }
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.description === "string" ? [record.description] : []),
    ...Object.values(record).flatMap((item) => schemaDescriptions(item, seen)),
  ];
}

function mentionsTool(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (name.includes("-") || name.includes("_")) {
    return new RegExp(`(^|[^\\w-])${escaped}(?=$|[^\\w-])`).test(text);
  }
  return new RegExp(
    `(?:\\x60${escaped}\\x60|\\b(?:call|invoke|run|use)\\s+\\x60?${escaped}\\x60?\\b)`,
    "i",
  ).test(text);
}

describe("ChatGPT directory template profiles", () => {
  it.each(templateProfiles)(
    "$appId keeps the full widget enabled at its canonical domain",
    ({ appId, profile }) => {
      expect(profile.widgets).toBe(true);
      expect(profile.widgetDomain).toBe(`https://${appId}.agent-native.com`);
    },
  );

  it("keeps Design's bootstrap read out of model tool discovery", () => {
    expect(designProfile.connectorCatalog).not.toContain("get-design");
    expect(designProfile.widgetReadPublicActions).toEqual(["get-design"]);
    expect(designProfile.widgetReadActionArguments?.["get-design"]).toEqual({
      id: "designId",
    });
  });

  it.each(templateProfiles)(
    "$appId allowlist is registered, exposed, annotated, and narrowly scoped",
    async ({ appId, profile }) => {
      const { actions, productionActions, actionNames } =
        await loadTemplateActions(appId);

      expect(() =>
        validateMcpDirectoryProfile({
          name: `agent-native-${appId}`,
          appId,
          description: "ChatGPT directory profile validation",
          catalogMode: "directory",
          actions,
          productionActions,
          directoryProfile: profile,
        }),
      ).not.toThrow();

      const deniedTools = actionNames.filter(
        (name) => !profile.connectorCatalog.includes(name),
      );
      const visibleText = [profile.instructions ?? ""];
      for (const name of profile.connectorCatalog) {
        const action = actions[name]!;
        visibleText.push(
          profile.toolDescriptions?.[name] ?? action.tool.description ?? name,
        );
        const inputSchema = mcpToolInputSchema(name, action.tool.parameters);
        const properties = inputSchema.properties as
          | Record<string, Record<string, unknown>>
          | undefined;
        for (const parameter of profile.hiddenToolParameters?.[name] ?? []) {
          if (properties) delete properties[parameter];
        }
        for (const [parameter, description] of Object.entries(
          profile.toolParameterDescriptions?.[name] ?? {},
        )) {
          if (properties?.[parameter]) {
            properties[parameter].description = description;
          }
        }
        visibleText.push(...schemaDescriptions(inputSchema));
      }

      const leaks = deniedTools.filter((name) =>
        visibleText.some((text) => mentionsTool(text, name)),
      );
      expect(leaks).toEqual([]);

      const unlistedKeyTools = (profile.keyToolNames ?? []).filter(
        (name) => !profile.connectorCatalog.includes(name),
      );
      expect(
        unlistedKeyTools.filter((name) =>
          visibleText.some((text) => mentionsTool(text, name)),
        ),
      ).toEqual([]);
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it("validates names against the plugin's MCP action surface", () => {
    const annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    };
    const rawActions = {
      "agent-visible": {
        tool: { description: "An agent-visible action." },
        run: async () => ({ ok: true }),
        readOnly: true,
        mcpAnnotations: annotations,
      },
      "mcp-only": {
        tool: { description: "An MCP-only action." },
        run: async () => ({ ok: true }),
        readOnly: true,
        agentTool: false,
        mcpTool: true,
        mcpAnnotations: annotations,
      },
      "ui-only": {
        tool: { description: "An action reserved for the UI." },
        run: async () => ({ ok: true }),
        readOnly: true,
        uiOnly: true,
        mcpTool: true,
        mcpAnnotations: annotations,
      },
      "disabled-group": {
        tool: { description: "An action in a disabled framework group." },
        run: async () => ({ ok: true }),
        readOnly: true,
        frameworkGroup: "labs",
        mcpAnnotations: annotations,
      },
    };
    const productionActions = externalMcpActions(
      rawActions,
      new Set<FrameworkToolGroup>(["labs"]),
    );
    const config = {
      name: "agent-native-directory-test",
      description: "External MCP action surface validation.",
      catalogMode: "directory" as const,
      actions: rawActions,
      productionActions,
      directoryProfile: {
        connectorCatalog: ["agent-visible", "mcp-only"],
      },
    };

    expect(() => validateMcpDirectoryProfile(config)).not.toThrow();
    expect(Object.keys(productionActions)).toEqual([
      "mcp-only",
      "agent-visible",
    ]);
    expect(() =>
      validateMcpDirectoryProfile({
        ...config,
        directoryProfile: { connectorCatalog: ["ui-only"] },
      }),
    ).toThrow(/not registered or is not exposed to MCP/);
    expect(() =>
      validateMcpDirectoryProfile({
        ...config,
        directoryProfile: { connectorCatalog: ["disabled-group"] },
      }),
    ).toThrow(/not registered or is not exposed to MCP/);
  });

  it("requires scoped widget reads to be bounded GET actions", () => {
    const writeAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    };
    const readAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    };
    const config = {
      name: "agent-native-directory-test",
      description: "Widget read-route validation.",
      catalogMode: "directory" as const,
      actions: {
        "create-document": {
          tool: { description: "Create one document." },
          readOnly: false,
          mcpAnnotations: writeAnnotations,
          mcpApp: {
            resource: {
              uri: "ui://content/shell-v67",
              title: "Document",
              html: "<html></html>",
            },
          },
          run: async () => ({ id: "doc-1" }),
        },
        "get-document": {
          tool: { description: "Read one document." },
          readOnly: true,
          requiresAuth: true,
          http: { method: "GET" },
          mcpAnnotations: readAnnotations,
          run: async () => ({ id: "doc-1" }),
        },
      },
      directoryProfile: {
        connectorCatalog: ["create-document", "get-document"],
        widgetTargets: {
          "create-document": () => ({
            targetPath: "/page/doc-1",
            resourceIds: { documentId: "doc-1" },
          }),
        },
        widgetReadActionArguments: {
          "get-document": { id: "documentId" },
        },
      },
    };

    expect(() => validateMcpDirectoryProfile(config)).not.toThrow();
    expect(() =>
      validateMcpDirectoryProfile({
        ...config,
        actions: {
          ...config.actions,
          "get-document": {
            ...config.actions["get-document"],
            requiresAuth: false,
          },
        },
      }),
    ).toThrow(/explicitly scoped read-only GET action/);

    const boundedConfig = {
      ...config,
      directoryProfile: {
        ...config.directoryProfile,
        widgetReadActionArguments: {
          "get-document": {
            id: "documentId",
            limit: { type: "integerRange" as const, min: 0, max: 5_000 },
          },
        },
      },
    };
    expect(() => validateMcpDirectoryProfile(boundedConfig)).not.toThrow();
    expect(() =>
      validateMcpDirectoryProfile({
        ...boundedConfig,
        directoryProfile: {
          ...boundedConfig.directoryProfile,
          widgetReadActionArguments: {
            "get-document": {
              id: "documentId",
              limit: { type: "integerRange", min: 0, max: 5_001 },
            },
          },
        },
      }),
    ).toThrow(/valid resource arguments/);

    const publicReadAction = {
      tool: { description: "Read one public design." },
      readOnly: true,
      requiresAuth: false,
      http: { method: "GET" as const },
      mcpAnnotations: readAnnotations,
      run: async () => ({ id: "design-1" }),
    };
    const publicReadConfig = {
      ...config,
      actions: {
        ...config.actions,
        "get-design": publicReadAction,
      },
      directoryProfile: {
        ...config.directoryProfile,
        widgetReadActionArguments: {
          ...config.directoryProfile.widgetReadActionArguments,
          "get-design": { id: "designId" },
        },
        widgetReadPublicActions: ["get-design"],
      },
    };
    expect(() => validateMcpDirectoryProfile(publicReadConfig)).not.toThrow();
    expect(() =>
      validateMcpDirectoryProfile({
        ...publicReadConfig,
        directoryProfile: {
          ...publicReadConfig.directoryProfile,
          connectorCatalog: [
            ...publicReadConfig.directoryProfile.connectorCatalog,
            "get-design",
          ],
        },
      }),
    ).toThrow(/unlisted, explicitly scoped, public GET action/);
  });

  it("requires read routes before widget tools run and preserves legacy tool discovery", () => {
    const widgetAction = {
      tool: { description: "Create one document." },
      readOnly: false,
      mcpAnnotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      mcpApp: {
        resource: {
          uri: "ui://content/create-document",
          title: "Document",
          html: "<html></html>",
        },
      },
      run: async () => ({ id: "doc-1" }),
    };
    const readAction = {
      tool: { description: "Read one document." },
      readOnly: false,
      requiresAuth: true,
      http: { method: "GET" as const },
      mcpAnnotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      run: async () => ({ id: "doc-1" }),
    };
    const config = {
      name: "content",
      description: "Content directory.",
      catalogMode: "directory" as const,
      actions: { "create-document": widgetAction, "get-document": readAction },
      directoryProfile: {
        connectorCatalog: ["create-document", "get-document"],
        widgetTargets: {
          "create-document": () => ({
            targetPath: "/page/doc-1",
            resourceIds: { documentId: "doc-1" },
          }),
        },
        widgetReadActionArguments: {
          "get-document": { id: "documentId" },
        },
        widgetReadOnlyActions: ["get-document"],
      },
    };

    expect(() => validateMcpDirectoryProfile(config)).not.toThrow();
    expect(() =>
      validateMcpDirectoryProfile({
        ...config,
        directoryProfile: {
          ...config.directoryProfile,
          widgetReadOnlyActions: [],
        },
      }),
    ).toThrow(/explicitly scoped read-only GET action/);

    const legacyConfig = {
      name: "content",
      description: "Content directory.",
      catalogMode: "directory" as const,
      directoryProfile: { connectorCatalog: ["create-document"] },
      actions: { "create-document": widgetAction },
    };
    expect(() => validateMcpDirectoryProfile(legacyConfig)).not.toThrow();
  });
});
