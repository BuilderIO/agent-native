import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type Tool } from "@modelcontextprotocol/server";
import Ajv2020 from "ajv/dist/2020.js";

import type { ActionEntry } from "../agent/production-agent.js";
import {
  isJsonSchemaObject,
  walkSubschemas,
} from "../json-schema/subschemas.js";
import {
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
} from "../server/action-discovery.js";
import {
  filterAgentTools,
  filterMcpOnlyActions,
} from "../server/agent-chat/action-filters-a2a.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import {
  createMCPServerForRequest,
  selectMcpDirectoryWidgetReadActions,
  selectMcpDirectoryWidgetWriteActions,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";

/**
 * Schema rules a model provider, or the host adapter in front of it, applies
 * to the tool list an MCP host forwards. A host sends every advertised tool on
 * every turn, so one schema a provider rejects fails the whole session, and a
 * schema a host adapter narrows makes valid calls look invalid.
 *
 * Each rule records its basis:
 * - `documented`: the provider's or protocol's published reference says so.
 * - `observed`: a validator returned the quoted error; the date and path are
 *   in the source line. Observed behavior can change without notice.
 * - `host`: a host adapter rewrites the schema before the provider sees it,
 *   and the rewrite would narrow it.
 *
 * Which field each provider receives:
 * - Anthropic: Messages `tools[].input_schema`, as Claude Code sends it.
 * - OpenAI: Responses `tools[]` with `type: "function"` and `strict: false`,
 *   as Codex sends MCP tools (`tool_definition_to_responses_api_tool` in
 *   https://github.com/openai/codex/blob/main/codex-rs/tools/src/responses_api.rs).
 * - Gemini: `functionDeclarations[].parametersJsonSchema`, which Gemini CLI
 *   fills with the MCP `inputSchema` (`parametersJsonSchema:
 *   this.toolDef.inputSchema` in
 *   https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/mcp-client.ts),
 *   not the OpenAPI-subset `parameters` field. The OpenRouter smoke reaches
 *   Gemini through `parameters`, so its results are a diagnostic, not this
 *   field's contract.
 *
 * Gemini documents that in `any` (forced) mode "the API may reject very large
 * or deeply nested schemas"
 * (https://ai.google.dev/gemini-api/docs/function-calling, "Notes and
 * limitations") without a bound. The one cause observed in the template
 * catalogs, `maxItems`, is a rule below; any other the smoke script finds is
 * recorded as its own outcome.
 */
export const SCHEMA_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type SchemaProvider = (typeof SCHEMA_PROVIDERS)[number];

export type ProviderRuleBasis = "documented" | "observed" | "host";

export interface ProviderSchemaRule {
  id: string;
  providers: readonly SchemaProvider[];
  basis: ProviderRuleBasis;
  source: string;
  message: string;
}

const MCP_TOOLS_SPEC =
  "https://modelcontextprotocol.io/specification/2025-11-25/server/tools";

