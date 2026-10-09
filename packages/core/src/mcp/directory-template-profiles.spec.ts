import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  canRenewMcpDirectoryWidgetCapabilityScope,
  createMcpDirectoryWidgetReadCapability,
  createMcpDirectoryWidgetWriteCapability,
  getMcpDirectoryWidgetWriteCapabilityGrant,
  isMcpDirectoryWidgetWriteCapabilityScope,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH,
  normalizeMcpDirectoryWidgetReadActionArguments,
  normalizeMcpDirectoryWidgetWriteActionArguments,
  renewMcpDirectoryWidgetCapabilityScope,
  type McpDirectoryWidgetReadArgument,
} from "../shared/embed-auth.js";
import listResourceShares from "../sharing/actions/list-resource-shares.js";
import setResourceVisibility from "../sharing/actions/set-resource-visibility.js";
import shareResource from "../sharing/actions/share-resource.js";
import unshareResource from "../sharing/actions/unshare-resource.js";
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

// Framework actions the runtime merges into every app (mergeCoreSharingActions
// and the review kit) that a profile binds to widget grants, so they have no
// file under the template's actions/.
const sharedActionsByApp: Record<string, Record<string, unknown>> = {
  content: {
    "list-resource-suggestions": listResourceSuggestions,
    "list-resource-shares": listResourceShares,
    "share-resource": shareResource,
    "unshare-resource": unshareResource,
    "set-resource-visibility": setResourceVisibility,
  },
  slides: {
    "list-resource-shares": listResourceShares,
    "share-resource": shareResource,
    "unshare-resource": unshareResource,
    "set-resource-visibility": setResourceVisibility,
  },
};

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
  const sharedActions = sharedActionsByApp[appId] ?? {};
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
          return [name, sharedActions[name]];
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
        designId: "designId",
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
      const materializedCreateFileArguments = {
        ...createFileArguments,
        designId: "design-123",
      };
      const capability = createMcpDirectoryWidgetWriteCapability({
        appId: "design",
        resourceUri,
        resourceIds: { designId: "design-123" },
        userEmail: "reviewer@example.test",
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: {},
        writeActionArguments: {
          "create-file": materializedCreateFileArguments,
        },
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
      expect(
        normalize({ ...args, designId: "design-outside-scope" }),
      ).toBeUndefined();
      expect(normalize({ ...args, replaceExisting: true })).toBeUndefined();
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it(
    "allows Content widget document icon updates without widening its write scope",
    async () => {
      const { actions } = await loadTemplateActions("content");
      const actionProperties =
        actions["update-document"]?.tool?.parameters?.properties;
      const updateDocumentArguments =
        contentProfile.widgetWriteActionArguments?.["update-document"];

      expect(actionProperties).toHaveProperty("icon");
      expect(updateDocumentArguments).toMatchObject({
        id: "documentId",
        icon: { type: "actionSchema" },
      });
      if (!updateDocumentArguments) {
        throw new Error(
          "Content update-document widget arguments are missing.",
        );
      }

      const resourceUri = "ui://content/shell-v69";
      const capability = createMcpDirectoryWidgetWriteCapability({
        appId: "content",
        resourceUri,
        resourceIds: { documentId: "page-1" },
        userEmail: "reviewer@example.test",
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: {},
        writeActionArguments: {
          "update-document": {
            ...updateDocumentArguments,
            id: "page-1",
          },
        },
      });
      expect(capability).toBeDefined();
      if (!capability) throw new Error("Failed to create test capability.");

      const args = { id: "page-1", icon: "📕" };
      expect(
        normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
          actionName: "update-document",
          appId: "content",
          resourceUri,
          userEmail: "reviewer@example.test",
          args,
          allowedArgumentNames: Object.keys(updateDocumentArguments),
        }),
      ).toEqual(args);
      expect(
        normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
          actionName: "update-document",
          appId: "content",
          resourceUri,
          userEmail: "reviewer@example.test",
          args: { ...args, description: "outside the widget edit scope" },
          allowedArgumentNames: Object.keys(updateDocumentArguments),
        }),
      ).toBeUndefined();
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it("accepts a title-only Content widget document update", () => {
    const updateDocumentArguments =
      contentProfile.widgetWriteActionArguments["update-document"];
    const resourceUri = "ui://content/shell-v69";
    const capability = createMcpDirectoryWidgetWriteCapability({
      appId: "content",
      resourceUri,
      resourceIds: { documentId: "page-1", resourceType: "document" },
      userEmail: "reviewer@example.test",
      expiresAtMs: Date.now() + 60_000,
      readActionArguments: {},
      writeActionArguments: {
        "update-document": { ...updateDocumentArguments, id: "page-1" },
      },
    });
    const normalize = (args: Record<string, unknown>) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
        actionName: "update-document",
        appId: "content",
        resourceUri,
        userEmail: "reviewer@example.test",
        args,
        allowedArgumentNames: Object.keys(updateDocumentArguments),
      });

    for (const args of [
      { id: "page-1", title: "Renamed" },
      {
        id: "page-1",
        title: "Renamed",
        baseTitle: "Before",
        historySessionId: "session-1",
        browserSaveAttemptId: "attempt-1",
      },
    ]) {
      expect(normalize(args)).toEqual(args);
    }
    expect(normalize({ id: "page-2", title: "Renamed" })).toBeUndefined();
    expect(normalize({ title: "Renamed" })).toBeUndefined();
  });

  it(
    "scopes Content document sharing to the ticketed document and nothing wider",
    async () => {
      const { actions } = await loadTemplateActions("content");
      const documentId = "page-share-1";
      const resourceUri = "ui://content/shell-v69";
      const createDocument = contentProfile.widgetTargets["create-document"];
      const target = createDocument({}, { id: documentId, spaceId: "space-1" });
      if (!target)
        throw new Error("Content create-document target is missing.");

      const shareActions = [
        "share-resource",
        "unshare-resource",
        "set-resource-visibility",
      ] as const;
      expect([...(target.writeActions ?? [])].sort()).toEqual(
        ["update-document", ...shareActions].sort(),
      );
      expect(
        contentProfile.widgetTargets["create-content-database"](
          {},
          {
            database: {
              id: "database-1",
              documentId: "database-page-1",
              spaceId: "space-1",
            },
          },
        )?.writeActions,
      ).toEqual(["add-database-item", "update-database-item"]);
      expect(
        Object.keys(contentProfile.widgetWriteActionArguments).sort(),
      ).toEqual([
        "add-database-item",
        "set-resource-visibility",
        "share-resource",
        "unshare-resource",
        "update-database-item",
        "update-document",
      ]);
      expect(contentProfile.widgetReadAuthenticatedActions).toContain(
        "list-resource-shares",
      );
      expect(contentProfile.connectorCatalog).not.toContain("share-resource");
      expect(contentProfile.connectorCatalog).not.toContain(
        "list-resource-shares",
      );

      for (const name of shareActions) {
        expect(actions[name]?.http?.method ?? "POST").toBe("POST");
        expect(actions[name]?.readOnly).not.toBe(true);
        expect(actions[name]?.requiresAuth).not.toBe(false);
        expect(actions[name]?.toolCallable).toBe(false);
      }
      expect(actions["list-resource-shares"]?.http).toEqual({ method: "GET" });
      expect(actions["list-resource-shares"]?.readOnly).toBe(true);

      const materialize = (rules: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(rules).map(([key, rule]) => [
            key,
            typeof rule === "string" ? target.resourceIds[rule] : rule,
          ]),
        ) as Record<string, string | { type: "actionSchema" }>;
      const writeActionArguments = Object.fromEntries(
        (target.writeActions ?? []).map((name) => [
          name,
          materialize(
            contentProfile.widgetWriteActionArguments[
              name as keyof typeof contentProfile.widgetWriteActionArguments
            ],
          ),
        ]),
      );
      expect(writeActionArguments["share-resource"]).toMatchObject({
        resourceType: "document",
        resourceId: documentId,
      });
      expect(writeActionArguments["unshare-resource"]).toMatchObject({
        resourceType: "document",
        resourceId: documentId,
      });
      expect(writeActionArguments["set-resource-visibility"]).toMatchObject({
        resourceType: "document",
        resourceId: documentId,
      });

      const capability = createMcpDirectoryWidgetWriteCapability({
        appId: "content",
        resourceUri,
        resourceIds: target.resourceIds,
        userEmail: "editor@example.test",
        orgId: "org-1",
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: {
          "list-resource-shares": materialize(
            contentProfile.widgetReadActionArguments["list-resource-shares"],
          ),
        },
        writeActionArguments,
      });
      expect(capability).toBeDefined();

      const bodies = {
        "share-resource": {
          resourceType: "document",
          resourceId: documentId,
          principalType: "user",
          principalId: "teammate@example.test",
          role: "viewer",
          notify: true,
          resourceUrl: "/page/page-share-1",
          message: "Take a look",
        },
        "unshare-resource": {
          resourceType: "document",
          resourceId: documentId,
          principalType: "user",
          principalId: "teammate@example.test",
        },
        "set-resource-visibility": {
          resourceType: "document",
          resourceId: documentId,
          visibility: "org",
        },
      } as const;
      const normalize = (
        name: string,
        args: Record<string, unknown>,
        overrides: Record<string, unknown> = {},
      ) =>
        normalizeMcpDirectoryWidgetWriteActionArguments(capability, {
          actionName: name,
          appId: "content",
          resourceUri,
          userEmail: "editor@example.test",
          orgId: "org-1",
          args,
          allowedArgumentNames: Object.keys(
            contentProfile.widgetWriteActionArguments[
              name as keyof typeof contentProfile.widgetWriteActionArguments
            ] ?? {},
          ),
          ...overrides,
        });
      for (const name of shareActions) {
        const body: Record<string, unknown> = { ...bodies[name] };
        const { resourceId: _resourceId, ...withoutResourceId } = body;
        const { resourceType: _resourceType, ...withoutResourceType } = body;
        expect(normalize(name, body), name).toEqual(body);
        expect(
          normalize(name, { ...body, resourceId: "other-page" }),
        ).toBeUndefined();
        expect(
          normalize(name, { ...body, resourceType: "form" }),
        ).toBeUndefined();
        expect(normalize(name, withoutResourceId)).toBeUndefined();
        expect(normalize(name, withoutResourceType)).toBeUndefined();
        expect(
          normalize(name, body, { userEmail: "someone-else@example.test" }),
        ).toBeUndefined();
      }
      for (const name of [
        "delete-document",
        "set-document-discoverability",
        "list-resource-access-requests",
        "approve-resource-access-request",
        "create-agent-resource-link",
      ]) {
        expect(
          normalize(
            name,
            { resourceType: "document", resourceId: documentId },
            { allowedArgumentNames: ["resourceType", "resourceId"] },
          ),
          name,
        ).toBeUndefined();
      }
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it("keeps the minted Content document write capability inside its length cap", () => {
    const mint = (documentId: string, spaceId: string, identity: string) => {
      const target = contentProfile.widgetTargets["create-document"](
        {},
        { id: documentId, spaceId },
      );
      if (!target)
        throw new Error("Content create-document target is missing.");
      const materialize = (rules: Record<string, unknown>) => {
        const args: Record<string, unknown> = {};
        for (const [key, rule] of Object.entries(rules)) {
          const value =
            typeof rule === "string" ? target.resourceIds[rule] : rule;
          if (value === undefined) return undefined;
          args[key] = value;
        }
        return args as Record<string, never>;
      };
      return createMcpDirectoryWidgetWriteCapability({
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        resourceIds: target.resourceIds,
        userEmail: `${identity}@builder.io`,
        orgId: identity,
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: Object.fromEntries(
          Object.entries(contentProfile.widgetReadActionArguments).flatMap(
            ([name, rules]) => {
              const args = materialize(rules);
              return args ? [[name, args]] : [];
            },
          ),
        ),
        writeActionArguments: Object.fromEntries(
          (target.writeActions ?? []).map((name) => [
            name,
            materialize(
              contentProfile.widgetWriteActionArguments[
                name as keyof typeof contentProfile.widgetWriteActionArguments
              ],
            )!,
          ]),
        ),
      });
    };
    const uuid = "123e4567-e89b-12d3-a456-426614174000";

    // A typical nanoid page, then a page, space, and org that all use UUIDs.
    // The mint refuses an oversized capability, so a page would not open.
    for (const scope of [
      mint("a1b2c3d4e5f6", "a1b2c3d4e5f6", "steve"),
      mint(uuid, uuid, uuid),
    ]) {
      expect(scope).toBeDefined();
      expect(scope!.length).toBeLessThanOrEqual(
        MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH,
      );
    }
  });

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

describe("Slides widget share grant", () => {
  type ArgumentRules = Record<string, McpDirectoryWidgetReadArgument>;
  const readRules = slidesProfile.widgetReadActionArguments as Record<
    string,
    ArgumentRules
  >;
  const writeRules = slidesProfile.widgetWriteActionArguments as Record<
    string,
    ArgumentRules
  >;
  const appId = "slides";
  const resourceUri = "ui://slides/shell-v69";
  const identity = { userEmail: "editor@example.test", orgId: "org-1" };
  const fifteenMinutes = MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS;
  const deckA = "V1StGXR8_Z5jdHi6B-myT0abcdefgh";
  const deckB = "deck-b-someone-elses-presentation";

  afterEach(() => {
    vi.useRealTimers();
  });

  // Mirrors how mcpDirectoryWidgetCapabilityForTool materializes the profile
  // for one target: string rules become the target's literal resource values.
  function grantFor(
    deckId: string,
    {
      userEmail = identity.userEmail,
      orgId = identity.orgId,
      expiresAtMs = Date.now() + fifteenMinutes,
    }: { userEmail?: string; orgId?: string; expiresAtMs?: number } = {},
  ) {
    const target = slidesProfile.widgetTargets["create-deck"](
      {},
      { id: deckId },
    );
    if (!target) throw new Error("Slides create-deck target is missing.");
    const materialize = (rules: ArgumentRules): ArgumentRules =>
      Object.fromEntries(
        Object.entries(rules).map(([name, rule]) => [
          name,
          typeof rule === "string" ? target.resourceIds[rule]! : rule,
        ]),
      );
    const readActionArguments = Object.fromEntries(
      Object.entries(readRules).map(([name, rules]) => [
        name,
        materialize(rules),
      ]),
    );
    const writeActionArguments = Object.fromEntries(
      Object.entries(writeRules)
        .filter(([name]) => target.writeActions.includes(name))
        .map(([name, rules]) => [name, materialize(rules)]),
    );
    const scope = createMcpDirectoryWidgetWriteCapability({
      appId,
      resourceUri,
      resourceIds: target.resourceIds,
      userEmail,
      orgId,
      expiresAtMs,
      readActionArguments,
      writeActionArguments,
    });
    if (!scope) throw new Error("Failed to mint the Slides write capability.");
    return { target, readActionArguments, scope };
  }

  type Caller = { userEmail?: string; orgId?: string };
  const normalizeWrite = (
    scope: string,
    actionName: string,
    args: Record<string, unknown>,
    caller: Caller = identity,
  ) =>
    normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
      actionName,
      appId,
      resourceUri,
      userEmail: caller.userEmail,
      orgId: caller.orgId,
      args,
      allowedArgumentNames: Object.keys(writeRules[actionName] ?? {}),
    });
  const normalizeRead = (
    scope: string,
    actionName: string,
    args: Record<string, unknown>,
    caller: Caller = identity,
  ) =>
    normalizeMcpDirectoryWidgetReadActionArguments(scope, {
      actionName,
      appId,
      resourceUri,
      userEmail: caller.userEmail,
      orgId: caller.orgId,
      args,
      allowedArgumentNames: Object.keys(readRules[actionName] ?? {}),
    });

  const shareArgs = (resourceId: string) => ({
    resourceType: "deck",
    resourceId,
    principalType: "user",
    principalId: "teammate@example.test",
    role: "viewer",
    notify: true,
    resourceUrl: `/deck/${resourceId}`,
    message: "Take a look",
  });
  const unshareArgs = (resourceId: string) => ({
    resourceType: "deck",
    resourceId,
    principalType: "user",
    principalId: "teammate@example.test",
  });
  const visibilityArgs = (resourceId: string) => ({
    resourceType: "deck",
    resourceId,
    visibility: "org",
  });
  const listArgs = (resourceId: string) => ({
    resourceType: "deck",
    resourceId,
  });
  const writeCalls = [
    ["share-resource", shareArgs],
    ["unshare-resource", unshareArgs],
    ["set-resource-visibility", visibilityArgs],
  ] as const;

  it.each(writeCalls)(
    "accepts the Share popover's %s call for the granted deck",
    (actionName, buildArgs) => {
      const { scope } = grantFor(deckA);
      const args = buildArgs(deckA);

      expect(normalizeWrite(scope, actionName, args)).toEqual(args);
    },
  );

  it("accepts the popover's role change and the read of the granted deck's shares", () => {
    const { scope } = grantFor(deckA);
    const roleChange = {
      resourceType: "deck",
      resourceId: deckA,
      principalType: "user",
      principalId: "teammate@example.test",
      role: "editor",
      notify: false,
    };

    expect(normalizeWrite(scope, "share-resource", roleChange)).toEqual(
      roleChange,
    );
    expect(
      normalizeRead(scope, "list-resource-shares", listArgs(deckA)),
    ).toEqual(listArgs(deckA));
  });

  it.each([
    ...writeCalls.map(
      ([actionName, buildArgs]) => [actionName, "write", buildArgs] as const,
    ),
    ["list-resource-shares", "read", listArgs] as const,
  ])(
    "binds %s to the granted deck, the deck type, and its listed arguments",
    (actionName, kind, buildArgs) => {
      const { scope } = grantFor(deckA);
      const normalize = (args: Record<string, unknown>) =>
        kind === "write"
          ? normalizeWrite(scope, actionName, args)
          : normalizeRead(scope, actionName, args);
      const valid = buildArgs(deckA);

      expect(normalize(valid)).toEqual(valid);
      expect(normalize(buildArgs(deckB))).toBeUndefined();
      for (const resourceType of ["document", "Deck", " deck", "deck ", ""]) {
        expect(
          normalize({ ...valid, resourceType }),
          resourceType,
        ).toBeUndefined();
      }
      for (const resourceId of [
        ` ${deckA}`,
        `${deckA}x`,
        deckA.toUpperCase(),
      ]) {
        expect(normalize({ ...valid, resourceId }), resourceId).toBeUndefined();
      }
      expect(normalize({ ...valid, resourceId: [deckA] })).toBeUndefined();
      expect(normalize({ ...valid, resourceType: ["deck"] })).toBeUndefined();
      expect(
        normalize({ ...valid, ownerEmail: "me@example.test" }),
      ).toBeUndefined();
      expect(normalize({ ...valid, orgId: "org-2" })).toBeUndefined();
      expect(normalize({ ...valid, id: deckA })).toBeUndefined();
    },
  );

  it(
    "requires the actions' own schemas to receive both bound arguments",
    async () => {
      const { actions } = await loadTemplateActions("slides");

      for (const [actionName, buildArgs] of [
        ...writeCalls,
        ["list-resource-shares", listArgs] as const,
      ]) {
        const schema = actions[actionName]?.schema as
          | {
              "~standard": {
                validate: (
                  value: unknown,
                ) => { issues?: unknown[] } | Promise<{ issues?: unknown[] }>;
              };
            }
          | undefined;
        if (!schema) throw new Error(`${actionName} has no input schema.`);
        const issues = async (value: Record<string, unknown>) =>
          (await schema["~standard"].validate(value)).issues;
        const { resourceType, resourceId, ...rest } = buildArgs(deckA);

        expect(
          await issues({ resourceType, resourceId, ...rest }),
        ).toBeUndefined();
        expect(await issues({ resourceId, ...rest }), actionName).toBeDefined();
        expect(
          await issues({ resourceType, ...rest }),
          actionName,
        ).toBeDefined();
      }
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it("rejects a call with no bound argument at all", () => {
    const { scope } = grantFor(deckA);

    expect(
      normalizeWrite(scope, "set-resource-visibility", {
        visibility: "public",
      }),
    ).toBeUndefined();
    expect(normalizeWrite(scope, "share-resource", {})).toBeUndefined();
  });

  it.each([
    "delete-deck",
    "duplicate-deck",
    "add-slide",
    "update-slide",
    "approve-resource-access-request",
    "decline-resource-access-request",
    "request-resource-access",
    "list-resource-access-requests",
    "get-resource-access-request",
    "get-resource-access-status",
    "create-agent-resource-link",
    "list-workspace-user-groups",
    "upsert-workspace-user-group",
  ])("rejects the unlisted %s action from both normalizers", (actionName) => {
    const { scope } = grantFor(deckA);
    const args = { ...listArgs(deckA), id: deckA, deckId: deckA };

    expect(normalizeWrite(scope, actionName, args)).toBeUndefined();
    expect(normalizeRead(scope, actionName, args)).toBeUndefined();
    expect(readRules).not.toHaveProperty(actionName);
    expect(writeRules).not.toHaveProperty(actionName);
  });

  it("keeps reads and writes in their own lanes", () => {
    const { scope } = grantFor(deckA);

    expect(
      normalizeWrite(scope, "list-resource-shares", listArgs(deckA)),
    ).toBeUndefined();
    expect(
      normalizeRead(scope, "share-resource", shareArgs(deckA)),
    ).toBeUndefined();
    expect(
      normalizeRead(scope, "set-resource-visibility", visibilityArgs(deckA)),
    ).toBeUndefined();
  });

  it("gives a viewer or commenter a read-only capability with no share writes", () => {
    const { target, readActionArguments } = grantFor(deckA);
    // authorizeWidgetWrite requires editor access; below that the server mints
    // only this read capability (see the grant tests in mcp/server.spec.ts).
    const scope = createMcpDirectoryWidgetReadCapability({
      appId,
      resourceUri,
      resourceIds: target.resourceIds,
      actionArguments: readActionArguments,
    });
    if (!scope) throw new Error("Failed to mint the Slides read capability.");

    expect(isMcpDirectoryWidgetWriteCapabilityScope(scope)).toBe(false);
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(scope, {
        appId,
        resourceUri,
        ...identity,
      }),
    ).toBeUndefined();
    for (const [actionName, buildArgs] of writeCalls) {
      expect(
        normalizeWrite(scope, actionName, buildArgs(deckA)),
        actionName,
      ).toBeUndefined();
    }
    expect(
      normalizeRead(scope, "list-resource-shares", listArgs(deckA)),
    ).toEqual(listArgs(deckA));
    expect(
      normalizeRead(scope, "list-resource-shares", listArgs(deckB)),
    ).toBeUndefined();
    expect(scope.length).toBeLessThanOrEqual(
      MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH - 1024,
    );
  });

  it("grants an editor exactly the declared write actions", () => {
    const { scope } = grantFor(deckA);

    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(scope, {
        appId,
        resourceUri,
        ...identity,
      }),
    ).toEqual({
      resourceIds: { deckId: deckA, resourceType: "deck" },
      actionNames: [
        "patch-deck",
        "set-resource-visibility",
        "share-resource",
        "unshare-resource",
      ],
    });
    expect(
      normalizeRead(scope, "get-deck", { id: deckA, deckId: deckA }),
    ).toEqual({ id: deckA, deckId: deckA });
  });

  it("stays bound to the minting user, org, app, and resource", () => {
    const { scope } = grantFor(deckA);
    const args = shareArgs(deckA);
    const allowedArgumentNames = Object.keys(writeRules["share-resource"]!);
    const normalizeFor = (overrides: {
      appId?: string;
      resourceUri?: string;
    }) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        actionName: "share-resource",
        appId,
        resourceUri,
        ...identity,
        ...overrides,
        args,
        allowedArgumentNames,
      });

    expect(normalizeWrite(scope, "share-resource", args)).toEqual(args);
    expect(
      normalizeWrite(scope, "share-resource", args, {
        userEmail: "someone-else@example.test",
        orgId: identity.orgId,
      }),
    ).toBeUndefined();
    expect(
      normalizeWrite(scope, "share-resource", args, {
        userEmail: identity.userEmail,
        orgId: "org-2",
      }),
    ).toBeUndefined();
    expect(normalizeFor({ appId: "design" })).toBeUndefined();
    expect(
      normalizeFor({ resourceUri: "ui://slides/other-shell" }),
    ).toBeUndefined();
  });

  it("keeps the 15 minute lifetime", () => {
    expect(fifteenMinutes).toBe(15 * 60 * 1000);
    expect(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH).toBe(4096);

    expect(() =>
      grantFor(deckA, { expiresAtMs: Date.now() + fifteenMinutes + 1_000 }),
    ).toThrow(/Failed to mint/);
    expect(() => grantFor(deckA, { expiresAtMs: Date.now() - 1 })).toThrow(
      /Failed to mint/,
    );
    expect(() =>
      grantFor(deckA, { expiresAtMs: Date.now() + fifteenMinutes - 1_000 }),
    ).not.toThrow();

    vi.useFakeTimers({ toFake: ["Date"] });
    const { scope } = grantFor(deckA);
    expect(normalizeWrite(scope, "share-resource", shareArgs(deckA))).toEqual(
      shareArgs(deckA),
    );
    vi.setSystemTime(Date.now() + fifteenMinutes + 1);
    expect(
      normalizeWrite(scope, "share-resource", shareArgs(deckA)),
    ).toBeUndefined();
    expect(
      normalizeRead(scope, "list-resource-shares", listArgs(deckA)),
    ).toBeUndefined();
  });

  it("fits the full Slides grant under the write capability limit with headroom", () => {
    const longEmail = `${"reviewer.".repeat(10)}slides-owner@${"sub.".repeat(8)}enterprise-customer-example.test`;
    const widestEmail = `${"x".repeat(64)}@${"y".repeat(63)}.${"z".repeat(63)}.${"w".repeat(63)}.${"v".repeat(63)}`;
    const widest = {
      userEmail: widestEmail.slice(0, 320),
      orgId: `org_${"a".repeat(252)}`,
    };

    const realistic = grantFor(deckA, {
      userEmail: longEmail,
      orgId: `org_${"a".repeat(32)}`,
    }).scope;
    const widestAllowed = grantFor(deckA, widest).scope;

    expect(deckA).toHaveLength(30);
    expect(longEmail.length).toBeGreaterThan(100);
    expect(widest.userEmail).toHaveLength(320);
    expect(widest.orgId).toHaveLength(256);
    expect(realistic.length).toBeLessThanOrEqual(
      MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH - 1500,
    );
    expect(widestAllowed.length).toBeLessThanOrEqual(
      MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH - 1000,
    );
  });

  it("renews with the same arguments and cannot widen or move the grant", () => {
    const { scope } = grantFor(deckA);
    const renewalInput = {
      appId,
      resourceUri,
      userEmail: identity.userEmail,
      orgId: identity.orgId,
      expiresAtMs: Date.now() + 10 * 60 * 1000,
      readAllowed: true,
    };

    const renewed = renewMcpDirectoryWidgetCapabilityScope(scope, {
      ...renewalInput,
      writeAllowed: true,
    });
    if (!renewed) throw new Error("Failed to renew the Slides write grant.");
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(scope, renewed, identity),
    ).toBe(true);
    expect(normalizeWrite(renewed, "share-resource", shareArgs(deckA))).toEqual(
      shareArgs(deckA),
    );
    expect(
      normalizeWrite(renewed, "share-resource", shareArgs(deckB)),
    ).toBeUndefined();
    expect(
      normalizeWrite(renewed, "share-resource", {
        ...shareArgs(deckA),
        resourceType: "document",
      }),
    ).toBeUndefined();

    const downgraded = renewMcpDirectoryWidgetCapabilityScope(scope, {
      ...renewalInput,
      writeAllowed: false,
    });
    if (!downgraded) throw new Error("Failed to downgrade the Slides grant.");
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(scope, downgraded, identity),
    ).toBe(true);
    expect(isMcpDirectoryWidgetWriteCapabilityScope(downgraded)).toBe(false);
    expect(
      normalizeWrite(downgraded, "share-resource", shareArgs(deckA)),
    ).toBeUndefined();
    expect(
      normalizeRead(downgraded, "list-resource-shares", listArgs(deckA)),
    ).toEqual(listArgs(deckA));
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(downgraded, renewed, identity),
    ).toBe(false);

    expect(
      renewMcpDirectoryWidgetCapabilityScope(scope, {
        ...renewalInput,
        userEmail: "someone-else@example.test",
        writeAllowed: true,
      }),
    ).toBeUndefined();
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(scope, renewed, {
        userEmail: "someone-else@example.test",
        orgId: identity.orgId,
      }),
    ).toBe(false);
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        scope,
        grantFor(deckB).scope,
        identity,
      ),
    ).toBe(false);
  });

  it(
    "validates against the real merged registry and needs each scoped category",
    async () => {
      const { actions, productionActions } =
        await loadTemplateActions("slides");
      const mcpOptions = resolveAgentChatMcpOptions({
        mcp: { directoryProfile: slidesProfile },
      });
      const config = {
        name: "agent-native-slides",
        appId: "slides",
        description: "Slides share grant validation",
        catalogMode: "directory" as const,
        connectorCatalog: slidesProfile.connectorCatalog,
        widgetDomain: slidesProfile.widgetDomain,
        actions: productionActions,
        productionActions,
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

      expect(Object.keys(config.widgetReadActions ?? {})).toEqual([
        "list-resource-shares",
      ]);
      expect(Object.keys(config.widgetWriteActions ?? {}).sort()).toEqual([
        "patch-deck",
        "set-resource-visibility",
        "share-resource",
        "unshare-resource",
      ]);
      expect(() => validateMcpDirectoryProfile(config)).not.toThrow();
      expect(() =>
        validateMcpDirectoryProfile({
          ...config,
          directoryProfile: {
            ...slidesProfile,
            widgetReadAuthenticatedActions: [],
          },
        }),
      ).toThrow(/must be listed in its scoped read category/);
      expect(() =>
        validateMcpDirectoryProfile({
          ...config,
          directoryProfile: {
            ...slidesProfile,
            widgetWriteActionArguments: {
              ...slidesProfile.widgetWriteActionArguments,
              "share-resource": {
                principalType: { type: "actionSchema" as const },
                principalId: { type: "actionSchema" as const },
              },
            },
          },
        }),
      ).toThrow(/exact resource ID binding/);
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );
});
