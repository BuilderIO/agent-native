import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  MCP_CATALOG_MODES,
  PROVIDER_SCHEMA_RULES,
  providerSchemaViolations,
  withoutDiscoveryPredicates,
} from "./provider-schema-conformance.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const rulesFor = (inputSchema: unknown, name = "example-tool") =>
  providerSchemaViolations({ name, inputSchema }).map(
    ({ provider, rule, path }) => `${provider}: ${rule} at ${path}`,
  );

const RULES = Object.values(PROVIDER_SCHEMA_RULES);

/** One tool per pinned rule that breaks that rule. */
const NEGATIVE_FIXTURES: Record<string, { name?: string; schema: unknown }> = {
  "anthropic-tool-name": { name: "app.tool", schema: { type: "object" } },
  "openai-tool-name": { name: "x".repeat(65), schema: { type: "object" } },
  "gemini-tool-name": { name: "1-start", schema: { type: "object" } },
  "root-object": { schema: { type: "array", items: { type: "string" } } },
  "json-schema-2020-12": { schema: { type: "object", required: "id" } },
  "root-composition": {
    schema: {
      type: "object",
      anyOf: [{ required: ["a"] }, { required: ["b"] }],
    },
  },
  "gateway-one-of": {
    schema: {
      type: "object",
      properties: { v: { oneOf: [{ type: "string" }, { type: "number" }] } },
    },
  },
  "gateway-property-names": {
    schema: {
      type: "object",
      properties: {
        labels: { type: "object", propertyNames: { pattern: "^a" } },
      },
    },
  },
  "gateway-typeless": {
    schema: {
      type: "object",
      properties: { payload: { description: "anything" } },
    },
  },
  "codex-array-items": {
    schema: { type: "object", properties: { list: { type: "array" } } },
  },
  "gemini-array-items": {
    schema: { type: "object", properties: { list: { type: "array" } } },
  },
  "codex-enum-type": {
    schema: { type: "object", properties: { value: { const: 1 } } },
  },
  "boolean-subschema": {
    schema: { type: "object", properties: { anything: true } },
  },
  "gemini-forced-max-items": {
    schema: {
      type: "object",
      properties: {
        list: { type: "array", items: { type: "string" }, maxItems: 1000 },
      },
    },
  },
  "gemini-string-const": {
    schema: {
      type: "object",
      properties: { kind: { type: "string", const: "text" } },
    },
  },
  "gemini-json-types": {
    schema: { type: "object", properties: { when: { type: "date" } } },
  },
};