export const PROVIDER_SCHEMA_RULES = {
  anthropicToolName: {
    id: "anthropic-tool-name",
    providers: ["anthropic"],
    basis: "documented",
    source:
      "https://platform.claude.com/docs/en/api/messages/create — tools[].name matches ^[a-zA-Z0-9_-]{1,128}$",
    message: "tool name has characters or a length Anthropic rejects",
  },
  openaiToolName: {
    id: "openai-tool-name",
    providers: ["openai"],
    basis: "documented",
    source:
      "https://platform.openai.com/docs/api-reference/responses/create — function names are a-z, A-Z, 0-9, underscores and dashes, at most 64 characters",
    message: "tool name has characters or a length OpenAI rejects",
  },
  geminiToolName: {
    id: "gemini-tool-name",
    providers: ["gemini"],
    basis: "documented",
    source:
      "https://ai.google.dev/api/generate-content#FunctionDeclaration — a-z, A-Z, 0-9, underscores, colons, dots and dashes, at most 128 characters; the Vertex reference adds that it starts with a letter or underscore",
    message: "tool name has characters or a length Gemini rejects",
  },
  rootObject: {
    id: "root-object",
    providers: SCHEMA_PROVIDERS,
    basis: "documented",
    source:
      'https://modelcontextprotocol.io/specification/2025-11-25/schema#tool — inputSchema has type "object"; https://ai.google.dev/api/generate-content#FunctionDeclaration — parametersJsonSchema "must describe an object where the properties are the parameters"',
    message: 'root type is not "object"',
  },
  draft2020: {
    id: "json-schema-2020-12",
    providers: SCHEMA_PROVIDERS,
    basis: "documented",
    source: `${MCP_TOOLS_SPEC} — a schema without $schema is JSON Schema 2020-12`,
    message: "not a valid JSON Schema 2020-12 document",
  },
  rootComposition: {
    id: "root-composition",
    providers: ["anthropic"],
    basis: "observed",
    source:
      'Anthropic Messages via OpenRouter, 2026-10-07: "input_schema does not support oneOf, allOf, or anyOf at the top level". OpenAI (strict: false) and Gemini accepted the same schema in that run.',
    message: "root uses anyOf, oneOf or allOf",
  },
  gatewayOneOf: {
    id: "gateway-one-of",
    providers: ["openai"],
    basis: "observed",
    source:
      "Builder gateway OpenAI path, recorded at stripUnsupportedSchemaKeywords in action.ts: \"'oneOf' is not permitted\". OpenAI with strict: false accepted it through OpenRouter on 2026-10-07; kept as a floor for gateway-backed hosts.",
    message: "uses oneOf",
  },
  gatewayPropertyNames: {
    id: "gateway-property-names",
    providers: ["openai"],
    basis: "observed",
    source:
      "Builder gateway OpenAI path, recorded at stripUnsupportedSchemaKeywords in action.ts: 400 invalid_function_parameters. OpenAI with strict: false accepted it through OpenRouter on 2026-10-07; kept as a floor for gateway-backed hosts.",
    message: "uses propertyNames",
  },
  gatewayTypeless: {
    id: "gateway-typeless",
    providers: ["openai"],
    basis: "observed",
    source:
      "Builder gateway OpenAI path, recorded at stripUnsupportedSchemaKeywords in action.ts: \"schema must have a 'type' key\". OpenAI with strict: false accepted it through OpenRouter on 2026-10-07; kept as a floor for gateway-backed hosts.",
    message: "schema position has no type",
  },
  codexArrayItems: {
    id: "codex-array-items",
    providers: ["openai"],
    basis: "host",
    source:
      'Codex fills a missing items with { "type": "string" } (ensure_default_children_for_schema_types in https://github.com/openai/codex/blob/main/codex-rs/tools/src/json_schema.rs), which narrows the array',
    message: "array has no items schema",
  },
  geminiArrayItems: {
    id: "gemini-array-items",
    providers: ["gemini"],
    basis: "observed",
    source:
      'Gemini through OpenRouter\'s OpenAPI parameters path, 2026-10-07: "parameters.properties[list].items: missing field". Not yet observed on parametersJsonSchema, the field Gemini CLI fills.',
    message: "array has no items schema",
  },
  codexEnumType: {
    id: "codex-enum-type",
    providers: ["openai"],
    basis: "host",
    source:
      'Codex lowers const to a one-value enum and types a typeless enum as "string" (sanitize_json_schema in https://github.com/openai/codex/blob/main/codex-rs/tools/src/json_schema.rs), which rejects every non-string value',
    message: "enum or const has no explicit type",
  },
  booleanSubschema: {
    id: "boolean-subschema",
    providers: ["openai"],
    basis: "host",
    source:
      'Codex rewrites a boolean schema to { "type": "string" } (sanitize_json_schema in https://github.com/openai/codex/blob/main/codex-rs/tools/src/json_schema.rs); only additionalProperties keeps its boolean',
    message: "boolean subschema outside additionalProperties",
  },
  geminiForcedMaxItems: {
    id: "gemini-forced-max-items",
    providers: ["gemini"],
    basis: "observed",
    source:
      "Gemini through OpenRouter's OpenAPI parameters path, 2026-10-17: a forced call (tool_choice naming the function) returned 400 INVALID_ARGUMENT for 1,000 string items and for 100 of Content's add-database-item property entries, and succeeded once maxItems was removed. The bound depends on the item schema, so no smaller maxItems is safe. Not yet observed on parametersJsonSchema, the field Gemini CLI fills.",
    message: "array declares maxItems, which Gemini's forced mode may refuse",
  },
  geminiStringConst: {
    id: "gemini-string-const",
    providers: ["gemini"],
    basis: "documented",
    source:
      'Gemini\'s Schema has enum but no const field (https://ai.google.dev/api/generate-content#v1beta.Schema), and its JSON Schema support list names enum, not const (https://ai.google.dev/gemini-api/docs/structured-output). Through OpenRouter, 2026-10-17, forced add-database-item calls answered a const "text" discriminator with "STRING", "STATUS" or "string" in 3 of 4 calls, and with "text" in 4 of 4 once it was a one-value enum.',
    message:
      "string const, which Gemini ignores; a one-value enum says the same",
  },
  geminiTypes: {
    id: "gemini-json-types",
    providers: ["gemini"],
    basis: "documented",
    source:
      "https://ai.google.dev/gemini-api/docs/structured-output — the supported JSON Schema types are string, number, integer, boolean, object, array and null",
    message: "type is not one of Gemini's supported JSON Schema types",
  },
} as const satisfies Record<string, ProviderSchemaRule>;

