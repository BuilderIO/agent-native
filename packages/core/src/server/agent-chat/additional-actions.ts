import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import type { ActionRunContext } from "../../action.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import { registerStrictToolInput } from "../../agent/strict-tool-input.js";
import { assertRegisteredActionAccess } from "../../authorization/action-access-runtime.js";
import { isMcpToolAllowedForRequest } from "../../mcp-client/visibility.js";
import { ForbiddenError } from "../../sharing/access.js";
import { getRequestOrgId, getRequestUserEmail } from "../request-context.js";

/**
 * The agent loop a request runs on: interactive chat (production or dev), an
 * A2A task, or an MCP `ask_app` call.
 */
export type AgentChatAdditionalActionsSurface = "chat" | "a2a" | "mcp";

/** Surfaces an app must opt into before its additional actions reach them. */
export type AgentChatAdditionalActionsExternalSurface = Exclude<
  AgentChatAdditionalActionsSurface,
  "chat"
>;

export interface AgentChatAdditionalActionsDetails {
  surface: AgentChatAdditionalActionsSurface;
  /** The H3 event. Absent for `mcp`, which runs outside a chat handler. */
  event?: any;
  ownerEmail: string;
  orgId: string | null;
}

export type ResolveAgentChatAdditionalActions = (
  details: AgentChatAdditionalActionsDetails,
) => Record<string, ActionEntry> | Promise<Record<string, ActionEntry>>;

export interface AppAdditionalActionsConfig {
  resolver: ResolveAgentChatAdditionalActions | undefined;
  /** Surfaces besides chat the app opted into. */
  externalSurfaces: readonly AgentChatAdditionalActionsExternalSurface[];
  /**
   * True for every name any surface can dispatch to a framework, template, or
   * dev implementation, including names the current surface leaves out.
   */
  isReservedName: (name: string) => boolean;
}

const EXTERNAL_SURFACES: readonly AgentChatAdditionalActionsExternalSurface[] =
  ["a2a", "mcp"];

// The shape every model provider accepts for a tool name.
const ACTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_SCHEMA_JSON_CHARS = 64_000;
const MAX_SCHEMA_DEPTH = 24;
// Every entry is compiled on every request, so the whole registry is bounded,
// not just each schema.
const MAX_ADDITIONAL_ACTIONS = 128;
const MAX_TOTAL_SCHEMA_JSON_CHARS = 512_000;
const MAX_REPORTED_SKIPS = 1_000;
// Validation can evaluate a shared `$ref` target once per use, so the cap is on
// subschemas after expansion, not on the schema's written size.
const MAX_SCHEMA_EXPANDED_NODES = 5_000;
const MAX_TOTAL_SCHEMA_EXPANDED_NODES = 20_000;
// C0/C1 controls other than tab and newline, zero-width characters, and bidi
// overrides: invisible in logs and tool lists, but read by the model.
const HIDDEN_TEXT_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

