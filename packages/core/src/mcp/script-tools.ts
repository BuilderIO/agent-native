import type { HostFunctions, Runner, RunError as RunErrorClass } from "run";

import { isMcpReadOnlyTool } from "../action-call-classification.js";
import { runOutsideActionInvocation } from "../action-frame.js";
import { type ActionRunContext, semanticInputSchema } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { describeThrownForLog, redactEmbedText } from "./embed-redaction.js";
import {
  type McpActionCallOutcome,
  redactEmbedCredentials,
  toJsonData,
} from "./execute-action-call.js";

/**
 * MCP script tools, reads only. A connection that opts into the script
 * catalog sees two tools: `search-actions`, which returns TypeScript
 * declarations for the app's scriptable actions, and `run-script`, which runs
 * model-written JavaScript in a fresh QuickJS context whose only capability is
 * calling those actions.
 *
 * Every call a script makes goes through `executeMcpActionCall`, the same
 * scope, service-grant, approval and redaction steps as a direct `tools/call`,
 * and the guest receives that call's full redacted value. What a script may
 * call is decided here, independently of what the connection's catalog lists:
 * an action must declare `mcpScript: "read"`, be read-only by
 * `isMcpReadOnlyTool`, ask for no approval, and not run other code or agents.
 */

export const MCP_SCRIPT_RUN_TOOL = "run-script";
export const MCP_SCRIPT_SEARCH_TOOL = "search-actions";
export const MCP_SCRIPT_TOOL_NAMES: ReadonlySet<string> = new Set([
  MCP_SCRIPT_RUN_TOOL,
  MCP_SCRIPT_SEARCH_TOOL,
]);

/** Limits on one script run, and on runs in one process. */
export const MCP_SCRIPT_LIMITS = Object.freeze({
  /** The model's code, before the prelude this module adds. */
  sourceBytes: 64 * 1024,
  memoryBytes: 64 * 1024 * 1024,
  timeoutMs: 30_000,
  /** Calls a script may make, counting denied and failed ones. */
  calls: 64,
  /** Calls a script may have started and not yet settled. */
  inFlightCalls: 8,
  /** The JSON bytes of every value delivered into the script, summed. */
  readBytes: 8 * 1024 * 1024,
  /** The JSON bytes of one value delivered into the script. */
  callResultBytes: 3 * 1024 * 1024,
  /** Characters of console output kept, each line's newline included;
   *  later lines are counted, not kept. */
  logChars: 16_000,
  /** Lines of console output kept. */
  logLines: 1_000,
  /** Characters of the value a script returns, as the server copies it out
   *  of the sandbox, where a part the value repeats counts each time. */
  returnChars: 4 * 1024 * 1024,
  /** The same for the arguments of one call. */
  argumentChars: 1024 * 1024,
  /** Characters of the text `run-script` returns. */
  resultChars: 30_000,
  /** Scripts running at once in this process; another gets a busy error. */
  concurrentRuns: 4,
  /** Calls still running from scripts that stopped and gave their slot
   *  back; at this many, another script gets a busy error until some settle.
   *  A stopped run whose calls would pass it keeps its slot instead. */
  lingeringCalls: 32,
});

/**
 * Tools that run other code, other tools or an agent. A script that reached
 * one could do whatever it does on the caller's behalf inside a single
 * read-only tool result, so these are refused by name whatever they declare.
 */
const NESTED_EXECUTORS: ReadonlySet<string> = new Set([
  MCP_SCRIPT_RUN_TOOL,
  MCP_SCRIPT_SEARCH_TOOL,
  "run-code",
  "tool-orchestration",
  "get-code-execution",
  "tool-search",
  "call-agent",
  "ask-agent",
  "ask_app",
  "ask_app_status",
  "open_app",
  "list_apps",
  "create_embed_session",
]);

export type McpScriptDenialReason =
  | "nested-executor"
  | "not-opted-in"
  | "mutating"
  | "needs-approval"
  | "out-of-scope"
  | "name-collision"
  | "unknown-function";

const DENIAL_MESSAGES: Record<McpScriptDenialReason, string> = {
  "nested-executor":
    "runs other code, tools or an agent, so scripts cannot call it",
  "not-opted-in": "is not available to scripts",
  mutating: "can change data, so scripts cannot call it",
  "needs-approval":
    "asks for approval or is consequential, so scripts cannot call it",
  "out-of-scope": "is outside what this connection may call",
  "name-collision":
    "shares its script function name with another action, so neither is available",
  "unknown-function": "is not an action this script can call",
};

export type McpScriptCallPolicy =
  | { allowed: true }
  | { allowed: false; reason: McpScriptDenialReason };

/**
 * Whether a script may call this action at all, before any per-caller scope.
 * The declaration is read last, so it can never loosen the action's real
 * classification: an entry built by hand that declares `mcpScript: "read"`
 * on a write is still refused.
 */
export function mcpScriptCallPolicy(
  name: string,
  entry: ActionEntry,
): McpScriptCallPolicy {
  if (NESTED_EXECUTORS.has(name)) {
    return { allowed: false, reason: "nested-executor" };
  }
  if (entry.mcpScript !== "read") {
    return { allowed: false, reason: "not-opted-in" };
  }
  if (!isMcpReadOnlyTool(entry)) {
    return { allowed: false, reason: "mutating" };
  }
  if (
    (entry.needsApproval !== undefined && entry.needsApproval !== false) ||
    entry.publicAgent?.isConsequential === true
  ) {
    return { allowed: false, reason: "needs-approval" };
  }
  return { allowed: true };
}

/** `get-document` → `getDocument`; a leading digit gets an underscore. */
export function mcpScriptFunctionName(actionName: string): string {
  return actionName
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
      next ? next.toUpperCase() : "",
    )
    .replace(/^[0-9]/, (digit) => `_${digit}`);
}

/** What one request's scripts may call, and the actions left out by name. */
export interface McpScriptCatalog {
  /** Function name to action name, for callable actions only. */
  readonly byFunction: ReadonlyMap<string, string>;
  /** The callable actions, by action name. */
  readonly actions: Readonly<Record<string, ActionEntry>>;
  /** Allowed actions left out because their function names collide. */
  readonly collisions: ReadonlyMap<string, readonly string[]>;
}

/**
 * The scriptable subset of `reachable`, which must already be what this
 * caller may reach: OAuth scope, discovery, the operator's deny list and the
 * service grant applied. Two actions whose function names collide are both
 * left out and reported, so a script never calls one meaning the other.
 */
export function buildMcpScriptCatalog(
  reachable: Record<string, ActionEntry>,
): McpScriptCatalog {
  const byName = new Map<string, Array<[string, ActionEntry]>>();
  for (const [name, entry] of Object.entries(reachable)) {
    if (!mcpScriptCallPolicy(name, entry).allowed) continue;
    const fn = mcpScriptFunctionName(name);
    if (!fn) continue;
    byName.set(fn, [...(byName.get(fn) ?? []), [name, entry]]);
  }
  const byFunction = new Map<string, string>();
  const collisions = new Map<string, string[]>();
  const actions: Record<string, ActionEntry> = Object.create(null);
  for (const [fn, named] of [...byName].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (named.length > 1) {
      collisions.set(fn, named.map(([name]) => name).sort());
      continue;
    }
    for (const [name, entry] of named) {
      byFunction.set(fn, name);
      actions[name] = entry;
    }
  }
  return Object.freeze({
    byFunction,
    actions: Object.freeze(actions),
    collisions,
  });
}

/**
 * Why a script's call to `functionName` is refused. `known` is every action
 * the caller could call directly, so a refusal can say "not available to
 * scripts" rather than "unknown" for an action the caller can already see
 * but not script. Any other name is unknown, as it would be to a direct call.
 */
