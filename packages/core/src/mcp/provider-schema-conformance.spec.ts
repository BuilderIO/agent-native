import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { attachToolSearch } from "../agent/tool-search.js";
import { createBrowserSessionActionEntries } from "../browser-sessions/actions.js";
import { createCodingToolRegistry } from "../coding-tools/index.js";
import { createExtensionActionEntries } from "../extensions/actions.js";
import { createFetchToolEntry } from "../extensions/fetch-tool.js";
import { createWebSearchToolEntry } from "../extensions/web-search-tool.js";
import { createRemoteBrowserActionEntries } from "../integrations/remote-browser-actions.js";
import { createNotificationToolEntries } from "../notifications/actions.js";
import { createProgressToolEntries } from "../progress/actions.js";
import { createBuilderBrowserTool } from "../server/agent-chat/browser-team-tools.js";
import {
  createDataWidgetActionEntries,
  createFrameworkContextEntry,
  createRefreshScreenEntry,
  createUrlTools,
} from "../server/agent-chat/context-tools.js";
import { loadRunCodeToolEntries } from "../server/agent-chat/run-code-tools.js";
import {
  createAgentEngineScriptEntries,
  createAgentLoopSettingsScriptEntries,
  createCallAgentScriptEntry,
  createChatScriptEntries,
  createDbScriptEntries,
  createDocsScriptEntries,
  createResourceScriptEntries,
} from "../server/agent-chat/script-entries.js";
import { createCoreAttachmentActionEntries } from "../server/attachment-actions.js";
import { createCoreEmailActionEntries } from "../server/email-actions.js";
import { createAutomationToolEntries } from "../triggers/actions.js";
import { createWorkspaceFileActionEntries } from "../workspace-files/actions.js";
import { createWorkspaceFilesTool } from "../workspace-files/tool.js";
import {
  conformanceMcpConfig,
  listMcpCatalogTools,
  providerSchemaViolations,
  withoutDiscoveryPredicates,
  type McpCatalogMode,
} from "./provider-schema-conformance.js";

const rulesFor = (inputSchema: unknown, name = "example-tool") =>
  providerSchemaViolations({ name, inputSchema }).map(
    ({ provider, rule, path }) => `${provider}: ${rule} at ${path}`,
  );

describe("providerSchemaViolations", () => {
  it("accepts a plain object schema", () => {
    expect(
      rulesFor({
        type: "object",
        properties: {
          id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          value: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["id"],
      }),
    ).toEqual([]);
  });

  it("reports each pinned rule against the providers that enforce it", () => {
    expect(
      rulesFor({ anyOf: [{ type: "object" }, { type: "object" }] }),
    ).toEqual([
      'anthropic: root type is not "object" at $',
      'openai: root type is not "object" at $',
      'gemini: root type is not "object" at $',
      "anthropic: root uses anyOf at $",
      "openai: root uses anyOf at $",
    ]);
    expect(
      rulesFor({
        type: "object",
        properties: {
          choice: { oneOf: [{ type: "string" }, { type: "number" }] },
          labels: { type: "object", propertyNames: { pattern: "^a" } },
          payload: { description: "anything" },
          list: { type: "array" },
        },
      }),
    ).toEqual([
      "openai: uses oneOf at $.properties.choice",
      "openai: uses propertyNames at $.properties.labels",
      "openai: schema position has no type at $.properties.payload",
      "openai: array has no items schema at $.properties.list",
    ]);
    expect(rulesFor({ type: "object", required: "id" })).toEqual([
      "anthropic: not a valid draft 2020-12 JSON Schema at $",
    ]);
  });

  it("checks tool names against each provider's pattern", () => {
    expect(rulesFor({ type: "object" }, "x".repeat(65))).toEqual([
      "openai: tool name has characters or a length the provider rejects at $",
    ]);
    expect(rulesFor({ type: "object" }, "1-start")).toEqual([
      "gemini: tool name has characters or a length the provider rejects at $",
    ]);
    expect(rulesFor({ type: "object" }, "app.tool")).toEqual([
      "anthropic: tool name has characters or a length the provider rejects at $",
      "openai: tool name has characters or a length the provider rejects at $",
    ]);
  });
});

async function frameworkActionSurface(): Promise<Record<string, ActionEntry>> {
  const owner = () => "conformance@example.com";
  const groups: Record<string, Record<string, ActionEntry>> = {
    resources: await createResourceScriptEntries(),
    docs: await createDocsScriptEntries(),
    database: await createDbScriptEntries("write", { extensionTools: true }),
    refreshScreen: createRefreshScreenEntry(),
    frameworkContext: createFrameworkContextEntry(),
    url: createUrlTools(),
    chat: {
      ...(await createChatScriptEntries()),
      ...(await createAgentEngineScriptEntries("conformance")),
      ...(await createAgentLoopSettingsScriptEntries()),
    },
    callAgent: await createCallAgentScriptEntry("conformance"),
    automation: {
      ...createAutomationToolEntries(owner, "conformance"),
      ...createNotificationToolEntries(owner),
      ...createProgressToolEntries(owner),
    },
    web: { ...createFetchToolEntry(), ...createWebSearchToolEntry() },
    workspaceFiles: {
      ...createWorkspaceFilesTool(),
      ...createWorkspaceFileActionEntries(),
    },
    widgetsAndExtensions: {
      ...createDataWidgetActionEntries(),
      ...createExtensionActionEntries(),
    },
    browser: {
      ...createBrowserSessionActionEntries({ getOwnerEmail: owner }),
      ...createRemoteBrowserActionEntries({
        getOwnerEmail: owner,
        getOrgId: () => null,
      }),
      ...createBuilderBrowserTool({
        getOrigin: () => "http://localhost:3000",
        getOwner: owner,
        extensionTools: true,
      }),
    },
    email: createCoreEmailActionEntries(),
    attachments: createCoreAttachmentActionEntries(),
    runCode: await loadRunCodeToolEntries(() => ({}), { evaluator: "node" }),
    coding: createCodingToolRegistry({ cwd: process.cwd() }),
  };
  // Several factories return {} when their module fails to load; an empty
  // group here would make this check pass while covering nothing.
  for (const [group, entries] of Object.entries(groups)) {
    expect(Object.keys(entries), group).not.toHaveLength(0);
  }
  return withoutDiscoveryPredicates(
    attachToolSearch(Object.assign({}, ...Object.values(groups))),
  );
}

describe("framework MCP tools", () => {
  const modes: McpCatalogMode[] = ["default", "full", "app", "oauth-read"];

  it("advertise only schemas every provider accepts", async () => {
    const config = conformanceMcpConfig(
      "conformance",
      await frameworkActionSurface(),
    );
    for (const mode of modes) {
      const tools = await listMcpCatalogTools(config, mode);
      expect(tools.length, mode).toBeGreaterThan(0);
      expect(
        tools.flatMap((tool) => providerSchemaViolations(tool)),
        mode,
      ).toEqual([]);
    }
  }, 120_000);
});
