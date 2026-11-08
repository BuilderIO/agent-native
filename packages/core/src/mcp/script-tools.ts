import type { HostFunctions, Runner, RunError as RunErrorClass } from "run";

import { isMcpReadOnlyTool } from "../action-call-classification.js";
import { runOutsideActionInvocation } from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { describeThrownForLog } from "./embed-redaction.js";
import {
  type McpActionCallOutcome,
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
  /** Characters of console output kept; later lines are counted, not kept. */
  logChars: 16_000,
  /** Characters of the text `run-script` returns. */
  resultChars: 30_000,
  /** Scripts running at once in this process; another gets a busy error. */
  concurrentRuns: 4,
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
    const [only, ...others] = named;
    if (!only) continue;
    if (others.length > 0) {
      collisions.set(fn, named.map(([name]) => name).sort());
      continue;
    }
    byFunction.set(fn, only[0]);
    actions[only[0]] = only[1];
  }
  return Object.freeze({
    byFunction,
    actions: Object.freeze(actions),
    collisions,
  });
}

/**
 * Why a script's call to `functionName` is refused. `known` is every action
 * the request has, so a refusal can say "not available to scripts" rather
 * than "unknown" for an action that exists but is not scriptable.
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
  const [first] = named;
  return first
    ? { action: first[0], reason: "out-of-scope" }
    : { action: undefined, reason: "unknown-function" };
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
    const [only, ...others] = members;
    parts.push(
      only !== undefined && others.length === 0
        ? only
        : `(${members.join(" | ")})`,
    );
  }
  if (STRUCTURAL_KEYS.some((key) => schema[key] !== undefined)) {
    const base = Object.fromEntries(
      Object.entries(schema).filter(([key]) => !COMPOSITION_KEYS.has(key)),
    );
    parts.unshift(structuralType(base, scope, depth, indent));
  }
  const [only, ...others] = parts;
  const type =
    only === undefined
      ? "unknown"
      : others.length === 0
        ? only
        : parts.map(parenthesize).join(" & ");
  return schema.nullable === true ? `${parenthesize(type)} | null` : type;
}

function structuralType(
  schema: Record<string, unknown>,
  scope: TypeScope,
  depth: number,
  indent: string,
): string {
  if ("const" in schema) return JSON.stringify(schema.const) ?? "unknown";
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
        const head = schema.prefixItems.map((member) =>
          schemaType(member, scope, depth + 1, indent),
        );
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
  const input =
    entry.tool.parameters === undefined
      ? { type: "{}" }
      : typeOrReason(entry.tool.parameters, "  ");
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
        openWorldHint: false,
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
            description:
              "Function names (api.getDocument or getDocument) or tool names (get-document).",
          },
          query: {
            type: "string",
            description: "Words to match against names and descriptions.",
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
  const requested = Array.isArray(input.names)
    ? input.names.filter((name): name is string => typeof name === "string")
    : [];
  const query =
    typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
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
    const words = query.split(/\s+/).filter(Boolean);
    for (const [fn, action] of catalog.byFunction) {
      if (matched.length >= MAX_SEARCH_MATCHES) break;
      if (matched.includes(action)) continue;
      const entry = catalog.actions[action];
      const haystack = [
        fn,
        action,
        entry?.tool.description ?? "",
        ...(entry?.searchHints ?? []),
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
      const entry = catalog.actions[action];
      return entry ? [mcpScriptDeclaration(action, entry)] : [];
    })
    .join("\n\n");
  const lines = [`declare const api: {\n${body}${body ? "\n" : ""}};`];
  if (missing.length > 0) {
    lines.push(
      `// Not available to scripts: ${missing.map((name) => JSON.stringify(oneLine(name, 80))).join(", ")}.`,
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

export type McpScriptCallStatus = "completed" | "failed" | "denied" | "refused";

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
  /** Every action the request has, to name a refused call's reason. */
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
const __logs = [];
let __logChars = 0;
let __logsDropped = 0;
function __format(value) {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() + "n" : item,
    );
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}
function __log(level, values) {
  const line = (level === "log" ? "" : "[" + level + "] ") + values.map(__format).join(" ");
  if (__logChars + line.length > ${MCP_SCRIPT_LIMITS.logChars}) {
    __logsDropped += 1;
    return;
  }
  __logChars += line.length;
  __logs.push(line);
}
const console = Object.freeze({
  log: (...values) => __log("log", values),
  info: (...values) => __log("info", values),
  warn: (...values) => __log("warn", values),
  error: (...values) => __log("error", values),
  debug: (...values) => __log("debug", values),
});
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
  return { ok: true, value: __value, logs: __logs, logsDropped: __logsDropped };
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
    },
    logs: __logs,
    logsDropped: __logsDropped,
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

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
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
  if (activeRuns >= MCP_SCRIPT_LIMITS.concurrentRuns) {
    return fail(
      "script_busy",
      "Too many scripts are running on this server. Try again shortly, or call the tools directly.",
    );
  }
  activeRuns += 1;
  let stopped = false;
  let callCount = 0;
  let readBytes = 0;
  try {
    const { runner, RunError } = await loadRuntime();
    const record = (call: McpScriptCallRecord) => {
      if (!stopped) calls.push(call);
    };
    const refuse = (
      fn: string,
      action: string | undefined,
      status: "denied" | "refused" | "failed",
      replyCode: string,
      message: string,
      startedAt: number,
    ) => {
      record({
        function: fn,
        ...(action ? { action } : {}),
        status,
        ms: Date.now() - startedAt,
        code: replyCode,
        message: oneLine(message, 300),
      });
      return { ok: false, code: replyCode, message };
    };

    const hostFunctions: HostFunctions = {
      __host: {
        call: async (rawName: unknown, rawArgs: unknown) => {
          const startedAt = Date.now();
          const fn = oneLine(
            typeof rawName === "string"
              ? rawName.replace(/^api\./, "")
              : String(rawName),
            120,
          );
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
          const action = input.catalog.byFunction.get(fn);
          if (!action) {
            const denial = explainMcpScriptDenial(
              fn,
              input.catalog,
              input.known,
            );
            const message = `api.${fn} ${DENIAL_MESSAGES[denial.reason]}.`;
            try {
              await input.recordDenial({
                runId,
                functionName: fn,
                action: denial.action,
                reason: denial.reason,
                message,
                args: rawArgs,
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
          let args: unknown;
          try {
            args = toJsonData(rawArgs === undefined ? {} : rawArgs);
            if (!isSchemaObject(args)) throw new TypeError("not an object");
          } catch {
            return refuse(
              fn,
              action,
              "failed",
              "invalid_arguments",
              `api.${fn} takes one object of JSON data.`,
              startedAt,
            );
          }
          const outcome = await input.callAction(action, args);
          switch (outcome.status) {
            case "completed": {
              if (outcome.reportedError) {
                return refuse(
                  fn,
                  action,
                  "failed",
                  "action_reported_error",
                  `api.${fn} reported an error: ${oneLine(JSON.stringify(outcome.value) ?? "", 500)}`,
                  startedAt,
                );
              }
              const json = JSON.stringify(outcome.value) ?? "null";
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
                  args,
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
            default:
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
        },
      },
    };

    const prelude = guestPrelude([...input.catalog.byFunction.keys()]);
    const offset = lineCount(prelude) + 2;
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
            ? fail(
                "script_result_too_large",
                "The script returned more data than it may. Return less: pick the fields you need, or fewer items.",
              )
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
    const logs = Array.isArray(envelope.logs)
      ? envelope.logs.filter((line): line is string => typeof line === "string")
      : [];
    const logsDropped =
      typeof envelope.logsDropped === "number" ? envelope.logsDropped : 0;
    const shared = {
      runId,
      ...(logs.length > 0 ? { logs } : {}),
      ...(logsDropped > 0 ? { logsDropped } : {}),
      calls: [...calls],
    };
    if (envelope.ok === true) {
      return { ok: true, ...shared, result: plainResultValue(envelope.value) };
    }
    const thrown = isSchemaObject(envelope.error) ? envelope.error : {};
    return {
      ok: false,
      ...shared,
      error: {
        code: "script_error",
        name: oneLine(thrown.name, 80) || "Error",
        message: rebaseLines(
          typeof thrown.message === "string"
            ? thrown.message
            : "The script threw.",
          offset,
        ),
      },
    };
  } finally {
    stopped = true;
    activeRuns -= 1;
  }
}

const MAX_RESULT_DEPTH = 64;

/**
 * A guest value as JSON data. The sandbox hands back BigInt, cycles, `Map`,
 * `Set`, `Date` and binary values, which JSON cannot hold, so each becomes
 * something it can: a BigInt is its digits and `n`, a cycle is marked, a
 * `Map` is an object (or entries when a key is not a string), a `Set` an
 * array, a `Date` its ISO string, and binary data a byte count.
 */
export function plainResultValue(value: unknown): unknown {
  const onPath = new Set<object>();
  const walk = (item: unknown, depth: number): unknown => {
    if (typeof item === "bigint") return `${item.toString()}n`;
    if (typeof item === "number") return Number.isFinite(item) ? item : null;
    if (item === undefined) return null;
    if (item === null || typeof item !== "object") {
      return typeof item === "function" || typeof item === "symbol"
        ? null
        : item;
    }
    if (depth > MAX_RESULT_DEPTH) return "[Too deep]";
    if (onPath.has(item)) return "[Circular]";
    if (item instanceof Date) {
      return Number.isNaN(item.getTime()) ? null : item.toISOString();
    }
    if (item instanceof RegExp) return String(item);
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      return `[${item.byteLength} bytes of binary data]`;
    }
    onPath.add(item);
    try {
      if (item instanceof Error) {
        return { name: item.name, message: item.message };
      }
      if (Array.isArray(item) || item instanceof Set) {
        return [...item].map((member) => walk(member, depth + 1));
      }
      if (item instanceof Map) {
        const entries = [...item];
        return entries.every(([key]) => typeof key === "string")
          ? Object.fromEntries(
              entries.map(([key, member]) => [key, walk(member, depth + 1)]),
            )
          : entries.map(([key, member]) => [
              walk(key, depth + 1),
              walk(member, depth + 1),
            ]);
      }
      const out: Record<string, unknown> = {};
      for (const [key, member] of Object.entries(item)) {
        if (member === undefined) continue;
        out[key] = walk(member, depth + 1);
      }
      return out;
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
    const logs = [...payload.logs];
    let dropped = payload.logsDropped ?? 0;
    while (logs.length > 0 && text.length > maxChars) {
      logs.pop();
      dropped += 1;
      trimmed.logs = logs.length > 0 ? logs : undefined;
      trimmed.logsDropped = dropped;
      text = JSON.stringify(trimmed);
    }
  }
  if (text.length > maxChars && "result" in payload) {
    const resultText = JSON.stringify(payload.result) ?? "null";
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
      userEmail: context.userEmail,
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