export function explainMcpScriptDenial(
  functionName: string,
  catalog: McpScriptCatalog,
  known: Record<string, ActionEntry>,
): { action: string | undefined; reason: McpScriptDenialReason } {
  const collided = catalog.collisions.get(functionName);
  if (collided) return { action: collided[0], reason: "name-collision" };
  const named = Object.entries(known).filter(
    ([name]) => mcpScriptFunctionName(name) === functionName,
  );
  for (const [name, entry] of named) {
    const policy = mcpScriptCallPolicy(name, entry);
    if (!policy.allowed) return { action: name, reason: policy.reason };
  }
  const first = named.at(0);
  return first === undefined
    ? { action: undefined, reason: "unknown-function" }
    : { action: first[0], reason: "out-of-scope" };
}

/** The catalog's entry for `action`, if the catalog has one. */
function scriptCatalogEntry(
  catalog: McpScriptCatalog,
  action: string,
): ActionEntry | undefined {
  return Object.hasOwn(catalog.actions, action)
    ? catalog.actions[action]
    : undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A schema `search-actions` cannot turn into a TypeScript type. */
export class McpScriptTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpScriptTypeError";
  }
}

const MAX_TYPE_DEPTH = 32;
const PROPERTY_DESCRIPTION_CHARS = 200;
const ACTION_DESCRIPTION_CHARS = 400;
const INDEX_DESCRIPTION_CHARS = 110;

const CONSTRAINT_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "default",
] as const;

interface TypeScope {
  root: unknown;
  refs: string[];
}

function oneLine(text: unknown, max: number): string {
  const flat = (typeof text === "string" ? text : "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Text safe inside a `/** … *\/` comment. */
function commentText(text: string): string {
  return text.replace(/\*\//g, "*\\/");
}

function tsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveLocalRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) {
    throw new McpScriptTypeError(
      `references ${JSON.stringify(ref)} outside its own schema`,
    );
  }
  const pointer = ref.slice(1);
  if (pointer !== "" && !pointer.startsWith("/")) {
    throw new McpScriptTypeError(
      `uses the anchor reference ${JSON.stringify(ref)}, which is not supported`,
    );
  }
  let node: unknown = root;
  for (const raw of pointer.split("/").slice(1)) {
    const segment = decodeURIComponent(raw)
      .replace(/~1/g, "/")
      .replace(/~0/g, "~");
    if (!node || typeof node !== "object" || !Object.hasOwn(node, segment)) {
      throw new McpScriptTypeError(
        `references ${JSON.stringify(ref)}, which does not resolve`,
      );
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function constraintsOf(schema: unknown): string {
  if (!isSchemaObject(schema)) return "";
  const parts = CONSTRAINT_KEYS.filter(
    (key) =>
      schema[key] !== undefined &&
      !(key === "maximum" && schema[key] === Number.MAX_SAFE_INTEGER),
  ).map((key) => `${key} ${JSON.stringify(schema[key])}`);
  return parts.length ? `(${parts.join(", ")})` : "";
}

/**
 * Whether `type` joins members with `|` or `&` outside any brackets,
 * string or comment, so it needs parentheses inside another union,
 * intersection or array.
 */
function hasTopLevelOperator(type: string): boolean {
  let depth = 0;
  for (let index = 0; index < type.length; index += 1) {
    const char = type[index];
    if (char === '"') {
      // A JSON string: skip to its closing quote.
      for (index += 1; index < type.length && type[index] !== '"'; index += 1) {
        if (type[index] === "\\") index += 1;
      }
    } else if (char === "/" && type[index + 1] === "*") {
      const end = type.indexOf("*/", index + 2);
      index = end === -1 ? type.length : end + 1;
    } else if (char === "{" || char === "[" || char === "(" || char === "<") {
      depth += 1;
    } else if (char === "}" || char === "]" || char === ")" || char === ">") {
      depth -= 1;
    } else if (depth === 0 && (char === "|" || char === "&")) {
      return true;
    }
  }
  return false;
}

/**
 * JSON text for JSON data. `JSON.stringify` returns undefined for
 * undefined, though its type says string, so that reads as `null`.
 */
function jsonText(value: unknown): string {
  return value === undefined ? "null" : JSON.stringify(value);
}

function parenthesize(type: string): string {
  return hasTopLevelOperator(type) ? `(${type})` : type;
}

const COMPOSITION_KEYS = new Set(["anyOf", "oneOf", "allOf", "$ref"]);
const STRUCTURAL_KEYS = [
  "type",
  "properties",
  "items",
  "prefixItems",
  "enum",
  "const",
  "additionalProperties",
] as const;

function schemaType(
  schema: unknown,
  scope: TypeScope,
  depth: number,
  indent: string,
): string {
  if (depth > MAX_TYPE_DEPTH) {
    throw new McpScriptTypeError(`nests deeper than ${MAX_TYPE_DEPTH} levels`);
  }
  if (schema === false) return "never";
  if (!isSchemaObject(schema)) return "unknown";

  const parts: string[] = [];
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (scope.refs.includes(ref)) {
      throw new McpScriptTypeError(
        `refers to itself through ${JSON.stringify(ref)}`,
      );
    }
    const target = resolveLocalRef(scope.root, ref);
    scope.refs.push(ref);
    try {
      parts.push(schemaType(target, scope, depth + 1, indent));
    } finally {
      scope.refs.pop();
    }
  } else if (schema.$ref !== undefined) {
    throw new McpScriptTypeError("has a $ref that is not a string");
  }
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      parts.push(parenthesize(schemaType(member, scope, depth + 1, indent)));
    }
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const union = schema[keyword];
    if (!Array.isArray(union)) continue;
    if (union.length === 0) return "never";
    const members = [
      ...new Set(
        union.map((member) => schemaType(member, scope, depth + 1, indent)),
      ),
    ];
    const joined = members.join(" | ");
    parts.push(members.length === 1 ? joined : `(${joined})`);
  }
  if (STRUCTURAL_KEYS.some((key) => schema[key] !== undefined)) {
    const base = Object.fromEntries(
      Object.entries(schema).filter(([key]) => !COMPOSITION_KEYS.has(key)),
    );
    parts.unshift(structuralType(base, scope, depth, indent));
  }
  const type =
    parts.length === 0
      ? "unknown"
      : (parts.length === 1 ? parts : parts.map(parenthesize)).join(" & ");
  return schema.nullable === true ? `${parenthesize(type)} | null` : type;
}

function structuralType(
  schema: Record<string, unknown>,
  scope: TypeScope,
  depth: number,
  indent: string,
): string {
  if ("const" in schema) {
    return schema.const === undefined ? "unknown" : jsonText(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.length === 0
      ? "never"
      : schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((member) =>
        structuralType({ ...schema, type: member }, scope, depth, indent),
      )
      .join(" | ");
  }
  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const element =
        schema.items === undefined
          ? "unknown"
          : schemaType(schema.items, scope, depth + 1, indent);
      if (Array.isArray(schema.prefixItems)) {
        // A position past `minItems` may be missing.
        const required =
          typeof schema.minItems === "number" ? schema.minItems : 0;
        const head = schema.prefixItems.map((member, index) => {
          const type = schemaType(member, scope, depth + 1, indent);
          return index < required ? type : `${parenthesize(type)}?`;
        });
        return schema.items === false
          ? `[${head.join(", ")}]`
          : `[${[...head, `...${parenthesize(element)}[]`].join(", ")}]`;
      }
      return `Array<${element}>`;
    }
    case "object":
    case undefined:
      return objectType(schema, scope, depth, indent);
    default:
      return "unknown";
  }
}