describe("providerSchemaViolations", () => {
  it("accepts a plain object schema", () => {
    expect(
      rulesFor({
        type: "object",
        properties: {
          id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          value: { anyOf: [{ type: "string" }, { type: "null" }] },
          any: { $ref: "#/$defs/Any" },
        },
        required: ["id"],
        additionalProperties: false,
        $defs: { Any: { anyOf: [{ type: "string" }, { type: "null" }] } },
      }),
    ).toEqual([]);
  });

  it("records a basis and a source for every rule", () => {
    for (const rule of RULES) {
      expect(["documented", "observed", "host"], rule.id).toContain(rule.basis);
      expect(rule.source.length, rule.id).toBeGreaterThan(20);
    }
  });

  it("has a negative fixture for every rule", () => {
    expect(Object.keys(NEGATIVE_FIXTURES).sort()).toEqual(
      RULES.map((rule) => rule.id).sort(),
    );
  });

  it.each(RULES)("reports $id against exactly its providers", (rule) => {
    const fixture = NEGATIVE_FIXTURES[rule.id]!;
    const reported = providerSchemaViolations({
      name: fixture.name ?? "example-tool",
      inputSchema: fixture.schema,
    }).filter((violation) => violation.rule === rule.id);

    expect(reported.map((violation) => violation.provider)).toEqual([
      ...rule.providers,
    ]);
  });

  it.each([
    [{ const: 1 }],
    [{ enum: [1, "a", null] }],
    [{ enum: ["a", "b"] }],
    [{ $ref: "#/$defs/Any", enum: ["x"] }],
  ])("requires an explicit type beside enum or const: %j", (value) => {
    expect(
      rulesFor({
        type: "object",
        properties: { value },
        $defs: { Any: { type: "string" } },
      }),
    ).toEqual(["openai: codex-enum-type at /properties/value"]);
  });

  it("accepts typed enums and consts, including one typed branch per type", () => {
    expect(
      rulesFor({
        type: "object",
        properties: {
          one: { type: "number", const: 1 },
          names: { type: "string", enum: ["a", "b"] },
          mixed: {
            anyOf: [
              { type: "number", enum: [1] },
              { type: "string", enum: ["a"] },
              { type: "null" },
            ],
          },
        },
      }),
    ).toEqual([]);
  });

  it("flags a string const beside an enum, typed or not", () => {
    expect(
      rulesFor({
        type: "object",
        properties: {
          typed: { type: "string", const: "x", enum: ["x", "y"] },
          typeless: { const: "x", enum: ["x"] },
        },
      }),
    ).toEqual([
      "gemini: gemini-string-const at /properties/typed",
      "openai: codex-enum-type at /properties/typeless",
      "gemini: gemini-string-const at /properties/typeless",
    ]);
  });

  it("names the position of a nested violation", () => {
    expect(
      rulesFor({
        type: "object",
        properties: { list: { type: "array" } },
      }),
    ).toEqual([
      "openai: codex-array-items at /properties/list",
      "gemini: gemini-array-items at /properties/list",
    ]);
  });

  const nested = { oneOf: [{ type: "string" }, { type: "number" }] };
  it.each([
    ["items", nested, "/items"],
    ["additionalItems", nested, "/additionalItems"],
    ["contains", nested, "/contains"],
    ["additionalProperties", nested, "/additionalProperties"],
    ["unevaluatedProperties", nested, "/unevaluatedProperties"],
    ["unevaluatedItems", nested, "/unevaluatedItems"],
    ["propertyNames", nested, "/propertyNames"],
    ["not", nested, "/not"],
    ["if", nested, "/if"],
    ["then", nested, "/then"],
    ["else", nested, "/else"],
    ["contentSchema", nested, "/contentSchema"],
    ["allOf", [nested], "/allOf/0"],
    ["anyOf", [nested], "/anyOf/0"],
    ["prefixItems", [nested], "/prefixItems/0"],
    ["properties", { a: nested }, "/properties/a"],
    ["patternProperties", { "^a/b": nested }, "/patternProperties/^a~1b"],
    ["$defs", { A: nested }, "/$defs/A"],
    ["definitions", { A: nested }, "/definitions/A"],
    ["dependentSchemas", { a: nested }, "/dependentSchemas/a"],
    ["dependencies", { a: nested, b: ["a"] }, "/dependencies/a"],
  ])("walks into %s", (keyword, value, suffix) => {
    const violations = providerSchemaViolations({
      name: "example-tool",
      inputSchema: {
        type: "object",
        properties: { p: { type: "object", [keyword]: value } },
      },
    }).filter((violation) => violation.rule === "gateway-one-of");

    expect(violations.map((violation) => violation.path)).toEqual([
      `/properties/p${suffix}`,
    ]);
  });
});

describe("template conformance inventory", () => {
  const templates = fs
    .readdirSync(path.join(repoRoot, "templates"))
    .filter((app) =>
      fs.existsSync(path.join(repoRoot, "templates", app, "actions")),
    );

  it("finds the action-bearing templates", () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  it.each(templates)("%s runs the provider-schema spec", (app) => {
    const server = path.join(repoRoot, "templates", app, "server");
    expect(
      ["mcp-provider-schemas.spec.ts", "mcp-provider-schemas.test.ts"].some(
        (file) => fs.existsSync(path.join(server, file)),
      ),
      `templates/${app}/server/mcp-provider-schemas.spec.ts is missing`,
    ).toBe(true);
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
  // The directory catalog is a template's reviewed profile, not a framework one.
  const modes = MCP_CATALOG_MODES.filter((mode) => mode !== "directory");

  it("advertise only schemas that pass every pinned provider rule", async () => {
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