const strictAjv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const strictAjv2020 = new Ajv2020({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

const validateAnyObject = strictAjv.compile({ type: "object" });

// Keywords whose values hold subschemas, by shape.
const SUBSCHEMA_KEYWORDS = [
  "additionalProperties",
  "additionalItems",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
];
const SUBSCHEMA_LIST_KEYWORDS = [
  "allOf",
  "anyOf",
  "items",
  "oneOf",
  "prefixItems",
];
const SUBSCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "properties",
];
// Regex keywords run user-chosen patterns synchronously on the event loop, so
// one catastrophic pattern stalls every request in the process. Schema
// identifiers register globally in Ajv and collide across requests and callers.
const FORBIDDEN_SCHEMA_KEYWORDS = [
  "pattern",
  "patternProperties",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
];

// Insertion-ordered, so the oldest key is evicted first once the cap is hit.
const reportedSkips = new Set<string>();

export function normalizeAdditionalActionSurfaces(
  surfaces: readonly string[] | undefined,
): AgentChatAdditionalActionsExternalSurface[] {
  if (surfaces === undefined) return [];
  if (!Array.isArray(surfaces)) {
    throw new TypeError("additionalActionSurfaces must be an array");
  }
  const normalized = new Set<AgentChatAdditionalActionsExternalSurface>();
  for (const surface of surfaces) {
    if (
      !EXTERNAL_SURFACES.includes(
        surface as AgentChatAdditionalActionsExternalSurface,
      )
    ) {
      throw new TypeError(
        `additionalActionSurfaces contains "${String(surface)}"; expected "a2a" or "mcp". Interactive chat always receives additional actions.`,
      );
    }
    normalized.add(surface as AgentChatAdditionalActionsExternalSurface);
  }
  return [...normalized];
}

/**
 * Runs the app's `resolveAdditionalActions` once for one request and returns
 * the entries that may join that request's registry.
 *
 * Everything the app returns is untrusted: it may carry names, descriptions,
 * and schemas a user registered. An entry is dropped (and reported once) when
 * its name is malformed or reserved, when it is an `mcp__` name this caller
 * cannot see, or when its tool definition is unusable. Each kept entry is bound
 * to the caller it was resolved for and its `run` is wrapped so every call,
 * from any dispatcher, rechecks that caller, enforces the entry's `access`
 * policy, and validates the arguments against its schema without coercion.
 */
export async function resolveAppAdditionalActions(
  config: AppAdditionalActionsConfig,
  details: {
    surface: AgentChatAdditionalActionsSurface;
    event?: any;
    ownerEmail: string | null | undefined;
    orgId: string | null | undefined;
  },
  registered: Record<string, ActionEntry>,
): Promise<Record<string, ActionEntry>> {
  const { resolver } = config;
  const { ownerEmail, surface } = details;
  if (!resolver || !ownerEmail) return {};
  if (surface !== "chat" && !config.externalSurfaces.includes(surface)) {
    return {};
  }
  const principal = { ownerEmail, orgId: details.orgId ?? null };
  const entries = await resolver({
    surface,
    event: details.event,
    ...principal,
  });
  if (!isPlainRecord(entries)) {
    throw new TypeError(
      "resolveAdditionalActions must return an object of action entries",
    );
  }
  const names = Object.keys(entries);
  if (names.length > MAX_ADDITIONAL_ACTIONS) {
    reportSkip(
      names[MAX_ADDITIONAL_ACTIONS],
      `is the first of ${names.length - MAX_ADDITIONAL_ACTIONS} entries past the ${MAX_ADDITIONAL_ACTIONS} a resolver may return`,
    );
  }
  const added: Record<string, ActionEntry> = {};
  const schemaBudget: SchemaBudget = {
    remaining: MAX_TOTAL_SCHEMA_JSON_CHARS,
    expandedRemaining: MAX_TOTAL_SCHEMA_EXPANDED_NODES,
  };
  for (const name of names.slice(0, MAX_ADDITIONAL_ACTIONS)) {
    const entry: unknown = entries[name];
    const rejection =
      rejectActionName(name, config, registered) ?? rejectActionEntry(entry);
    if (rejection) {
      reportSkip(name, rejection);
      continue;
    }
    const prepared = prepareActionEntry(
      name,
      entry as ActionEntry,
      principal,
      schemaBudget,
    );
    if (typeof prepared === "string") {
      reportSkip(name, prepared);
      continue;
    }
    added[name] = prepared;
  }
  return added;
}

function rejectActionName(
  name: string,
  config: AppAdditionalActionsConfig,
  registered: Record<string, ActionEntry>,
): string | null {
  if (!ACTION_NAME_PATTERN.test(name)) {
    return "is not a valid action name (letters, digits, '_' and '-', at most 64 characters)";
  }
  if (Object.hasOwn(registered, name) || config.isReservedName(name)) {
    return "is a registered action name";
  }
  if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
    return "is an MCP tool name this caller cannot use";
  }
  return null;
}