function objectType(
  schema: Record<string, unknown>,
  scope: TypeScope,
  depth: number,
  indent: string,
): string {
  const properties = isSchemaObject(schema.properties)
    ? schema.properties
    : undefined;
  const extra = schema.additionalProperties;
  if (!properties || Object.keys(properties).length === 0) {
    if (extra === false) return "{}";
    return isSchemaObject(extra)
      ? `Record<string, ${schemaType(extra, scope, depth + 1, indent)}>`
      : "Record<string, unknown>";
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === "string")
      : [],
  );
  const inner = `${indent}  `;
  const lines = Object.entries(properties).map(([key, value]) => {
    const note = [
      oneLine(
        isSchemaObject(value) ? value.description : undefined,
        PROPERTY_DESCRIPTION_CHARS,
      ),
      constraintsOf(value),
    ]
      .filter(Boolean)
      .join(" ");
    const comment = note ? `${inner}/** ${commentText(note)} */\n` : "";
    const optional = required.has(key) ? "" : "?";
    return `${comment}${inner}${tsKey(key)}${optional}: ${schemaType(value, scope, depth + 1, inner)};`;
  });
  if (isSchemaObject(extra) || extra === true) {
    lines.push(`${inner}[key: string]: unknown;`);
  }
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/**
 * The TypeScript type of a JSON Schema: unions keep their branches, every
 * member of an `allOf` joins the intersection, and a local `$ref` resolves.
 * A reference outside the schema, one that does not resolve, or one that
 * refers to itself throws `McpScriptTypeError` instead of widening to `any`.
 */
export function mcpScriptSchemaType(schema: unknown, indent = ""): string {
  return schemaType(schema, { root: schema, refs: [] }, 0, indent);
}

function typeOrReason(
  schema: unknown,
  indent: string,
): { type: string } | { reason: string } {
  try {
    return { type: mcpScriptSchemaType(schema, indent) };
  } catch (error) {
    if (error instanceof McpScriptTypeError) return { reason: error.message };
    return { reason: `could not be read (${describeThrownForLog(error)})` };
  }
}

/**
 * The declaration of one script function. Input types come from the action's
 * own input schema, not the flattened one MCP advertises, so a union keeps its
 * branches. The output is typed only when the action's `outputSchema` was
 * audited for MCP (`mcpOutputSchema: true`); any other result is `unknown`.
 */
export function mcpScriptDeclaration(
  actionName: string,
  entry: ActionEntry,
): string {
  const fn = mcpScriptFunctionName(actionName);
  const notes: string[] = [];
  // The action's own schema says what it accepts. Its parameters are the
  // copy providers are shown, with what they reject taken out.
  const parameters =
    semanticInputSchema(entry.agentInputSchema ?? entry.schema) ??
    entry.tool.parameters;
  const input =
    parameters === undefined ? { type: "{}" } : typeOrReason(parameters, "  ");
  if ("reason" in input)
    notes.push(`input types unavailable: the schema ${input.reason}`);
  const semantic = entry.mcpOutputContract?.semantic;
  const output = semantic
    ? typeOrReason(semantic, "  ")
    : { reason: "" as const };
  if ("reason" in output && output.reason) {
    notes.push(`result type unavailable: the schema ${output.reason}`);
  }
  const description = oneLine(entry.tool.description, ACTION_DESCRIPTION_CHARS);
  return [
    `  /** ${commentText(description)} (tool "${actionName}") */`,
    ...notes.map((note) => `  // ${note}`),
    `  ${tsKey(fn)}: (args: ${"type" in input ? input.type : "Record<string, unknown>"}) => Promise<${"type" in output ? output.type : "unknown"}>;`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tool descriptors and search
// ---------------------------------------------------------------------------

/** The server instructions a script-catalog connection gets. */
export function mcpScriptInstructions(): string {
  return [
    `This connection reads the app with two tools. Call ${MCP_SCRIPT_SEARCH_TOOL} with the functions you plan to use to get their exact TypeScript declarations, then call ${MCP_SCRIPT_RUN_TOOL} with JavaScript that awaits those \`api\` functions and returns only what you need.`,
    "Each call in a script runs as you, with the same access checks as calling the action directly. Scripts can only read: this connection cannot change data.",
  ].join(" ");
}

/**
 * Whether an action a script can call says it reaches outside the app, read
 * as the direct catalog reads it: its own annotations, else its defaults.
 */
function reachesOpenWorld(catalog: McpScriptCatalog): boolean {
  return Object.values(catalog.actions).some(
    (entry) =>
      (entry.mcpAnnotations ?? entry.mcpAnnotationDefaults)?.openWorldHint ===
      true,
  );
}

/** The two tools a script-catalog connection sees, in catalog order. */
export function mcpScriptToolDescriptors(catalog: McpScriptCatalog): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}> {
  const index = [...catalog.byFunction]
    .map(
      ([fn, action]) =>
        `- api.${fn}: ${oneLine(catalog.actions[action]?.tool.description, INDEX_DESCRIPTION_CHARS)}`,
    )
    .join("\n");
  const limits = MCP_SCRIPT_LIMITS;
  return [
    {
      name: MCP_SCRIPT_RUN_TOOL,
      description: [
        "Run JavaScript that reads this app's data by calling its actions as async functions on `api`, all in one tool call. Use it to look things up, loop over results and join them without a model round trip per step, and return only what you need.",
        "The code is the body of an async function: use `await`, then `return` a value. `console.log`, `info`, `warn`, `error` and `debug` output comes back as `logs`.",
        "Each `api` call resolves to the action's full result, with the same identity, access checks and redaction as calling it directly. A refused or failed call throws an Error with `code` and `message`; catch it to carry on. The result lists every call the script made.",
        `Limits: ${limits.calls} calls, ${limits.inFlightCalls} at once, ${limits.readBytes / (1024 * 1024)} MB of results, ${limits.timeoutMs / 1000} s, ${limits.sourceBytes / 1024} KB of code. No network, files, timers or imports. Scripts can only read; call other tools directly. BigInt values come back as strings ending in "n".`,
        `Call ${MCP_SCRIPT_SEARCH_TOOL} for exact argument and result types.`,
        catalog.byFunction.size > 0
          ? `Functions:\n${index}`
          : "No actions are available to scripts on this connection.",
      ].join("\n"),
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript function body. Example: const page = await api.getDocument({ id }); return page.title;",
          },
        },
        required: ["code"],
      },
      annotations: {
        title: "Run script",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: reachesOpenWorld(catalog),
      },
    },
    {
      name: MCP_SCRIPT_SEARCH_TOOL,
      description: `Return exact TypeScript declarations for the \`api\` functions ${MCP_SCRIPT_RUN_TOOL} can call. Pass the function or tool names you plan to use, or words to search their names and descriptions.`,
      inputSchema: {
        type: "object",
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_SEARCH_NAMES,
            description: `Function names (api.getDocument or getDocument) or tool names (get-document), up to ${MAX_SEARCH_NAMES}.`,
          },
          query: {
            type: "string",
            maxLength: MAX_SEARCH_QUERY_CHARS,
            description: `Words to match against names and descriptions, up to ${MAX_SEARCH_WORDS} words.`,
          },
        },
      },
      annotations: {
        title: "Search script actions",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  ];
}

const MAX_SEARCH_MATCHES = 20;
/** Names one search looks up; the reply says when it left some out. */
const MAX_SEARCH_NAMES = 50;
/** The query one search reads, in characters and then words; the reply
 *  says when it cut the query. */
const MAX_SEARCH_QUERY_CHARS = 500;
const MAX_SEARCH_WORDS = 20;

/**
 * Declarations for the requested functions. Searches only what `run-script`
 * can call for this caller, as `tool-search` searches only what the catalog
 * advertises, so nothing found here is refused when called.
 */
