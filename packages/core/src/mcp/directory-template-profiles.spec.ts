import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE as contentProfile } from "../../../../templates/content/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as designProfile } from "../../../../templates/design/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as slidesProfile } from "../../../../templates/slides/server/lib/chatgpt-directory-tools.js";
import { isActionHiddenFromEveryAgentSurface } from "../action.js";
import {
  filterFrameworkToolGroups,
  type FrameworkToolGroup,
} from "../framework-tools.js";
import { listResourceSuggestions } from "../review/suggestions/actions.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import {
  filterAgentTools,
  filterMcpOnlyActions,
} from "../server/agent-chat/action-filters-a2a.js";
import { resolveAgentChatMcpOptions } from "../server/agent-chat/mcp-options.js";
import {
  createMcpDirectoryWidgetWriteCapability,
  normalizeMcpDirectoryWidgetWriteActionArguments,
} from "../shared/embed-auth.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import {
  createMCPServerForRequest,
  selectMcpDirectoryWidgetReadActions,
  selectMcpDirectoryWidgetWriteActions,
  validateMcpDirectoryProfile,
} from "./build-server.js";
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
  const sharedActions =
    appId === "content"
      ? { "list-resource-suggestions": listResourceSuggestions }
      : {};
  const loadNames = [
    ...new Set([
      ...toolNames,
      ...Object.keys(profile.widgetReadActionArguments ?? {}),
      ...Object.keys(profile.widgetWriteActionArguments ?? {}),
    ]),
  ];
  const actionNames = [
    ...registrySource.matchAll(/^\s*"([^"]+)":\s*a_[\w]+,?$/gm),
  ].map(([, name]) => name!);
  const modules = Object.fromEntries(
    await Promise.all(
      loadNames.map(async (name) => {
        const symbol = `a_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
        if (
          !registrySource.includes(`"${name}": ${symbol}`) &&
          !Object.hasOwn(sharedActions, name)
        ) {
          throw new Error(`${appId} action registry is missing "${name}".`);
        }
        if (Object.hasOwn(sharedActions, name)) {
          return [name, sharedActions[name as keyof typeof sharedActions]];
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
  return {
    actions,
    productionActions,
    actionNames: [...new Set([...actionNames, ...Object.keys(sharedActions)])],
  };
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

  it("opens a generated Design screen focused in the overview canvas", () => {
    const target = designProfile.widgetTargets?.["generate-design"];
    if (!target)
      throw new Error("Design generate-design widget target is missing.");

    expect(
      target(
        { designId: "design-123" },
        {
          designId: "design-123",
          urlPath: "/design/design-123?editorView=overview&screen=file-456",
        },
      ),
    ).toMatchObject({
      targetPath: "/design/design-123?editorView=overview&screen=file-456",
      resourceIds: { designId: "design-123" },
    });
    expect(
      target(
        { designId: "design-123" },
        {
          designId: "design-123",
          urlPath: "https://example.com/design/design-123?screen=file-456",
        },
      )?.targetPath,
    ).toBe("/design/design-123");
  });

  it(
    "allows Design widget sync flags while excluding file metadata from update-file writes",
    async () => {
      const { actions } = await loadTemplateActions("design");
      const actionProperties =
        actions["update-file"]?.tool?.parameters?.properties;
      const updateFileArguments =
        designProfile.widgetWriteActionArguments?.["update-file"];

      expect(actionProperties).toHaveProperty("syncCollab");
      expect(actionProperties).toHaveProperty("identityOnly");
      expect(actionProperties).toHaveProperty("filename");
      expect(actionProperties).toHaveProperty("fileType");
      expect(updateFileArguments).toMatchObject({
        id: { type: "actionSchemaResourceBound", resourceKey: "designId" },
        syncCollab: { type: "actionSchema" },
        identityOnly: { type: "actionSchema" },
      });
      if (!updateFileArguments) {
        throw new Error("Design update-file widget arguments are missing.");
      }

      const resourceUri = "ui://design/shell-v69";
      const capability = createMcpDirectoryWidgetWriteCapability({
        appId: "design",
        resourceUri,
        resourceIds: { designId: "design-123" },
        userEmail: "reviewer@example.test",
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: {},
        writeActionArguments: { "update-file": updateFileArguments },
      });
      expect(capability).toBeDefined();
      if (!capability) throw new Error("Failed to create test capability.");

      const allowedArgumentNames = Object.keys(updateFileArguments);
      const args = {
        id: "file-456",
        content: "<html><body>Updated screen</body></html>",
        syncCollab: true,
        identityOnly: true,
        expectedVersionHash: "source-hash",
        operationSource: "widget-session",
        operationRevision: 1,
      };
      const normalize = (nextArgs: Record<string, unknown>) =>
        normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
          actionName: "update-file",
          appId: "design",
          resourceUri,
          userEmail: "reviewer@example.test",
          args: nextArgs,
          allowedArgumentNames,
        });

      expect(normalize(args)).toEqual(args);
      for (const field of ["filename", "fileType"] as const) {
        expect(normalize({ ...args, [field]: "renamed.html" })).toBeUndefined();
      }
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it(
    "scopes Design widget screen creation to its target design",
    async () => {
      const { actions } = await loadTemplateActions("design");
      const createFileArguments =
        designProfile.widgetWriteActionArguments?.["create-file"];

      expect(
        actions["create-file"]?.tool?.parameters?.properties,
      ).toHaveProperty("designId");
      expect(createFileArguments).toMatchObject({
        designId: {
          type: "actionSchemaResourceBound",
          resourceKey: "designId",
        },
        filename: { type: "actionSchema" },
        content: { type: "actionSchema" },
        fileType: { type: "actionSchema" },
      });
      if (!createFileArguments) {
        throw new Error("Design create-file widget arguments are missing.");
      }

      const generatedTarget = designProfile.widgetTargets?.[
        "generate-design"
      ]?.({ designId: "design-123" }, { designId: "design-123" });
      expect(generatedTarget?.writeActions).toContain("create-file");

      const resourceUri = "ui://design/shell-v69";
      const capability = createMcpDirectoryWidgetWriteCapability({
        appId: "design",
        resourceUri,
        resourceIds: { designId: "design-123" },
        userEmail: "reviewer@example.test",
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: {},
        writeActionArguments: { "create-file": createFileArguments },
      });
      expect(capability).toBeDefined();
      if (!capability) throw new Error("Failed to create test capability.");

      const args = {
        designId: "design-123",
        filename: "new-screen.html",
        content: "<main>New screen</main>",
        fileType: "html",
      };
      const normalize = (nextArgs: Record<string, unknown>) =>
        normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
          actionName: "create-file",
          appId: "design",
          resourceUri,
          userEmail: "reviewer@example.test",
          args: nextArgs,
          allowedArgumentNames: Object.keys(createFileArguments),
        });

      expect(normalize(args)).toEqual(args);
      expect(normalize({ ...args, replaceExisting: true })).toBeUndefined();
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it(
    "uses document-specific labels for Content's shared widget shell",
    async () => {
      const { actions } = await loadTemplateActions("content");
      const documentResource = actions["create-document"]?.mcpApp?.resource;
      const databaseResource =
        actions["create-content-database"]?.mcpApp?.resource;

      expect(documentResource?.title).toBe("Open document");
      expect(databaseResource?.title).toBe("Open database");
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it(
    "scopes Content page and database boot reads to each created resource",
    async () => {
      const documentId = "page-review-1";
      const spaceId = "space-review-1";
      const {
        createMcpDirectoryWidgetReadCapability,
        normalizeMcpDirectoryWidgetReadActionArguments,
      } = await import("../shared/embed-auth.js");
      const resourceUri = "ui://content/shell-v69";
      const pageBootReads = [
        ["get-document", { id: documentId }],
        ["get-content-navigation-context", { id: documentId }],
        ["get-preview-document-draft", { documentId }],
        ["list-comments", { documentId }],
        [
          "list-resource-suggestions",
          { resourceType: "document", resourceId: documentId },
        ],
      ] as const;

      const createScope = (toolName: string, result: unknown) => {
        const target = contentProfile.widgetTargets?.[toolName]?.({}, result);
        expect(target?.targetPath).toBe(`/page/${documentId}`);
        if (!target) throw new Error(`${toolName} has no widget target.`);
        const actionArguments = Object.fromEntries(
          Object.entries(contentProfile.widgetReadActionArguments ?? {})
            .map(([name, argumentMap]) => {
              const args = Object.fromEntries(
                Object.entries(argumentMap).flatMap(([key, rule]) => {
                  if (typeof rule !== "string") return [[key, rule]];
                  const value = target.resourceIds[rule];
                  return typeof value === "string" ? [[key, value]] : [];
                }),
              );
              return Object.keys(args).length ===
                Object.keys(argumentMap).length
                ? [name, args]
                : null;
            })
            .filter((entry): entry is [string, Record<string, unknown>] =>
              Boolean(entry),
            ),
        );
        const scope = createMcpDirectoryWidgetReadCapability({
          appId: "content",
          resourceUri,
          resourceIds: target.resourceIds,
          actionArguments,
        });
        expect(scope).toBeDefined();
        return { scope: scope!, target };
      };

      const assertReadsAllowed = (
        scope: string,
        reads: ReadonlyArray<readonly [string, Record<string, unknown>]>,
      ) => {
        for (const [actionName, args] of reads) {
          const argumentMap =
            contentProfile.widgetReadActionArguments?.[actionName] ?? {};
          expect(
            normalizeMcpDirectoryWidgetReadActionArguments(scope, {
              actionName,
              appId: "content",
              resourceUri,
              args,
              allowedArgumentNames: Object.keys(argumentMap),
            }),
          ).toEqual(args);
        }
      };

      const document = createScope("create-document", {
        id: documentId,
        spaceId,
      });
      expect(document.target.resourceIds).toEqual({
        documentId,
        resourceType: "document",
        spaceId,
      });
      assertReadsAllowed(document.scope, pageBootReads);
      expect(contentProfile.widgetReadActionArguments).not.toHaveProperty(
        "list-content-spaces",
      );
      expect(contentProfile.widgetReadActionArguments).not.toHaveProperty(
        "get-content-sidebar-state",
      );

      const databaseId = "database-review-1";
      const database = createScope("create-content-database", {
        database: { id: databaseId, documentId, spaceId },
      });
      expect(database.target.resourceIds).toEqual({
        databaseId,
        documentId,
        databaseDocumentId: documentId,
        resourceType: "document",
        spaceId,
      });
      assertReadsAllowed(database.scope, [
        ...pageBootReads,
        ["get-content-database", { databaseId, documentId, limit: 100 }],
        ["get-content-database-personal-view", { databaseId }],
        [
          "query-content-database-items",
          { documentId, limit: 50, tableQuery: { search: "launch" } },
        ],
      ]);

      expect(
        normalizeMcpDirectoryWidgetReadActionArguments(document.scope, {
          actionName: "get-document",
          appId: "content",
          resourceUri,
          args: { id: "another-page" },
          allowedArgumentNames: ["id"],
        }),
      ).toBeUndefined();
      expect(
        createMcpDirectoryWidgetReadCapability({
          appId: "content",
          resourceUri,
          resourceIds: {},
          actionArguments: { "list-content-spaces": {} },
        }),
      ).toBeUndefined();
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it.each(templateProfiles)(
    "$appId allowlist is registered, exposed, annotated, and narrowly scoped",
    async ({ appId, profile }) => {
      const { actions, productionActions, actionNames } =
        await loadTemplateActions(appId);
      const mcpOptions = resolveAgentChatMcpOptions({
        mcp: { directoryProfile: profile },
      });
      const widgetReadActions = selectMcpDirectoryWidgetReadActions(
        mcpOptions.directoryProfile,
        actions,
      );
      const widgetWriteActions = selectMcpDirectoryWidgetWriteActions(
        mcpOptions.directoryProfile,
        actions,
      );
      const serverConfig = {
        name: `agent-native-${appId}`,
        appId,
        description: "ChatGPT directory profile validation",
        catalogMode: "directory" as const,
        connectorCatalog: profile.connectorCatalog,
        widgetDomain: profile.widgetDomain,
        actions: productionActions,
        productionActions,
        widgetReadActions,
        widgetWriteActions,
        directoryProfile: mcpOptions.directoryProfile,
      };

      expect(mcpOptions.catalog).toBeUndefined();
      await expect(
        createMCPServerForRequest(serverConfig, {
          userEmail: "reviewer@example.test",
          orgId: null,
        }),
      ).resolves.toBeDefined();

      const server = await createMCPServerForRequest(
        serverConfig,
        {
          userEmail: "reviewer@example.test",
          identityAssurance: "user",
          orgId: null,
          orgDomain: undefined,
        },
        { origin: profile.widgetDomain, transport: "http" },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({
        name: "directory-profile-spec",
        version: "1",
      });
      await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]);
      try {
        const { tools } = await client.listTools();
        const widgetTargetNames = Object.keys(profile.widgetTargets).sort();
        const widgetToolNames = tools
          .filter((tool) => typeof tool._meta?.ui?.resourceUri === "string")
          .map((tool) => tool.name)
          .sort();
        expect(widgetToolNames).toEqual(widgetTargetNames);
        expect(
          tools
            .filter((tool) => /^(?:list|get|search)-/.test(tool.name))
            .filter(
              (tool) =>
                tool._meta?.ui !== undefined ||
                tool._meta?.["openai/outputTemplate"] !== undefined,
            )
            .map((tool) => tool.name),
        ).toEqual([]);
        const sessionTool = tools.find(
          (tool) => tool.name === "create_embed_session",
        );
        expect(sessionTool?._meta?.ui?.visibility).toEqual(["app"]);
        expect(sessionTool?.inputSchema.required).toEqual(["sourceTicket"]);
        expect(sessionTool?.inputSchema.properties).not.toHaveProperty(
          "sourceTool",
        );
        expect(sessionTool?.inputSchema.properties).not.toHaveProperty(
          "toolInput",
        );
        expect(sessionTool?.inputSchema.properties).not.toHaveProperty(
          "toolOutput",
        );
      } finally {
        await Promise.all([client.close(), server.close()]);
      }

      if (appId === "content") {
        const privateRead = "query-content-database-items";
        expect(profile.connectorCatalog).not.toContain(privateRead);
        expect(profile.widgetReadPrivateActions).toContain(privateRead);
        expect(isActionHiddenFromEveryAgentSurface(actions[privateRead]!)).toBe(
          true,
        );
      }

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

  it.each(templateProfiles)(
    "$appId read tools deliver their result payload to the model",
    async ({ appId, profile }) => {
      const { actions, productionActions } = await loadTemplateActions(appId);
      const mcpOptions = resolveAgentChatMcpOptions({
        mcp: { directoryProfile: profile },
      });
      const readNames = profile.connectorCatalog.filter(
        (name) => productionActions[name]?.http?.method === "GET",
      );
      expect(readNames.length).toBeGreaterThan(0);
      const payload = {
        id: "resource-1",
        title: "Quarterly Planning Demo",
        items: [{ id: "item-1", title: "Priorities" }],
      };
      const stubbedActions = {
        ...productionActions,
        ...Object.fromEntries(
          readNames.map((name) => [
            name,
            { ...productionActions[name]!, run: async () => payload },
          ]),
        ),
      };
      const serverConfig = {
        name: `agent-native-${appId}`,
        appId,
        description: "ChatGPT directory profile validation",
        catalogMode: "directory" as const,
        connectorCatalog: profile.connectorCatalog,
        widgetDomain: profile.widgetDomain,
        actions: stubbedActions,
        productionActions: stubbedActions,
        widgetReadActions: selectMcpDirectoryWidgetReadActions(
          mcpOptions.directoryProfile,
          actions,
        ),
        widgetWriteActions: selectMcpDirectoryWidgetWriteActions(
          mcpOptions.directoryProfile,
          actions,
        ),
        directoryProfile: mcpOptions.directoryProfile,
      };
      const server = await createMCPServerForRequest(
        serverConfig,
        {
          userEmail: "reviewer@example.test",
          identityAssurance: "user",
          orgId: null,
          orgDomain: undefined,
        },
        { origin: profile.widgetDomain, transport: "http" },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({
        name: "directory-profile-spec",
        version: "1",
      });
      await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]);
      try {
        for (const name of readNames) {
          const result = await client.callTool({ name, arguments: {} });
          const text = (result.content as Array<{ text?: string }>)
            .map((block) => block.text ?? "")
            .join("\n");
          expect(result.isError, name).not.toBe(true);
          expect(text, name).toContain("Priorities");
          expect(result.structuredContent, name).toMatchObject({
            items: [{ title: "Priorities" }],
          });
        }
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
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
              uri: "ui://content/shell-v69",
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

  it("serves a listed widget action without a target as a plain tool and rejects unknown targets", () => {
    const annotations = {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    };
    const widgetAction = {
      tool: { description: "Create one document." },
      readOnly: false,
      mcpAnnotations: annotations,
      mcpApp: {
        resource: {
          uri: "ui://content/shell-v69",
          title: "Document",
          html: "<html></html>",
        },
      },
      run: async () => ({ id: "doc-1" }),
    };
    const plainAction = {
      tool: { description: "Read one document." },
      readOnly: false,
      mcpAnnotations: annotations,
      run: async () => ({ id: "doc-1" }),
    };
    const target = () => ({
      targetPath: "/page/doc-1",
      resourceIds: { documentId: "doc-1" },
    });
    const config = {
      name: "content",
      description: "Content directory.",
      catalogMode: "directory" as const,
      actions: {
        "create-document": widgetAction,
        "get-document-snapshot": widgetAction,
        "get-document": plainAction,
      },
      directoryProfile: {
        connectorCatalog: [
          "create-document",
          "get-document-snapshot",
          "get-document",
        ],
        widgetTargets: { "create-document": target },
      },
    };

    expect(() => validateMcpDirectoryProfile(config)).not.toThrow();
    expect(() =>
      validateMcpDirectoryProfile({
        ...config,
        directoryProfile: {
          ...config.directoryProfile,
          widgetTargets: { "create-document": target, "get-document": target },
        },
      }),
    ).toThrow(/widget target "get-document" must name a listed action/);
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