function rejectActionEntry(entry: unknown): string | null {
  if (!isPlainRecord(entry)) return "is not an action entry";
  if (typeof entry.run !== "function") return "has no run function";
  if (!isPlainRecord(entry.tool)) return "has no tool definition";
  if (typeof entry.tool.description !== "string") {
    return "has no tool description";
  }
  return null;
}

function prepareActionEntry(
  name: string,
  entry: ActionEntry,
  principal: { ownerEmail: string; orgId: string | null },
  schemaBudget: SchemaBudget,
): ActionEntry | string {
  const description = cleanText(entry.tool.description, MAX_DESCRIPTION_CHARS);
  if (!description) return "has an empty tool description";
  const title =
    typeof entry.tool.title === "string"
      ? cleanText(entry.tool.title, MAX_TITLE_CHARS)
      : undefined;
  const parameters = entry.tool.parameters;
  let validate: ValidateFunction;
  if (parameters === undefined) {
    validate = validateAnyObject;
  } else {
    const rejection = rejectParameterSchema(parameters, schemaBudget);
    if (rejection) return rejection;
    try {
      validate = compileStrict(parameters);
    } catch (error) {
      return `has a tool schema that does not compile: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const { title: _untrustedTitle, ...tool } = entry.tool;
  const run = entry.run;
  const access = entry.access;
  const inputError = (input: unknown): string | null =>
    validate(input)
      ? null
      : strictAjv.errorsText(validate.errors, {
          dataVar: "input",
          separator: "; ",
        });
  const prepared: ActionEntry = {
    ...entry,
    tool: { ...tool, ...(title ? { title } : {}), description },
    run: async (args: unknown, ctx?: ActionRunContext) => {
      const caller = assertBoundCaller(name, principal, ctx);
      const input = args === undefined ? {} : args;
      const error = inputError(input);
      if (error) {
        throw new TypeError(`Invalid arguments for ${name}: ${error}`);
      }
      if (access) {
        await assertRegisteredActionAccess(access, input, {
          ...ctx,
          caller: ctx?.caller ?? "tool",
          userEmail: caller.userEmail,
          orgId: caller.orgId,
        });
      }
      return run(input, ctx);
    },
  };
  // The agent loop would otherwise repair and coerce the model's input before
  // `run` sees it, so a string "3" would reach a number parameter as 3.
  registerStrictToolInput(prepared, (input) =>
    inputError(input === undefined ? {} : input),
  );
  return prepared;
}

/**
 * The entry was resolved for one caller. Whatever dispatcher reaches it — the
 * agent loop, tool orchestration, run-code, a sub-agent — must be running for
 * that same caller, so an entry that escapes its request still cannot act for
 * anyone else.
 */
function assertBoundCaller(
  name: string,
  principal: { ownerEmail: string; orgId: string | null },
  ctx: ActionRunContext | undefined,
): { userEmail: string; orgId: string | null } {
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  const orgId =
    ctx && Object.hasOwn(ctx, "orgId")
      ? (ctx.orgId ?? null)
      : (getRequestOrgId() ?? null);
  if (
    !userEmail ||
    userEmail.trim().toLowerCase() !==
      principal.ownerEmail.trim().toLowerCase() ||
    orgId !== principal.orgId ||
    (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name))
  ) {
    throw new ForbiddenError(`${name} is not available to this caller.`);
  }
  return { userEmail, orgId };
}

function rejectParameterSchema(
  parameters: unknown,
  schemaBudget: SchemaBudget,
): string | null {
  if (!isPlainRecord(parameters))
    return "has a tool schema that is not an object";
  if (parameters.type !== "object") {
    return 'has a tool schema whose root type is not "object"';
  }
  if (
    parameters.properties !== undefined &&
    !isPlainRecord(parameters.properties)
  ) {
    return "has a tool schema whose properties are not an object";
  }
  // Both request budgets are charged for the work done, accepted or not, so
  // entries that each fail late cannot each spend a full per-schema budget.
  const limit = Math.min(MAX_SCHEMA_JSON_CHARS, schemaBudget.remaining);
  const measured = measureSchema(parameters, limit);
  schemaBudget.remaining -= measured.size;
  if (measured.failure === "not-json") {
    return "has a tool schema that is not JSON";
  }
  if (measured.failure === "too-deep") {
    return `has a tool schema nested deeper than ${MAX_SCHEMA_DEPTH} levels`;
  }
  if (measured.failure === "too-large") {
    return limit < MAX_SCHEMA_JSON_CHARS
      ? `has a tool schema that exceeds the ${MAX_TOTAL_SCHEMA_JSON_CHARS}-character budget shared by this request's schemas`
      : `has a tool schema larger than ${MAX_SCHEMA_JSON_CHARS} characters`;
  }
  const walk: SchemaWalk = {
    expanded: 0,
    limit: Math.min(MAX_SCHEMA_EXPANDED_NODES, schemaBudget.expandedRemaining),
    refStack: new Set([parameters]),
  };
  const rejection = rejectSchemaKeywords(parameters, parameters, walk);
  schemaBudget.expandedRemaining -= walk.expanded;
  if (rejection === "too-expanded") {
    return walk.limit < MAX_SCHEMA_EXPANDED_NODES
      ? `has a tool schema that exceeds the ${MAX_TOTAL_SCHEMA_EXPANDED_NODES}-subschema budget shared by this request's schemas`
      : `has a tool schema that expands to more than ${MAX_SCHEMA_EXPANDED_NODES} subschemas through $ref`;
  }
  return rejection;
}

interface SchemaBudget {
  remaining: number;
  expandedRemaining: number;
}

interface SchemaWalk {
  expanded: number;
  limit: number;
  /** The `$ref` targets being expanded, outermost first. */
  refStack: Set<object>;
}

/**
 * Approximates the schema's JSON length without serializing it, and stops as
 * soon as it passes `limit` or `MAX_SCHEMA_DEPTH`, so an oversized or cyclic
 * schema costs no more than the budget it is rejected for.
 */
function measureSchema(
  value: unknown,
  limit: number,
): { size: number; failure: "too-large" | "too-deep" | "not-json" | null } {
  let size = 0;
  const visit = (
    node: unknown,
    depth: number,
  ): "too-large" | "too-deep" | "not-json" | null => {
    if (depth > MAX_SCHEMA_DEPTH) return "too-deep";
    if (node === null || typeof node === "boolean") size += 5;
    else if (typeof node === "number") size += 24;
    else if (typeof node === "string") size += node.length + 2;
    else if (typeof node !== "object") return "not-json";
    else {
      size += 2;
      const isArray = Array.isArray(node);
      for (const key in node) {
        if (!Object.hasOwn(node, key)) continue;
        const child = (node as Record<string, unknown>)[key];
        if (child === undefined && !isArray) continue;
        size += (isArray ? 0 : key.length + 3) + 1;
        if (size > limit) return "too-large";
        const failure = visit(child, depth + 1);
        if (failure) return failure;
      }
    }
    return size > limit ? "too-large" : null;
  };
  const failure = visit(value, 0);
  return { size, failure };
}

/**
 * Walks every location Ajv may evaluate as a schema: the subschema keywords
 * and the target of each local `$ref`, which can point anywhere in the
 * document, including under keys no keyword names.
 *
 * Each `$ref` is expanded where it is used, as validation evaluates it, so a
 * small schema that references the same definition several times per level
 * shows its exponential validation cost here and is rejected. A `$ref` back
 * into a schema it is already inside is refused outright: even when each
 * level steps into a property or item, a recursive schema with more than one
 * reference per level costs validation exponential work in the input's
 * nesting depth, which the expansion count cannot see.
 */
function rejectSchemaKeywords(
  schema: unknown,
  root: Record<string, unknown>,
  walk: SchemaWalk,
): string | null {
  if (!isPlainRecord(schema)) return null;
  walk.expanded += 1;
  if (walk.expanded > walk.limit) return "too-expanded";
  for (const keyword of FORBIDDEN_SCHEMA_KEYWORDS) {
    if (Object.hasOwn(schema, keyword)) {
      return `has a tool schema that uses "${keyword}", which app actions may not use`;
    }
  }
  if (Object.hasOwn(schema, "$ref")) {
    const target = resolveLocalRef(root, schema.$ref);
    if (target === undefined) {
      return 'has a tool schema with a $ref that is not "#" or an unencoded JSON pointer inside the schema';
    }
    if (isPlainRecord(target)) {
      if (walk.refStack.has(target)) {
        return "has a tool schema with a recursive $ref";
      }
      walk.refStack.add(target);
      const rejection = rejectSchemaKeywords(target, root, walk);
      walk.refStack.delete(target);
      if (rejection) return rejection;
    }
  }
  const children: unknown[] = [];
  for (const keyword of SUBSCHEMA_KEYWORDS) children.push(schema[keyword]);
  for (const keyword of SUBSCHEMA_LIST_KEYWORDS) {
    if (Array.isArray(schema[keyword])) children.push(...schema[keyword]);
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    if (isPlainRecord(schema[keyword])) {
      children.push(...Object.values(schema[keyword]));
    }
  }
  for (const child of children) {
    const rejection = rejectSchemaKeywords(child, root, walk);
    if (rejection) return rejection;
  }
  return null;
}

/**
 * Ajv percent-decodes the whole fragment before splitting it into pointer
 * segments, so an encoded `/` addresses a different location than a
 * segment-by-segment reading would. Encoded refs are refused rather than
 * reimplementing that decoding.
 */
function resolveLocalRef(root: Record<string, unknown>, ref: unknown): unknown {
  if (ref === "#") return root;
  if (typeof ref !== "string" || !ref.startsWith("#/") || ref.includes("%")) {
    return undefined;
  }
  let target: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (
      !target ||
      typeof target !== "object" ||
      !Object.hasOwn(target, segment)
    ) {
      return undefined;
    }
    target = (target as Record<string, unknown>)[segment];
  }
  return target;
}