export function searchMcpScriptActions(
  catalog: McpScriptCatalog,
  args: unknown,
): string {
  const input = isSchemaObject(args) ? args : {};
  const named = Array.isArray(input.names)
    ? input.names.filter((name): name is string => typeof name === "string")
    : [];
  const requested = named.slice(0, MAX_SEARCH_NAMES);
  const typed = typeof input.query === "string" ? input.query.trim() : "";
  const query = typed.slice(0, MAX_SEARCH_QUERY_CHARS).toLowerCase();
  const queryWords = query.split(/\s+/).filter(Boolean);
  const words = queryWords.slice(0, MAX_SEARCH_WORDS);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const raw of requested) {
    const key = raw.trim().replace(/^api\./, "");
    const action =
      catalog.byFunction.get(key) ??
      (Object.hasOwn(catalog.actions, key) ? key : undefined);
    if (action && !matched.includes(action)) matched.push(action);
    else if (!action) missing.push(raw);
  }
  if (query) {
    for (const [fn, action] of catalog.byFunction) {
      if (matched.length >= MAX_SEARCH_MATCHES) break;
      if (matched.includes(action)) continue;
      const entry = scriptCatalogEntry(catalog, action);
      if (entry === undefined) continue;
      const haystack = [
        fn,
        action,
        entry.tool.description,
        ...(entry.searchHints ?? []),
      ]
        .join(" ")
        .toLowerCase();
      if (words.every((word) => haystack.includes(word))) matched.push(action);
    }
  }
  if (requested.length === 0 && !query) {
    matched.push(
      ...[...catalog.byFunction.values()].slice(0, MAX_SEARCH_MATCHES),
    );
  }
  const body = matched
    .flatMap((action) => {
      const entry = scriptCatalogEntry(catalog, action);
      return entry === undefined ? [] : [mcpScriptDeclaration(action, entry)];
    })
    .join("\n\n");
  const lines = [`declare const api: {\n${body}${body ? "\n" : ""}};`];
  if (missing.length > 0) {
    lines.push(
      `// Not available to scripts: ${missing.map((name) => JSON.stringify(oneLine(name, 80))).join(", ")}.`,
    );
  }
  if (
    typed.length > MAX_SEARCH_QUERY_CHARS ||
    queryWords.length > words.length
  ) {
    lines.push(
      `// Searched with the query's first ${words.length} words, within ${MAX_SEARCH_QUERY_CHARS} characters.`,
    );
  }
  if (named.length > requested.length) {
    lines.push(
      `// Looked up the first ${MAX_SEARCH_NAMES} of ${named.length} names; ask for the rest in another search.`,
    );
  }
  for (const [fn, actions] of catalog.collisions) {
    lines.push(
      `// api.${fn} is not available: ${actions.join(" and ")} share that name.`,
    );
  }
  if (matched.length === 0) {
    lines.push(
      catalog.byFunction.size > 0
        ? `// Available: ${[...catalog.byFunction.keys()].map((fn) => `api.${fn}`).join(", ")}.`
        : "// No actions are available to scripts on this connection.",
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Running a script
// ---------------------------------------------------------------------------

export type McpScriptErrorCode =
  | "script_busy"
  | "script_too_large"
  | "script_timeout"
  | "script_aborted"
  | "script_error"
  | "script_call_limit"
  | "script_detached_call"
  | "script_result_too_large"
  | "script_result_unserializable"
  | "script_failed";

/** `unfinished`: the script stopped before the call settled. A read can still
 * finish on the server after that. */
export type McpScriptCallStatus =
  | "completed"
  | "failed"
  | "denied"
  | "refused"
  | "unfinished";

export interface McpScriptCallRecord {
  function: string;
  action?: string;
  status: McpScriptCallStatus;
  ms: number;
  code?: string;
  message?: string;
}

export interface McpScriptRunPayload {
  ok: boolean;
  runId: string;
  result?: unknown;
  error?: { code: McpScriptErrorCode; message: string; name?: string };
  logs?: string[];
  logsDropped?: number;
  calls: McpScriptCallRecord[];
}

export interface McpScriptDenial {
  runId: string;
  functionName: string;
  action: string | undefined;
  reason: McpScriptDenialReason;
  message: string;
  args: unknown;
}

export interface RunMcpScriptInput {
  code: unknown;
  catalog: McpScriptCatalog;
  /**
   * Every action the caller could call directly, to name a refused call's
   * reason. A call to any other action is refused as unknown.
   */
  known: Record<string, ActionEntry>;
  /** Runs one action through `executeMcpActionCall` for this caller. */
  callAction: (action: string, args: unknown) => Promise<McpActionCallOutcome>;
  /** Records a policy denial; a failure to record is logged, not thrown. */
  recordDenial: (denial: McpScriptDenial) => Promise<void>;
  runId?: string;
  signal?: AbortSignal;
  /** A shorter timeout than `MCP_SCRIPT_LIMITS.timeoutMs`; longer is ignored. */
  timeoutMs?: number;
}

let activeRuns = 0;
/** Calls still running from runs that have given their slot back. */
let lingeringCalls = 0;

let runtime:
  | Promise<{ runner: Runner; RunError: typeof RunErrorClass }>
  | undefined;
// QuickJS is megabytes to compile, so it loads on the first script, as
// `run-code` loads it. A failed start is not kept.
function loadRuntime() {
  return (runtime ??= import("run")
    .then(({ createRunner, RunError }) => ({
      RunError,
      runner: createRunner({
        limits: {
          memoryLimitBytes: MCP_SCRIPT_LIMITS.memoryBytes,
          maxStackSizeBytes: 2 * 1024 * 1024,
          maxResultBytes: 4 * 1024 * 1024,
          maxConsoleOutputBytes: 64 * 1024,
          // The prelude and wrapper add a few kilobytes to the model's code.
          maxSourceBytes: MCP_SCRIPT_LIMITS.sourceBytes + 16 * 1024,
          maxHostFunctionArgumentsBytes: 1024 * 1024,
          maxHostFunctionOutputBytes:
            MCP_SCRIPT_LIMITS.callResultBytes + 64 * 1024,
          // Calls past the script limit are refused by the bridge itself;
          // this only stops a script that keeps calling after refusals.
          maxBridgeRequests: MCP_SCRIPT_LIMITS.calls + 32,
          maxInFlightBridgeRequests: MCP_SCRIPT_LIMITS.inFlightCalls,
        },
      }),
    }))
    .catch((error: unknown) => {
      runtime = undefined;
      throw error;
    }));
}

function guestPrelude(functionNames: readonly string[]): string {
  return `const __names = ${JSON.stringify(functionNames)};
const __console = (() => {
  const lines = [];
  let chars = 0;
  let dropped = 0;
  const format = (value) => {
    if (typeof value === "string") return value;
    try {
      const text = JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() + "n" : item,
      );
      return text === undefined ? String(value) : text;
    } catch {
      return String(value);
    }
  };
  // A line costs its newline too, so empty lines run out as well.
  const write = (level, values) => {
    const line = (level === "log" ? "" : "[" + level + "] ") + values.map(format).join(" ");
    if (lines.length >= ${MCP_SCRIPT_LIMITS.logLines} || chars + line.length + 1 > ${MCP_SCRIPT_LIMITS.logChars}) {
      dropped += 1;
      return;
    }
    chars += line.length + 1;
    lines.push(line);
  };
  return Object.freeze({
    console: Object.freeze({
      log: (...values) => write("log", values),
      info: (...values) => write("info", values),
      warn: (...values) => write("warn", values),
      error: (...values) => write("error", values),
      debug: (...values) => write("debug", values),
    }),
    lines,
    dropped: () => dropped,
  });
})();
const console = __console.console;
async function __call(name, args) {
  const reply = await __host.call(name, args === undefined ? {} : args);
  if (reply && reply.ok === true) return reply.value;
  const error = new Error(reply && typeof reply.message === "string" ? reply.message : "The call failed.");
  error.name = "ActionCallError";
  error.code = reply && typeof reply.code === "string" ? reply.code : "call_failed";
  throw error;
}
const __api = Object.create(null);
for (const name of __names) {
  Object.defineProperty(__api, name, { value: (args) => __call(name, args), enumerable: true });
}
Object.freeze(__api);
// A function the script cannot call still reaches the host, which refuses it
// with the reason and records the refusal. \`then\` stays undefined so \`api\`
// is never mistaken for a promise.
const api = new Proxy(__api, {
  get: (target, name) =>
    Object.hasOwn(target, name)
      ? target[name]
      : typeof name === "string" && name !== "then"
        ? (args) => __call(name, args)
        : undefined,
});
`;
}

function guestSource(prelude: string, code: string): string {
  return `${prelude}try {
  const __value = await (async () => {
${code}
  })();
  return { ok: true, value: __value, logs: __console.lines, logsDropped: __console.dropped() };
} catch (__error) {
  // The sandbox stops a script with this error. Inside an async function it
  // becomes an ordinary rejection, so it is thrown on for the runner to see.
  if (__error && __error.name === "InternalError" && __error.message === "interrupted") {
    throw __error;
  }
  return {
    ok: false,
    error: {
      name: String(__error && __error.name ? __error.name : "Error"),
      message: String(__error && __error.message !== undefined ? __error.message : __error),
      stack: __error && typeof __error.stack === "string" ? __error.stack.slice(0, 4000) : "",
    },
    logs: __console.lines,
    logsDropped: __console.dropped(),
  };
}
`;
}

function lineCount(text: string): number {
  return text.split("\n").length - 1;
}

/** Points `run.js:L:C` positions at the model's own code. */
function rebaseLines(message: string, offset: number): string {
  return message.replace(
    /run\.js:(\d+):(\d+)/g,
    (_, line: string, col: string) => {
      const own = Number(line) - offset;
      return own > 0 ? `line ${own}, column ${col}` : `run.js:${line}:${col}`;
    },
  );
}

/**
 * Where in the model's own code an error was thrown, from the first stack
 * frame that falls inside it, such as ` (line 2, column 11)`. A syntax error
 * has no stack, and an error thrown inside the prelude, such as a refused
 * call, is placed at the script's line that made the call.
 */
function ownPosition(stack: string, offset: number, codeLines: number): string {
  for (const match of stack.matchAll(/run\.js:(\d+):(\d+)/g)) {
    const line = Number(match[1]) - offset;
    if (line > 0 && line <= codeLines) {
      return ` (line ${line}, column ${match[2]})`;
    }
  }
  return "";
}

/**
 * The length of `text` in UTF-8, counted rather than encoded, so measuring a
 * call's result makes no copy of it. A lone surrogate counts as the three
 * bytes of the U+FFFD that `TextEncoder` writes for it.
 */
export function utf8Bytes(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) continue;
    if (unit < 0x800) {
      bytes += 1;
      continue;
    }
    const next = text.charCodeAt(index + 1);
    if (unit <= 0xdbff && unit >= 0xd800 && next >= 0xdc00 && next <= 0xdfff) {
      // A surrogate pair is two units and four bytes.
      bytes += 2;
      index += 1;
      continue;
    }
    bytes += 2;
  }
  return bytes;
}