export interface ProviderSchemaViolation {
  provider: SchemaProvider;
  tool: string;
  rule: string;
  message: string;
  path: string;
}

type JsonSchema = Record<string, unknown>;

const TOOL_NAME_RULES = [
  [PROVIDER_SCHEMA_RULES.anthropicToolName, /^[a-zA-Z0-9_-]{1,128}$/],
  [PROVIDER_SCHEMA_RULES.openaiToolName, /^[a-zA-Z0-9_-]{1,64}$/],
  [PROVIDER_SCHEMA_RULES.geminiToolName, /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/],
] as const;

const ROOT_COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;
const TYPE_SUBSTITUTES = [
  "type",
  "anyOf",
  "oneOf",
  "allOf",
  "enum",
  "const",
  "$ref",
] as const;
const GEMINI_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function declaredTypes(schema: JsonSchema): unknown[] {
  if (schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

const draft2020 = new Ajv2020({ strict: false, validateFormats: false });

/** Ajv's reason the schema is not valid draft 2020-12, or undefined. */
function draft2020CompileError(schema: JsonSchema): string | undefined {
  try {
    draft2020.compile(schema);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Every pinned provider rule the tool breaks; empty when all accept it. */
export function providerSchemaViolations(tool: {
  name: string;
  inputSchema: unknown;
}): ProviderSchemaViolation[] {
  const violations: ProviderSchemaViolation[] = [];
  const add = (rule: ProviderSchemaRule, at = "", detail?: string) => {
    for (const provider of rule.providers) {
      violations.push({
        provider,
        tool: tool.name,
        rule: rule.id,
        message: detail ? `${rule.message} (${detail})` : rule.message,
        path: at || "/",
      });
    }
  };

  for (const [rule, pattern] of TOOL_NAME_RULES) {
    if (!pattern.test(tool.name)) add(rule);
  }

  const schema = tool.inputSchema;
  if (!isJsonSchemaObject(schema)) {
    add(PROVIDER_SCHEMA_RULES.rootObject, "", "input schema is not an object");
    return violations;
  }
  if (schema.type !== "object") add(PROVIDER_SCHEMA_RULES.rootObject);
  if (ROOT_COMPOSITIONS.some((keyword) => keyword in schema)) {
    add(PROVIDER_SCHEMA_RULES.rootComposition);
  }
  const compileError = draft2020CompileError(schema);
  if (compileError) add(PROVIDER_SCHEMA_RULES.draft2020, "", compileError);

  walkSubschemas(schema, (node, at, keyword) => {
    if (typeof node === "boolean") {
      if (keyword !== "additionalProperties") {
        add(PROVIDER_SCHEMA_RULES.booleanSubschema, at);
      }
      return;
    }
    if ("oneOf" in node) add(PROVIDER_SCHEMA_RULES.gatewayOneOf, at);
    if ("propertyNames" in node) {
      add(PROVIDER_SCHEMA_RULES.gatewayPropertyNames, at);
    }
    if (!TYPE_SUBSTITUTES.some((key) => node[key] !== undefined)) {
      add(PROVIDER_SCHEMA_RULES.gatewayTypeless, at);
    }
    if (
      (node.enum !== undefined || node.const !== undefined) &&
      node.type === undefined
    ) {
      add(PROVIDER_SCHEMA_RULES.codexEnumType, at);
    }
    if (node.maxItems !== undefined) {
      add(PROVIDER_SCHEMA_RULES.geminiForcedMaxItems, at);
    }
    if (typeof node.const === "string") {
      add(PROVIDER_SCHEMA_RULES.geminiStringConst, at);
    }
    const types = declaredTypes(node);
    if (types.includes("array") && node.items === undefined) {
      add(PROVIDER_SCHEMA_RULES.codexArrayItems, at);
      add(PROVIDER_SCHEMA_RULES.geminiArrayItems, at);
    }
    const unsupported = types.filter(
      (type) => typeof type !== "string" || !GEMINI_TYPES.has(type),
    );
    if (unsupported.length > 0) {
      add(PROVIDER_SCHEMA_RULES.geminiTypes, at, JSON.stringify(unsupported));
    }
  });
  return violations;
}

export const MCP_CATALOG_MODES = [
  "default",
  "full",
  "app",
  "oauth-read",
  "directory",
] as const;
export type McpCatalogMode = (typeof MCP_CATALOG_MODES)[number];

export interface McpDirectoryProfileFixture {
  connectorCatalog: string[];
  widgetDomain?: string;
  [key: string]: unknown;
}

/**
 * Where a template keeps its ChatGPT directory profile. The conformance
 * helpers find it here, so a template that adds one gets its directory
 * catalog checked without editing its spec.
 */
export const DIRECTORY_PROFILE_MODULE = "server/lib/chatgpt-directory-tools.ts";

/** The catalog modes a template serves: directory only with a profile. */
export function templateMcpCatalogModes(projectRoot: string): McpCatalogMode[] {
  const hasProfile = existsSync(
    path.join(projectRoot, DIRECTORY_PROFILE_MODULE),
  );
  return MCP_CATALOG_MODES.filter((mode) => mode !== "directory" || hasProfile);
}

const CONFORMANCE_IDENTITY: MCPCallerIdentity = {
  userEmail: "conformance@example.com",
  orgId: null,
  orgDomain: undefined,
};

/**
 * Lists the tools one catalog mode advertises, through the same `tools/list`
 * handler a host calls. The modes mirror how a request selects its catalog:
 * the compact default, `--full-catalog` on the full action surface,
 * `catalogMode: "app"`, a full-catalog OAuth token limited to `mcp:read`, and
 * the reviewed directory profile.
 */
export async function listMcpCatalogTools(
  base: MCPConfig,
  mode: McpCatalogMode,
  directoryProfile?: McpDirectoryProfileFixture,
  directoryActions: Record<string, ActionEntry> = base.actions,
): Promise<Tool[]> {
  let config: MCPConfig = base;
  let identity: MCPCallerIdentity | undefined;
  let requestMeta: MCPRequestMeta = { transport: "http" };
  if (mode === "full") {
    requestMeta = { ...requestMeta, fullCatalog: true, fullSurface: true };
  } else if (mode === "app") {
    config = { ...base, catalogMode: "app" };
  } else if (mode === "oauth-read") {
    identity = { ...CONFORMANCE_IDENTITY, oauthScopes: ["mcp:read"] };
    requestMeta = { ...requestMeta, fullCatalog: true, fullSurface: true };
  } else if (mode === "directory") {
    if (!directoryProfile) {
      throw new Error(`${base.name} has no directory profile to list.`);
    }
    config = {
      ...base,
      catalogMode: "directory",
      directoryProfile: directoryProfile as MCPConfig["directoryProfile"],
      connectorCatalog: directoryProfile.connectorCatalog,
      widgetDomain: directoryProfile.widgetDomain,
      widgetReadActions: selectMcpDirectoryWidgetReadActions(
        directoryProfile as MCPConfig["directoryProfile"],
        directoryActions,
      ),
      widgetWriteActions: selectMcpDirectoryWidgetWriteActions(
        directoryProfile as MCPConfig["directoryProfile"],
        directoryActions,
      ),
    };
  }

  const server = await createMCPServerForRequest(config, identity, requestMeta);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "provider-conformance", version: "1" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...(page.tools as Tool[]));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
  }
}

type ImportModule = (file: string) => Promise<unknown>;

const importFile: ImportModule = (file) =>
  import(/* @vite-ignore */ pathToFileURL(file).href);

/**
 * The action surface a template serves to external agents: its own actions
 * plus the framework's sharing and review kits, filtered the way the agent
 * chat plugin filters them. Discovery predicates are dropped so every tool
 * that some caller could be shown is checked.
 *
 * `importModule` loads the generated registry; callers outside the template's
 * own Vitest run pass a loader that applies the template's path aliases.
 */
export async function loadTemplateMcpActions(
  projectRoot: string,
  importModule: ImportModule = importFile,
): Promise<Record<string, ActionEntry>> {
  const actions = await loadTemplateActionEntries(projectRoot, importModule);
  return withoutDiscoveryPredicates({
    ...filterMcpOnlyActions(actions),
    ...filterAgentTools(actions),
  });
}

async function loadTemplateActionEntries(
  projectRoot: string,
  importModule: ImportModule,
): Promise<Record<string, ActionEntry>> {
  generateActionRegistryForProject(projectRoot);
  const registry = (await importModule(
    path.join(projectRoot, ".generated/actions-registry.ts"),
  )) as { default?: Record<string, unknown> };
  const modules = registry.default ?? (registry as Record<string, unknown>);
  const actions = loadActionsFromStaticRegistry(modules);
  if (Object.keys(actions).length === 0) {
    throw new Error(`${projectRoot} registered no actions.`);
  }
  // The registry loader drops each action's own input schema; keep it so a
  // caller can check arguments against the schema the handler enforces.
  for (const [name, entry] of Object.entries(actions)) {
    const module = modules[name] as
      | { schema?: unknown; default?: { schema?: unknown } }
      | undefined;
    const schema = module?.default?.schema ?? module?.schema;
    if (schema !== undefined) entry.schema = schema;
  }
  await mergeCoreSharingActions(actions);
  return actions;
}

/** The template's directory profile, or undefined when it has none. */
export async function loadTemplateDirectoryProfile(
  projectRoot: string,
  importModule: ImportModule = importFile,
): Promise<McpDirectoryProfileFixture | undefined> {
  const file = path.join(projectRoot, DIRECTORY_PROFILE_MODULE);
  if (!existsSync(file)) return undefined;
  const module = (await importModule(file)) as {
    CHATGPT_DIRECTORY_PROFILE?: McpDirectoryProfileFixture;
  };
  if (!module.CHATGPT_DIRECTORY_PROFILE) {
    throw new Error(
      `${file} must export CHATGPT_DIRECTORY_PROFILE for its directory catalog to be checked.`,
    );
  }
  return module.CHATGPT_DIRECTORY_PROFILE;
}

export interface TemplateMcpConformance {
  appId: string;
  actions: Record<string, ActionEntry>;
  modes: McpCatalogMode[];
  listCatalog(mode: McpCatalogMode): Promise<Tool[]>;
}

/**
 * Everything a template's provider-schema spec needs: its MCP config and
 * directory profile, loaded once, and a lister for each catalog it serves.
 */
export async function loadTemplateMcpConformance(
  projectRoot: string,
  importModule: ImportModule = importFile,
): Promise<TemplateMcpConformance> {
  const appId = path.basename(projectRoot);
  const directoryActions = await loadTemplateActionEntries(
    projectRoot,
    importModule,
  );
  const actions = withoutDiscoveryPredicates({
    ...filterMcpOnlyActions(directoryActions),
    ...filterAgentTools(directoryActions),
  });
  const config = conformanceMcpConfig(appId, actions);
  const profile = await loadTemplateDirectoryProfile(projectRoot, importModule);
  return {
    appId,
    actions,
    modes: templateMcpCatalogModes(projectRoot),
    listCatalog: (mode) =>
      listMcpCatalogTools(config, mode, profile, directoryActions),
  };
}

export function withoutDiscoveryPredicates(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => {
      const { agentDiscoveryAvailable: _available, ...rest } = entry;
      return [name, rest as ActionEntry];
    }),
  );
}

export function conformanceMcpConfig(
  appId: string,
  actions: Record<string, ActionEntry>,
): MCPConfig {
  return {
    name: appId,
    appId,
    description: `${appId} provider conformance`,
    actions,
    productionActions: actions,
    builtinCrossAppTools: true,
    askAgent: async () => "",
  };
}