function compileStrict(schema: object): ValidateFunction {
  const declared = (schema as { $schema?: unknown }).$schema;
  const dialect =
    typeof declared === "string" ? declared.replace(/#$/, "") : undefined;
  const ajv =
    dialect === "https://json-schema.org/draft/2020-12/schema"
      ? strictAjv2020
      : strictAjv;
  // Resolvers usually build fresh schema objects per request; Ajv keeps every
  // compiled schema in a strong cache, so drop it once the validator exists.
  try {
    return ajv.compile(schema);
  } finally {
    ajv.removeSchema(schema);
  }
}

function cleanText(value: string, maxChars: number): string {
  const cleaned = value.replace(HIDDEN_TEXT_PATTERN, "").trim();
  return cleaned.length > maxChars
    ? `${cleaned.slice(0, maxChars - 1)}…`
    : cleaned;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportSkip(name: string, reason: string): void {
  const shown = JSON.stringify(name.slice(0, 80));
  const key = `${shown}\u0000${reason.slice(0, 200)}`;
  if (reportedSkips.has(key)) return;
  if (reportedSkips.size >= MAX_REPORTED_SKIPS) {
    reportedSkips.delete(reportedSkips.values().next().value as string);
  }
  reportedSkips.add(key);
  console.warn(
    `[agent-chat] resolveAdditionalActions returned ${shown}, which ${reason}; ignoring the app entry.`,
  );
}