/**
 * Arguments of a refused call as the audit log may keep them: without embed
 * credentials, which the audit redactor does not know to look for, or not
 * at all when they can't be read for credentials.
 */
function deniedCallArguments(args: unknown): unknown {
  try {
    return redactEmbedCredentials(args);
  } catch {
    // coercion-ok: undefined means "left out of the record", as for arguments past the limits.
    return undefined;
  }
}

/**
 * Runs a script. Never throws: every failure, including a busy process, is a
 * payload with `ok: false` and a typed `error.code`, and the payload always
 * lists the calls the script made before it stopped.
 */
export async function runMcpScript(
  input: RunMcpScriptInput,
): Promise<McpScriptRunPayload> {
  const runId = input.runId ?? crypto.randomUUID();
  const timeoutMs = Math.min(
    input.timeoutMs ?? MCP_SCRIPT_LIMITS.timeoutMs,
    MCP_SCRIPT_LIMITS.timeoutMs,
  );
  const calls: McpScriptCallRecord[] = [];
  const fail = (
    code: McpScriptErrorCode,
    message: string,
  ): McpScriptRunPayload => ({
    ok: false,
    runId,
    error: { code, message },
    calls: [...calls],
  });

  const code = typeof input.code === "string" ? input.code : "";
  if (!code.trim()) {
    return fail(
      "script_error",
      "Pass the script as `code`, a non-empty string.",
    );
  }
  if (utf8Bytes(code) > MCP_SCRIPT_LIMITS.sourceBytes) {
    return fail(
      "script_too_large",
      `The script is larger than ${MCP_SCRIPT_LIMITS.sourceBytes / 1024} KB.`,
    );
  }
  if (
    activeRuns >= MCP_SCRIPT_LIMITS.concurrentRuns ||
    lingeringCalls >= MCP_SCRIPT_LIMITS.lingeringCalls
  ) {
    return fail(
      "script_busy",
      "Too many scripts are running on this server. Try again shortly, or call the tools directly.",
    );
  }
  activeRuns += 1;
  let stopped = false;
  let callCount = 0;
  let readBytes = 0;
  // The sandbox can't cancel a call it started, so a run that stops with
  // calls in flight (an action, or the audit write for a refusal) keeps its
  // slot until they settle. Otherwise runs that time out could pile up work
  // past the process limit. A call that never settles gives the slot back
  // after as long again as the run's timeout, with a warning, and counts
  // against `lingeringCalls` until it settles, so those can't pile up
  // past a limit either. A run whose calls don't fit under that limit keeps
  // its slot, and looks again after as long again.
  let callsInFlight = 0;
  let released = false;
  let lingering = false;
  let warnedFull = false;
  let stuckTimer: ReturnType<typeof setTimeout> | undefined;
  const giveSlotBack = () => {
    released = true;
    if (stuckTimer !== undefined) clearTimeout(stuckTimer);
    activeRuns -= 1;
  };
  const release = () => {
    if (released || !stopped) return;
    if (callsInFlight === 0) {
      giveSlotBack();
      return;
    }
    if (stuckTimer !== undefined) return;
    stuckTimer = setTimeout(() => {
      if (released) return;
      if (lingeringCalls + callsInFlight > MCP_SCRIPT_LIMITS.lingeringCalls) {
        if (!warnedFull) {
          warnedFull = true;
          console.warn(
            `[mcp] Script run ${runId} stopped with ${callsInFlight} call(s) still running after ${timeoutMs} ms, more than stopped runs have room for; keeping its slot.`,
          );
        }
        stuckTimer = undefined;
        release();
        return;
      }
      console.warn(
        `[mcp] Script run ${runId} stopped with ${callsInFlight} call(s) still running after ${timeoutMs} ms; giving its slot back.`,
      );
      lingering = true;
      lingeringCalls += callsInFlight;
      giveSlotBack();
    }, timeoutMs);
    (stuckTimer as { unref?: () => void }).unref?.();
  };
  try {
    let loaded: Awaited<ReturnType<typeof loadRuntime>>;
    try {
      loaded = await loadRuntime();
    } catch (error) {
      console.error(
        `[mcp] The script runner could not start: ${describeThrownForLog(error)}`,
      );
      return fail(
        "script_failed",
        "The script runner could not start on this server. Call the tools directly.",
      );
    }
    const { runner, RunError } = loaded;

    // One call from the script's `api`, answered as the guest's `__call`
    // reads it.
    const answerCall = async (rawName: unknown, rawArgs: unknown) => {
      const startedAt = Date.now();
      // The guest's `api` names every call with a string. Anything else
      // is not turned into text, which for a nested array the sandbox
      // sent once and pointed to again would spell out every copy.
      // A name that carries an embed URL is hidden before the audit log
      // or the call list can keep it.
      const fn =
        typeof rawName === "string"
          ? redactEmbedText(oneLine(rawName.replace(/^api\./, ""), 120))
          : "(unnamed)";
      // A call is listed when it starts, so a script that stops while
      // waiting on one still shows it, as unfinished.
      const slot = stopped
        ? -1
        : calls.push({ function: fn, status: "unfinished", ms: 0 }) - 1;
      const record = (call: McpScriptCallRecord) => {
        if (!stopped && slot >= 0) calls[slot] = call;
      };
      const refuse = (
        functionName: string,
        action: string | undefined,
        status: "denied" | "refused" | "failed",
        replyCode: string,
        message: string,
        callStartedAt: number,
      ) => {
        record({
          function: functionName,
          ...(action ? { action } : {}),
          status,
          ms: Date.now() - callStartedAt,
          code: replyCode,
          message: oneLine(message, 300),
        });
        return { ok: false, code: replyCode, message };
      };
      if (stopped || input.signal?.aborted) {
        return refuse(
          fn,
          undefined,
          "refused",
          "script_stopped",
          "The script stopped before this call started.",
          startedAt,
        );
      }
      callCount += 1;
      if (callCount > MCP_SCRIPT_LIMITS.calls) {
        return refuse(
          fn,
          undefined,
          "refused",
          "call_limit",
          `A script may make at most ${MCP_SCRIPT_LIMITS.calls} calls.`,
          startedAt,
        );
      }
      // Measured before anything copies them, the audit log included: the
      // sandbox sends a part the arguments repeat once, and a copy spells
      // out every repeat.
      let args: unknown;
      let argumentProblem: string | undefined;
      try {
        plainResultValue(rawArgs, MCP_SCRIPT_LIMITS.argumentChars, "refuse");
        const held =
          rawArgs === undefined ? undefined : nonJsonArgument(rawArgs);
        if (held !== undefined) {
          argumentProblem = `api.${fn} takes one object of JSON data, and its arguments hold ${held}.`;
        } else {
          args = toJsonData(rawArgs === undefined ? {} : rawArgs);
          if (!isSchemaObject(args)) throw new TypeError("not an object");
        }
      } catch (error) {
        argumentProblem =
          error instanceof McpScriptValueTooLargeError
            ? `api.${fn} takes at most ${MCP_SCRIPT_LIMITS.argumentChars} characters of arguments.`
            : error instanceof McpScriptValueTooDeepError
              ? `api.${fn} takes arguments nested at most ${MAX_RESULT_DEPTH} levels deep.`
              : `api.${fn} takes one object of JSON data.`;
      }
      const action = input.catalog.byFunction.get(fn);
      const entry =
        action === undefined
          ? undefined
          : scriptCatalogEntry(input.catalog, action);
      // The catalog holds only what the policy allows; asking again at
      // the call keeps it in force if an entry has changed since.
      const policy =
        action === undefined || entry === undefined
          ? undefined
          : mcpScriptCallPolicy(action, entry);
      if (action === undefined || policy?.allowed !== true) {
        const denial =
          policy?.allowed === false
            ? { action, reason: policy.reason }
            : explainMcpScriptDenial(fn, input.catalog, input.known);
        const message = `api.${fn} ${DENIAL_MESSAGES[denial.reason]}.`;
        try {
          await input.recordDenial({
            runId,
            functionName: fn,
            action: denial.action,
            reason: denial.reason,
            message,
            // Arguments past the limits, or not JSON, are left out.
            args:
              argumentProblem === undefined
                ? deniedCallArguments(args)
                : undefined,
          });
        } catch (error) {
          console.error(
            `[mcp] Could not record a script call denial: ${describeThrownForLog(error)}`,
          );
        }
        return refuse(
          fn,
          denial.action,
          "denied",
          denial.reason,
          message,
          startedAt,
        );
      }
      if (argumentProblem !== undefined) {
        return refuse(
          fn,
          action,
          "failed",
          "invalid_arguments",
          argumentProblem,
          startedAt,
        );
      }
      record({ function: fn, action, status: "unfinished", ms: 0 });
      const outcome = await input.callAction(action, args);
      switch (outcome.status) {
        case "completed": {
          if (outcome.reportedError) {
            return refuse(
              fn,
              action,
              "failed",
              "action_reported_error",
              `api.${fn} reported an error: ${oneLine(jsonText(outcome.value), 500)}`,
              startedAt,
            );
          }
          const json = jsonText(outcome.value);
          const bytes = utf8Bytes(json);
          if (bytes > MCP_SCRIPT_LIMITS.callResultBytes) {
            return refuse(
              fn,
              action,
              "refused",
              "result_too_large",
              `api.${fn} returned ${bytes} bytes, more than the ${MCP_SCRIPT_LIMITS.callResultBytes} a script can receive from one call. Ask for less with its paging or filter arguments.`,
              startedAt,
            );
          }
          if (readBytes + bytes > MCP_SCRIPT_LIMITS.readBytes) {
            return refuse(
              fn,
              action,
              "refused",
              "read_limit",
              `This call would take the script past ${MCP_SCRIPT_LIMITS.readBytes} bytes of results. Ask for less data per call.`,
              startedAt,
            );
          }
          readBytes += bytes;
          record({
            function: fn,
            action,
            status: "completed",
            ms: Date.now() - startedAt,
          });
          return { ok: true, value: outcome.value };
        }
        case "failed":
          return refuse(
            fn,
            action,
            outcome.stage === "authorization" ? "denied" : "failed",
            outcome.errorCode ??
              (outcome.stage === "authorization"
                ? "forbidden"
                : "action_failed"),
            outcome.message,
            startedAt,
          );
        case "unknown-tool":
        case "forbidden-scope": {
          const message = `api.${fn} ${DENIAL_MESSAGES["out-of-scope"]}.`;
          try {
            await input.recordDenial({
              runId,
              functionName: fn,
              action,
              reason: "out-of-scope",
              message,
              args: deniedCallArguments(args),
            });
          } catch (error) {
            console.error(
              `[mcp] Could not record a script call denial: ${describeThrownForLog(error)}`,
            );
          }
          return refuse(
            fn,
            action,
            "denied",
            "out-of-scope",
            message,
            startedAt,
          );
        }
        case "approval-required":
        case "approval-pending":
        case "approval-denied":
          // Scriptable actions ask for no approval, so this is a bug in
          // policy, refused rather than left waiting.
          return refuse(
            fn,
            action,
            "denied",
            "needs-approval",
            `api.${fn} ${DENIAL_MESSAGES["needs-approval"]}.`,
            startedAt,
          );
      }
    };

    const hostFunctions: HostFunctions = {
      __host: {
        call: async (rawName: unknown, rawArgs: unknown) => {
          callsInFlight += 1;
          if (lingering) lingeringCalls += 1;
          try {
            return await answerCall(rawName, rawArgs);
          } finally {
            callsInFlight -= 1;
            if (lingering) lingeringCalls -= 1;
            release();
          }
        },
      },
    };

    const prelude = guestPrelude([...input.catalog.byFunction.keys()]);
    // The wrapper puts two lines before the code, and the runner two more.
    const offset = lineCount(prelude) + 4;
    const timedOut = () =>
      fail(
        "script_timeout",
        `The script ran too long: past ${timeoutMs / 1000} s, or past the computation a script may do. Calls it started may have finished after it stopped.`,
      );
    const startedAt = Date.now();
    let result;
    try {
      result = await runner.run({
        source: guestSource(prelude, code),
        hostFunctions,
        limits: { timeoutMs },
        ...(input.signal ? { abortSignal: input.signal } : {}),
      });
    } catch (error) {
      stopped = true;
      if (!RunError.isInstance(error)) {
        return fail(
          "script_failed",
          `The script could not run: ${describeThrownForLog(error)}`,
        );
      }
      switch (error.code) {
        case "RUN_TIMEOUT":
          return timedOut();
        case "RUN_ABORTED":
          return fail("script_aborted", "The script was cancelled.");
        case "RUN_CONCURRENCY_LIMIT":
          return fail(
            "script_busy",
            "Too many scripts are running on this server. Try again shortly, or call the tools directly.",
          );
        case "RUN_BRIDGE_LIMIT":
          return fail(
            "script_call_limit",
            `The script started more than ${MCP_SCRIPT_LIMITS.inFlightCalls} calls at once or made too many calls. Await some calls before starting more.`,
          );
        case "RUN_DETACHED_BRIDGE_REQUEST":
          return fail(
            "script_detached_call",
            "The script returned before a call it started finished. Await every api call.",
          );
        case "RUN_SOURCE_TOO_LARGE":
          return fail(
            "script_too_large",
            `The script is larger than ${MCP_SCRIPT_LIMITS.sourceBytes / 1024} KB.`,
          );
        case "RUN_SERIALIZATION_ERROR":
          return /exceeds/i.test(error.message)
            ? fail("script_result_too_large", RESULT_TOO_LARGE)
            : fail("script_result_unserializable", error.message);
        default:
          return fail("script_error", rebaseLines(error.message, offset));
      }
    }
    stopped = true;
    // A script that catches the interrupt in its own async function still
    // stops, and past the deadline it has timed out whatever it returned.
    if (Date.now() - startedAt >= timeoutMs) return timedOut();
    if (result.status !== "completed") {
      return fail("script_failed", "The script stopped before it completed.");
    }
    const envelope = isSchemaObject(result.value) ? result.value : {};
    // The script can reach its own log buffer, so the limits hold here too,
    // and only the lines it may keep are read: a buffer it lengthened by
    // hand would otherwise be scanned slot by slot.
    const lines: readonly unknown[] = Array.isArray(envelope.logs)
      ? envelope.logs
      : [];
    const logs: string[] = [];
    let logChars = 0;
    const readable = Math.min(lines.length, MCP_SCRIPT_LIMITS.logLines);
    for (let index = 0; index < readable; index += 1) {
      const line = lines[index];
      if (typeof line !== "string") continue;
      if (logChars + line.length + 1 > MCP_SCRIPT_LIMITS.logChars) break;
      logs.push(line);
      logChars += line.length + 1;
    }
    const counted =
      typeof envelope.logsDropped === "number" &&
      Number.isSafeInteger(envelope.logsDropped) &&
      envelope.logsDropped > 0
        ? envelope.logsDropped
        : 0;
    const logsDropped = counted + lines.length - logs.length;
    const shared = {
      runId,
      ...(logs.length > 0 ? { logs } : {}),
      ...(logsDropped > 0 ? { logsDropped } : {}),
      calls: [...calls],
    };
    if (envelope.ok === true) {
      let value: unknown;
      try {
        value = plainResultValue(envelope.value);
      } catch (error) {
        return error instanceof McpScriptValueTooLargeError
          ? fail("script_result_too_large", RESULT_TOO_LARGE)
          : fail(
              "script_result_unserializable",
              `The script's result could not be read: ${describeThrownForLog(error)}`,
            );
      }
      return { ok: true, ...shared, result: value };
    }
    const thrown = isSchemaObject(envelope.error) ? envelope.error : {};
    return {
      ok: false,
      ...shared,
      error: {
        code: "script_error",
        name: oneLine(thrown.name, 80) || "Error",
        message: clip(
          rebaseLines(
            typeof thrown.message === "string"
              ? thrown.message
              : "The script threw.",
            offset,
          ) +
            ownPosition(
              typeof thrown.stack === "string" ? thrown.stack : "",
              offset,
              lineCount(code) + 1,
            ),
          ERROR_MESSAGE_CHARS,
        ),
      },
    };
  } finally {
    stopped = true;
    release();
  }
}

