import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type Tool } from "@modelcontextprotocol/server";
import Ajv2020 from "ajv/dist/2020.js";

import type { ActionEntry } from "../agent/production-agent.js";
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
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";

/**
 * Schema rules each model provider enforces on the tool list an MCP host
 * forwards to it. A host sends every advertised tool on every turn, so one
 * schema a provider rejects fails the whole session, not just that tool.
 *
 * Each rule is pinned to a documented restriction or to a validator error the
 * provider returned verbatim. Sources, checked 2026-10-06:
 *
 * Anthropic Messages `tools[].input_schema`
 * - https://platform.claude.com/docs/en/api/messages/create — `name` matches
 *   `^[a-zA-Z0-9_-]{1,128}$`; `input_schema` is a draft 2020-12 JSON Schema
 *   whose `type` is `"object"`.
 * - https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
 * - Validator error: "input_schema does not support oneOf, allOf, or anyOf at
 *   the top level".
 *
 * OpenAI Responses `tools[]` with `type: "function"` and `strict: false`, the
 * shape Codex sends MCP tools in
 * - https://developers.openai.com/api/docs/guides/function-calling — the root
 *   must be `type: "object"`; `strict: false` keeps best-effort validation.
 * - https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
 *   — "the root level object of a schema must be an object, and not use
 *   anyOf".
 * - https://platform.openai.com/docs/api-reference/chat/create — function
 *   names are a-z, A-Z, 0-9, underscores and dashes, at most 64 characters.
 * - Validator errors measured in non-strict mode (see
 *   `stripUnsupportedSchemaKeywords` in `action.ts`): "'oneOf' is not
 *   permitted", "schema must have a 'type' key", `propertyNames` rejected,
 *   "array schema missing items".
 *
 * Gemini `functionDeclarations[]`
 * - https://ai.google.dev/api/generate-content#FunctionDeclaration — names are
 *   a-z, A-Z, 0-9, underscores, colons, dots and dashes, at most 128
 *   characters, and (Vertex reference) start with a letter or underscore.
 * - https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/FunctionDeclaration
 *   — `parametersJsonSchema` "must describe an object where the properties
 *   are the parameters to the function".
 */
export const SCHEMA_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type SchemaProvider = (typeof SCHEMA_PROVIDERS)[number];

export interface ProviderSchemaViolation {
  provider: SchemaProvider;
  tool: string;
  rule: string;
  path: string;
}

type JsonSchema = Record<string, unknown>;

const TOOL_NAME_PATTERNS: Record<SchemaProvider, RegExp> = {
  anthropic: /^[a-zA-Z0-9_-]{1,128}$/,
  openai: /^[a-zA-Z0-9_-]{1,64}$/,
  gemini: /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/,
};

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
const SUBSCHEMA_KEYS = [
  "items",
  "additionalProperties",
  "contains",
  "not",
] as const;
const SUBSCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;
const SUBSCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
] as const;

function isSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function visitSubschemas(
  schema: JsonSchema,
  at: string,
  visit: (node: JsonSchema, at: string) => void,
): void {
  visit(schema, at);
  for (const key of SUBSCHEMA_KEYS) {
    const value = schema[key];
    if (isSchema(value)) visitSubschemas(value, `${at}.${key}`, visit);
  }
  for (const key of SUBSCHEMA_LIST_KEYS) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    value.forEach((branch, index) => {
      if (isSchema(branch)) {
        visitSubschemas(branch, `${at}.${key}[${index}]`, visit);
      }
    });
  }
  for (const key of SUBSCHEMA_MAP_KEYS) {
    const value = schema[key];
    if (!isSchema(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      if (isSchema(child))
        visitSubschemas(child, `${at}.${key}.${name}`, visit);
    }
  }
}

function declaresType(schema: JsonSchema, type: string): boolean {
  return Array.isArray(schema.type)
    ? schema.type.includes(type)
    : schema.type === type;
}

const draft2020 = new Ajv2020({ strict: false, validateFormats: false });

function compilesAsDraft2020(schema: JsonSchema): boolean {
  try {
    draft2020.compile(schema);
    return true;
  } catch {
    return false;
  }
}

/** Every pinned provider rule the tool breaks; empty when all accept it. */
export function providerSchemaViolations(tool: {
  name: string;
  inputSchema: unknown;
}): ProviderSchemaViolation[] {
  const violations: ProviderSchemaViolation[] = [];
  const add = (providers: SchemaProvider[], rule: string, at = "$") => {
    for (const provider of providers) {
      violations.push({ provider, tool: tool.name, rule, path: at });
    }
  };

  for (const provider of SCHEMA_PROVIDERS) {
    if (!TOOL_NAME_PATTERNS[provider].test(tool.name)) {
      add(
        [provider],
        "tool name has characters or a length the provider rejects",
      );
    }
  }

  const schema = tool.inputSchema;
  if (!isSchema(schema)) {
    add([...SCHEMA_PROVIDERS], "input schema is not an object");
    return violations;
  }
  if (schema.type !== "object") {
    add([...SCHEMA_PROVIDERS], 'root type is not "object"');
  }
  for (const keyword of ROOT_COMPOSITIONS) {
    if (keyword in schema) {
      add(["anthropic", "openai"], `root uses ${keyword}`);
    }
  }
  if (!compilesAsDraft2020(schema)) {
    add(["anthropic"], "not a valid draft 2020-12 JSON Schema");
  }

  visitSubschemas(schema, "$", (node, at) => {
    if ("oneOf" in node) add(["openai"], "uses oneOf", at);
    if ("propertyNames" in node) add(["openai"], "uses propertyNames", at);
    if (!TYPE_SUBSTITUTES.some((key) => node[key] !== undefined)) {
      add(["openai"], "schema position has no type", at);
    }
    if (declaresType(node, "array") && node.items === undefined) {
      add(["openai"], "array has no items schema", at);
    }
  });
  return violations;
}

export type McpCatalogMode =
  | "default"
  | "full"
  | "app"
  | "oauth-read"
  | "directory";

export interface McpDirectoryProfileFixture {
  connectorCatalog: string[];
  widgetDomain?: string;
  [key: string]: unknown;
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
  importModule: (file: string) => Promise<unknown> = (file) =>
    import(/* @vite-ignore */ pathToFileURL(file).href),
): Promise<Record<string, ActionEntry>> {
  generateActionRegistryForProject(projectRoot);
  const registry = (await importModule(
    path.join(projectRoot, ".generated/actions-registry.ts"),
  )) as { default?: Record<string, unknown> };
  const actions = loadActionsFromStaticRegistry(
    registry.default ?? (registry as Record<string, unknown>),
  );
  if (Object.keys(actions).length === 0) {
    throw new Error(`${projectRoot} registered no actions.`);
  }
  await mergeCoreSharingActions(actions);
  return withoutDiscoveryPredicates({
    ...filterMcpOnlyActions(actions),
    ...filterAgentTools(actions),
  });
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