const MAX_RESULT_DEPTH = 64;
const ERROR_MESSAGE_CHARS = 4_000;
const RESULT_TOO_LARGE =
  "The script returned more data than it may. Return less: pick the fields you need, or fewer items.";

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A guest value larger than the server will copy out of the sandbox. */
export class McpScriptValueTooLargeError extends Error {
  constructor(maxChars: number) {
    super(`The value is larger than ${maxChars} characters.`);
    this.name = "McpScriptValueTooLargeError";
  }
}

/** A guest value nested deeper than the server will read it. */
export class McpScriptValueTooDeepError extends Error {
  constructor() {
    super(`The value is nested more than ${MAX_RESULT_DEPTH} levels deep.`);
    this.name = "McpScriptValueTooDeepError";
  }
}

/**
 * What a script's arguments hold that JSON has no form of, said with how to
 * pass it instead, or undefined when they are JSON data. Copied as JSON, a
 * `Map` or `Set` would become `{}`, a `Date` a string and `NaN` null,
 * and the action would run with values the script didn't pass. A property
 * set to undefined is left out, as JSON leaves it out. Run after
 * `plainResultValue` has measured the arguments, which bounds the walk.
 */
function nonJsonArgument(value: unknown): string | undefined {
  const onPath = new Set<object>();
  const visit = (item: unknown, inObject: boolean): string | undefined => {
    switch (typeof item) {
      case "string":
      case "boolean":
        return undefined;
      case "number":
        return Number.isFinite(item)
          ? undefined
          : "NaN or Infinity; pass a finite number or null";
      case "bigint":
        return "a BigInt; pass it as a string or a number";
      case "undefined":
        return inObject ? undefined : "undefined in a list; pass null";
      case "function":
        return "a function";
      case "symbol":
        return "a symbol";
      case "object":
        break;
    }
    if (typeof item !== "object" || item === null) return undefined;
    const object = item;
    if (object instanceof Map) {
      return "a Map; convert it with Object.fromEntries";
    }
    if (object instanceof Set) return "a Set; convert it with Array.from";
    if (object instanceof Date) return "a Date; pass date.toISOString()";
    if (object instanceof RegExp) {
      return "a regular expression; pass its source as a string";
    }
    if (object instanceof Error) return "an Error; pass its message";
    if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) {
      return "binary data";
    }
    if (onPath.has(object)) return "a circular reference";
    onPath.add(object);
    try {
      if (Array.isArray(object)) {
        for (let index = 0; index < object.length; index += 1) {
          const held = visit(object[index], false);
          if (held !== undefined) return held;
        }
        return undefined;
      }
      for (const member of Object.values(object)) {
        const held = visit(member, true);
        if (held !== undefined) return held;
      }
      return undefined;
    } finally {
      onPath.delete(object);
    }
  };
  return visit(value, true);
}

/**
 * A guest value as JSON data. The sandbox hands back BigInt, cycles, `Map`,
 * `Set`, `Date` and binary values, which JSON cannot hold, so each becomes
 * something it can: a BigInt is its digits and `n`, a cycle is marked, a
 * `Map` is an object (or entries when a key is not a string), a `Set` an
 * array, a `Date` its ISO string, and binary data a byte count.
 *
 * The sandbox sends a part a value repeats once, and JSON spells out every
 * copy, so a short script can return something enormous. Every node, key
 * and string the copy holds, a converted one included, is charged as often
 * as it appears, at its length before JSON escapes it, and past `maxChars`
 * this throws `McpScriptValueTooLargeError`. Past 64 levels a part is
 * marked, or with `tooDeep: "refuse"` this throws
 * `McpScriptValueTooDeepError`, so that a caller about to serialize the
 * original has measured all of it.
 */
export function plainResultValue(
  value: unknown,
  maxChars: number = MCP_SCRIPT_LIMITS.returnChars,
  tooDeep: "mark" | "refuse" = "mark",
): unknown {
  const onPath = new Set<object>();
  let spent = 0;
  const charge = (chars: number) => {
    spent += chars;
    if (spent > maxChars) throw new McpScriptValueTooLargeError(maxChars);
  };
  const text = (out: string) => {
    charge(out.length + 2);
    return out;
  };
  // Each member costs at least its separator, so a collection longer than
  // the budget left is refused before it is read. The sandbox sends a
  // sparse array as its length alone, which would otherwise be walked, or
  // copied, slot by slot.
  const members = (count: number) => {
    charge(2);
    if (count > maxChars - spent) {
      throw new McpScriptValueTooLargeError(maxChars);
    }
  };
  const walk = (item: unknown, depth: number): unknown => {
    switch (typeof item) {
      case "string":
        return text(item);
      case "bigint":
        return text(`${item.toString()}n`);
      case "number":
        if (!Number.isFinite(item)) break;
        charge(String(item).length);
        return item;
      case "boolean":
        charge(item ? 4 : 5);
        return item;
      case "object":
        if (item === null) break;
        return walkObject(item, depth);
      case "undefined":
      case "function":
      case "symbol":
        break;
    }
    // `null`, standing in for anything JSON has no form of.
    charge(4);
    return null;
  };
  const walkObject = (item: object, depth: number): unknown => {
    if (depth > MAX_RESULT_DEPTH) {
      if (tooDeep === "refuse") throw new McpScriptValueTooDeepError();
      return text("[Too deep]");
    }
    if (onPath.has(item)) return text("[Circular]");
    if (item instanceof Date) {
      return Number.isNaN(item.getTime())
        ? walk(null, depth)
        : text(item.toISOString());
    }
    if (item instanceof RegExp) return text(String(item));
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      return text(`[${item.byteLength} bytes of binary data]`);
    }
    onPath.add(item);
    try {
      if (item instanceof Error) {
        charge(`{"name":,"message":}`.length);
        return {
          name: text(typeof item.name === "string" ? item.name : "Error"),
          message: text(typeof item.message === "string" ? item.message : ""),
        };
      }
      if (Array.isArray(item)) {
        members(item.length);
        const out: unknown[] = [];
        for (let index = 0; index < item.length; index += 1) {
          charge(1);
          out.push(walk(item[index], depth + 1));
        }
        return out;
      }
      if (item instanceof Set) {
        members(item.size);
        const out: unknown[] = [];
        for (const member of item) {
          charge(1);
          out.push(walk(member, depth + 1));
        }
        return out;
      }
      if (item instanceof Map) {
        members(item.size);
        let stringKeys = true;
        for (const key of item.keys()) {
          if (typeof key !== "string") {
            stringKeys = false;
            break;
          }
        }
        const out: Array<[unknown, unknown]> = [];
        for (const [key, member] of item) {
          if (stringKeys && typeof key === "string") {
            charge(key.length + 4);
            out.push([key, walk(member, depth + 1)]);
          } else {
            charge(3);
            out.push([walk(key, depth + 1), walk(member, depth + 1)]);
          }
        }
        return stringKeys ? Object.fromEntries(out) : out;
      }
      charge(2);
      const out: Array<[string, unknown]> = [];
      for (const [key, member] of Object.entries(item)) {
        if (member === undefined) continue;
        charge(key.length + 4);
        out.push([key, walk(member, depth + 1)]);
      }
      // Assigning an own "__proto__" key would set the copy's prototype and
      // drop the field; fromEntries defines every key as a field.
      return Object.fromEntries(out);
    } finally {
      onPath.delete(item);
    }
  };
  return walk(value, 0);
}

/**
 * The text `run-script` returns: the whole payload as JSON while it fits.
 * Past the limit, logs go first, then the result becomes a preview string
 * with its original length, then the call list is shortened, so the text is
 * always valid JSON and always keeps `ok`, `runId` and any error.
 */
export function formatMcpScriptPayload(
  payload: McpScriptRunPayload,
  maxChars: number = MCP_SCRIPT_LIMITS.resultChars,
): string {
  let text = JSON.stringify(payload);
  if (text.length <= maxChars) return text;
  const trimmed: Record<string, unknown> = { ...payload };
  if (payload.logs) {
    // The first lines that fit, measured once rather than by serializing
    // the payload again for every line dropped.
    const allLogs = payload.logs;
    const before = payload.logsDropped ?? 0;
    const withLogs = (count: number) =>
      JSON.stringify({
        ...trimmed,
        logs: count > 0 ? allLogs.slice(0, count) : undefined,
        logsDropped: before + allLogs.length - count,
      });
    // `,"logs":[` and `]` around lines joined by commas.
    let used = withLogs(0).length + 9;
    let kept = 0;
    for (const line of allLogs) {
      const cost = JSON.stringify(line).length + 1;
      if (used + cost > maxChars) break;
      used += cost;
      kept += 1;
    }
    // A shorter dropped count can leave room for one more line.
    if (kept < allLogs.length && withLogs(kept + 1).length <= maxChars) {
      kept += 1;
    }
    trimmed.logs = kept > 0 ? allLogs.slice(0, kept) : undefined;
    trimmed.logsDropped = before + allLogs.length - kept;
    text = JSON.stringify(trimmed);
  }
  if (text.length > maxChars && "result" in payload) {
    const resultText = jsonText(payload.result);
    trimmed.result = undefined;
    trimmed.resultTruncated = {
      originalChars: resultText.length,
      shownChars: 0,
      note: "The result was too long to return. Return less data: pick the fields you need, or fewer items.",
      preview: "",
    };
    const room = maxChars - JSON.stringify(trimmed).length - 16;
    if (room > 0) {
      let preview = resultText.slice(0, room);
      // A JSON-escaped preview is longer than its source; shorten it until
      // the whole payload fits.
      while (
        preview.length > 0 &&
        JSON.stringify({
          ...trimmed,
          resultTruncated: {
            ...(trimmed.resultTruncated as object),
            shownChars: preview.length,
            preview,
          },
        }).length > maxChars
      ) {
        preview = preview.slice(0, Math.floor(preview.length * 0.9));
      }
      trimmed.resultTruncated = {
        ...(trimmed.resultTruncated as object),
        shownChars: preview.length,
        preview,
      };
    }
    text = JSON.stringify(trimmed);
  }
  if (text.length > maxChars) {
    const allCalls = payload.calls;
    let kept = allCalls.length;
    while (kept > 0 && text.length > maxChars) {
      kept = Math.floor(kept / 2);
      trimmed.calls = allCalls.slice(0, kept);
      trimmed.callsOmitted = allCalls.length - kept;
      text = JSON.stringify(trimmed);
    }
  }
  if (text.length > maxChars) {
    text = JSON.stringify({
      ok: payload.ok,
      runId: payload.runId,
      ...(payload.error
        ? {
            error: {
              code: payload.error.code,
              message: oneLine(payload.error.message, 500),
            },
          }
        : {}),
      resultTruncated: {
        note: "The result was too long to return. Return less data.",
      },
      callsOmitted: payload.calls.length,
    });
  }
  return text;
}

/** The `tools/call` result for a script run. */
export function mcpScriptCallResult(payload: McpScriptRunPayload): {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
} {
  return {
    content: [{ type: "text", text: formatMcpScriptPayload(payload) }],
    ...(payload.ok ? {} : { isError: true as const }),
  };
}

/**
 * Records a refused script call in the audit log, for the caller's admins
 * to see beside the calls that ran. The script's run id ties the rows of one
 * run together.
 */
export async function recordMcpScriptDenial(
  denial: McpScriptDenial,
  context: {
    userEmail: string | undefined;
    orgId: string | null | undefined;
    mcpClient?: ActionRunContext["mcpClient"];
  },
): Promise<void> {
  const [{ recordActionAudit }, { auditAttribution }] = await Promise.all([
    import("../audit/record.js"),
    import("../audit/attribution.js"),
  ]);
  const refusal = Object.assign(new Error(denial.message), {
    statusCode: 403,
    errorCode: `mcp_script_${denial.reason.replace(/-/g, "_")}`,
  });
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => ({ type: "mcp-script-run", id: denial.runId }),
      summary: () =>
        `Refused ${denial.action ?? `api.${denial.functionName}`} in an MCP script: ${denial.message}`,
    },
    args: denial.args,
    ctx: {
      actionName: denial.action ?? `api.${denial.functionName}`,
      ...(context.userEmail ? { userEmail: context.userEmail } : {}),
      orgId: context.orgId ?? null,
    },
    attribution: runOutsideActionInvocation(() =>
      auditAttribution({
        caller: "mcp",
        runId: denial.runId,
        ...(context.mcpClient ? { mcpClient: context.mcpClient } : {}),
      }),
    ),
    status: "error",
    error: refusal,
  });
}
