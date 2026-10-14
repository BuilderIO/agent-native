import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import type { ActionRunContext } from "../../action.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import { registerStrictToolInput } from "../../agent/strict-tool-input.js";
import { assertRegisteredActionAccess } from "../../authorization/action-access-runtime.js";
import { normalizeMcpPrincipal } from "../../mcp-client/principal.js";
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
// Without recursion, validation evaluates each expanded subschema at most once
// per input value, so a call is refused before Ajv runs when the product of the
// two passes this. Ajv validates synchronously; nothing can interrupt it.
const MAX_VALIDATION_WORK = 20_000_000;
// Every length check scans the whole string, so a few characters cost as much
// as one value.
const INPUT_STRING_CHARS_PER_UNIT = 4;
// C0/C1 controls other than tab and newline, zero-width characters, and bidi
// overrides: invisible in logs and tool lists, but read by the model.
const HIDDEN_TEXT_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

// Formats are annotations here: no format validators are installed.
const strictAjvOptions = {
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: false,
} as const;
const strictAjv = new Ajv(strictAjvOptions);
const strictAjv2020 = new Ajv2020(strictAjvOptions);
// A cached validator's own instance skips the meta-schemas, which cost about
// 30 ms to set up per instance; the shared instances above check each schema
// against its meta-schema instead, which retains nothing per schema.
const compileAjvOptions = {
  ...strictAjvOptions,
  meta: false,
  validateSchema: false,
} as const;
const validateAnyObject = strictAjv.compile({ type: "object" });
// allErrors reports every failure; the model needs the first few.
const MAX_REPORTED_INPUT_ERRORS = 10;
// Compiling is synchronous and costs about as much as the schema is large, and
// a caller's tools rarely change between runs, so validators are reused by
// checked schema text. Each is compiled in its own Ajv instance, because Ajv
// keeps every schema it compiles in instance-wide state; evicting an entry
// frees it. The cache is bounded by expanded subschemas and by entries.
const MAX_CACHED_VALIDATOR_NODES = 60_000;
const MAX_CACHED_VALIDATORS = 256;
const validatorCache = new Map<
  string,
  { validate: ValidateFunction; expanded: number }
>();
let cachedValidatorNodes = 0;

// The keywords app schemas may use, by the shape of their value. Every other
// key in a schema is refused by name rather than ignored. Ajv's identifier scan
// walks every key it does not know, so an unknown key can hide a `$id` that
// rebases `$ref`s onto parts of the schema nobody checked. Keywords left out on
// purpose: `pattern`/`patternProperties` (regexes run synchronously),
// `uniqueItems` (quadratic in the input), `$async` (validation that returns a
// promise), identifiers and anchors (registered in Ajv's shared state), and
// the `unevaluated*` and `dependent*` keywords.
const SCHEMA_KEYWORDS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
]);
const SCHEMA_LIST_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "items",
  "oneOf",
  "prefixItems",
]);
const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "properties",
]);
const VALUE_KEYWORDS = new Set([
  "$comment",
  "$ref",
  "$schema",
  "const",
  "contentEncoding",
  "contentMediaType",
  "default",
  "deprecated",
  "description",
  "enum",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "readOnly",
  "required",
  "title",
  "type",
  "writeOnly",
]);

// Each dialect ignores the other's array keywords instead of enforcing them:
// schemas without a 2020-12 `$schema` compile as draft-07.
const DRAFT_2020_ONLY_KEYWORDS = new Set([
  "maxContains",
  "minContains",
  "prefixItems",
]);
const DRAFT_07_ONLY_KEYWORDS = new Set(["additionalItems"]);
const DRAFT_2020_DIALECT = "https://json-schema.org/draft/2020-12/schema";

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
  // Anonymous callers get no app actions, by the same rule as MCP tools.
  if (
    !resolver ||
    !ownerEmail ||
    !normalizeMcpPrincipal({ userEmail: ownerEmail, orgId: details.orgId })
  ) {
    return {};
  }
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
  // Assigning it to a registry object sets the prototype instead of a key.
  if (name === "__proto__") return "is not a valid action name";
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
  // Read each field once: a getter could return one value to the checks and
  // another to the copy the model and dispatcher use.
  const {
    title: rawTitle,
    description: rawDescription,
    parameters: rawParameters,
    ...tool
  } = entry.tool;
  if (typeof rawDescription !== "string") return "has no tool description";
  const description = cleanText(rawDescription, MAX_DESCRIPTION_CHARS);
  if (!description) return "has an empty tool description";
  const title =
    typeof rawTitle === "string"
      ? cleanText(rawTitle, MAX_TITLE_CHARS)
      : undefined;
  let validate: ValidateFunction = validateAnyObject;
  let expandedSize = 1;
  let parameters: Record<string, unknown> | undefined;
  if (rawParameters !== undefined) {
    const checked = checkParameterSchema(rawParameters, schemaBudget);
    if (typeof checked === "string") return checked;
    ({ schema: parameters, expanded: expandedSize } = checked);
    try {
      validate = compileStrict(parameters, expandedSize);
    } catch (error) {
      return `has a tool schema that does not compile: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const run = entry.run;
  const access = entry.access;
  const maxInputUnits = Math.floor(MAX_VALIDATION_WORK / expandedSize);
  const inputError = (input: unknown): string | null => {
    if (!inputFitsUnits(input, maxInputUnits)) {
      return `arguments are too large to validate against this tool's schema; send less data`;
    }
    if (validate(input)) return null;
    const errors = validate.errors ?? [];
    const shown = strictAjv.errorsText(
      errors.slice(0, MAX_REPORTED_INPUT_ERRORS),
      { dataVar: "input", separator: "; " },
    );
    return errors.length > MAX_REPORTED_INPUT_ERRORS
      ? `${shown}; and ${errors.length - MAX_REPORTED_INPUT_ERRORS} more`
      : shown;
  };
  const prepared: ActionEntry = {
    ...entry,
    // The model sees exactly the schema that was checked and compiled.
    tool: {
      ...tool,
      ...(parameters
        ? {
            parameters:
              parameters as unknown as ActionEntry["tool"]["parameters"],
          }
        : {}),
      ...(title ? { title } : {}),
      description,
    },
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

/**
 * Copies the app's schema into plain JSON data, checks it, and returns the copy
 * with its size after `$ref` expansion. Everything after this point, the
 * keyword check, Ajv, and the tool list the model sees, uses the copy, so a
 * getter, prototype, or proxy in the app's object cannot show the checks one
 * schema and Ajv another.
 */
function checkParameterSchema(
  parameters: unknown,
  schemaBudget: SchemaBudget,
): { schema: Record<string, unknown>; expanded: number } | string {
  // Both request budgets are charged for the work done, accepted or not, so
  // entries that each fail late cannot each spend a full per-schema budget.
  const limit = Math.min(MAX_SCHEMA_JSON_CHARS, schemaBudget.remaining);
  const copied = copyJsonValue(parameters, limit);
  schemaBudget.remaining -= copied.size;
  if (copied.failure === "too-deep") {
    return `has a tool schema nested deeper than ${MAX_SCHEMA_DEPTH} levels`;
  }
  if (copied.failure === "too-large") {
    return limit < MAX_SCHEMA_JSON_CHARS
      ? `has a tool schema that exceeds the ${MAX_TOTAL_SCHEMA_JSON_CHARS}-character budget shared by this request's schemas`
      : `has a tool schema larger than ${MAX_SCHEMA_JSON_CHARS} characters`;
  }
  if (copied.failure) {
    return `has a tool schema that is not plain JSON data (${copied.failure})`;
  }
  const schema = copied.value;
  if (!isPlainRecord(schema)) return "has a tool schema that is not an object";
  if (schema.type !== "object") {
    return 'has a tool schema whose root type is not "object"';
  }
  if (schema.properties !== undefined && !isPlainRecord(schema.properties)) {
    return "has a tool schema whose properties are not an object";
  }
  const walk: SchemaWalk = {
    expanded: 0,
    limit: Math.min(MAX_SCHEMA_EXPANDED_NODES, schemaBudget.expandedRemaining),
    refStack: new Set([schema]),
    draft2020: isDraft2020(schema),
  };
  const rejection = rejectSchemaKeywords(schema, schema, walk);
  schemaBudget.expandedRemaining -= walk.expanded;
  if (rejection === "too-expanded") {
    return walk.limit < MAX_SCHEMA_EXPANDED_NODES
      ? `has a tool schema that exceeds the ${MAX_TOTAL_SCHEMA_EXPANDED_NODES}-subschema budget shared by this request's schemas`
      : `has a tool schema that expands to more than ${MAX_SCHEMA_EXPANDED_NODES} subschemas through $ref`;
  }
  if (rejection) return rejection;
  return { schema, expanded: walk.expanded };
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
  draft2020: boolean;
}

type CopyFailure =
  | "too-large"
  | "too-deep"
  | "a value that is not JSON"
  | "an object with a custom prototype"
  | "a getter or setter"
  | "a __proto__ key"
  | "an array with holes";

/**
 * Copies own data properties of plain objects and dense arrays, approximating
 * the JSON length as it goes and stopping as soon as it passes `limit` or
 * `MAX_SCHEMA_DEPTH`, so an oversized or cyclic value costs no more than the
 * budget it is rejected for.
 */
function copyJsonValue(
  value: unknown,
  limit: number,
): { value?: unknown; size: number; failure: CopyFailure | null } {
  let size = 0;
  let failure: CopyFailure | null = null;
  const fail = (reason: CopyFailure) => {
    failure = reason;
    return undefined;
  };
  const copy = (node: unknown, depth: number): unknown => {
    if (depth > MAX_SCHEMA_DEPTH) return fail("too-deep");
    if (node === null || typeof node === "boolean") {
      size += 5;
      return node;
    }
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return fail("a value that is not JSON");
      size += 24;
      return node;
    }
    if (typeof node === "string") {
      size += node.length + 2;
      return size > limit ? fail("too-large") : node;
    }
    if (typeof node !== "object") return fail("a value that is not JSON");
    const prototype = Object.getPrototypeOf(node);
    size += 2;
    if (Array.isArray(node)) {
      if (prototype !== Array.prototype) {
        return fail("an object with a custom prototype");
      }
      const out: unknown[] = [];
      for (let index = 0; index < node.length; index += 1) {
        size += 1;
        if (size > limit) return fail("too-large");
        const descriptor = Object.getOwnPropertyDescriptor(node, index);
        if (!descriptor) return fail("an array with holes");
        if (!("value" in descriptor)) return fail("a getter or setter");
        out.push(copy(descriptor.value, depth + 1));
        if (failure) return undefined;
      }
      return out;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("an object with a custom prototype");
    }
    const out: Record<string, unknown> = {};
    for (const key in node) {
      if (!Object.hasOwn(node, key)) continue;
      if (key === "__proto__") return fail("a __proto__ key");
      const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
      if (!("value" in descriptor)) return fail("a getter or setter");
      if (descriptor.value === undefined) continue;
      size += key.length + 4;
      if (size > limit) return fail("too-large");
      out[key] = copy(descriptor.value, depth + 1);
      if (failure) return undefined;
    }
    return out;
  };
  const copied = copy(value, 0);
  return failure ? { size, failure } : { value: copied, size, failure: null };
}

/**
 * Walks every location Ajv evaluates as a schema, refusing keys outside the
 * allowlist and following each local `$ref`.
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
  // Boolean subschemas are compiled and evaluated too, so they count.
  walk.expanded += 1;
  if (walk.expanded > walk.limit) return "too-expanded";
  if (typeof schema === "boolean") return null;
  if (!isPlainRecord(schema)) {
    return "has a tool schema with a subschema that is not an object or boolean";
  }
  for (const [keyword, value] of Object.entries(schema)) {
    let rejection: string | null = null;
    if (
      walk.draft2020
        ? DRAFT_07_ONLY_KEYWORDS.has(keyword)
        : DRAFT_2020_ONLY_KEYWORDS.has(keyword)
    ) {
      rejection = walk.draft2020
        ? `has a tool schema that uses "${keyword}", which draft 2020-12 does not enforce`
        : `has a tool schema that uses "${keyword}" without "$schema": "${DRAFT_2020_DIALECT}", so it would not be enforced`;
    } else if (keyword === "items" && Array.isArray(value)) {
      rejection = rejectEach(value, root, walk);
    } else if (SCHEMA_KEYWORDS.has(keyword)) {
      rejection = rejectSchemaKeywords(value, root, walk);
    } else if (SCHEMA_LIST_KEYWORDS.has(keyword)) {
      rejection = Array.isArray(value)
        ? rejectEach(value, root, walk)
        : `has a tool schema whose "${keyword}" is not an array`;
    } else if (SCHEMA_MAP_KEYWORDS.has(keyword)) {
      if (!isPlainRecord(value)) {
        rejection = `has a tool schema whose "${keyword}" is not an object`;
      } else {
        // `dependencies` maps a property to a schema or to required names,
        // which are counted like `required`.
        const children: unknown[] = [];
        for (const child of Object.values(value)) {
          if (keyword === "dependencies" && Array.isArray(child)) {
            walk.expanded += countJsonNodes(child);
          } else {
            children.push(child);
          }
        }
        rejection =
          walk.expanded > walk.limit
            ? "too-expanded"
            : rejectEach(children, root, walk);
      }
    } else if (keyword === "$ref") {
      rejection = rejectRef(value, root, walk);
    } else if (keyword === "$schema" && schema !== root) {
      rejection = 'has a tool schema that sets "$schema" below its root';
    } else if (
      keyword === "enum" ||
      keyword === "const" ||
      keyword === "required"
    ) {
      // Each listed value is compared against, or looked up in, the input.
      walk.expanded += countJsonNodes(value);
      if (walk.expanded > walk.limit) return "too-expanded";
    } else if (!VALUE_KEYWORDS.has(keyword)) {
      rejection = `has a tool schema that uses "${keyword.slice(0, 80)}", which app actions may not use`;
    }
    if (rejection) return rejection;
  }
  return null;
}

function rejectEach(
  schemas: readonly unknown[],
  root: Record<string, unknown>,
  walk: SchemaWalk,
): string | null {
  for (const child of schemas) {
    const rejection = rejectSchemaKeywords(child, root, walk);
    if (rejection) return rejection;
  }
  return null;
}

function rejectRef(
  ref: unknown,
  root: Record<string, unknown>,
  walk: SchemaWalk,
): string | null {
  const target = resolveLocalRef(root, ref);
  if (target === undefined) {
    return 'has a tool schema with a $ref that is not "#" or an unencoded JSON pointer inside the schema';
  }
  // Only objects can recurse, but every target, boolean ones included, is
  // evaluated where the $ref is used and counts toward the budget.
  const recursive = isPlainRecord(target);
  if (recursive && walk.refStack.has(target)) {
    return "has a tool schema with a recursive $ref";
  }
  if (recursive) walk.refStack.add(target);
  const rejection = rejectSchemaKeywords(target, root, walk);
  if (recursive) walk.refStack.delete(target);
  return rejection;
}

function countJsonNodes(value: unknown): number {
  if (!value || typeof value !== "object") return 1;
  let count = 1;
  for (const child of Object.values(value)) count += countJsonNodes(child);
  return count;
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

/**
 * Counts the input's values and object keys (long strings count once per
 * `INPUT_STRING_CHARS_PER_UNIT` characters; `propertyNames` checks keys like
 * strings) and stops at `maxUnits`. The walk is iterative because the model
 * controls how deeply its arguments nest.
 */
function inputFitsUnits(input: unknown, maxUnits: number): boolean {
  let units = 0;
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const node = pending.pop();
    units +=
      typeof node === "string"
        ? 1 + Math.floor(node.length / INPUT_STRING_CHARS_PER_UNIT)
        : 1;
    if (units > maxUnits) return false;
    // Every queued node costs at least one unit, so stop queuing as soon as
    // the queue alone is over budget rather than after copying a huge node.
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        pending.push(node[i]);
        if (units + pending.length > maxUnits) return false;
      }
    } else if (node && typeof node === "object") {
      for (const key in node) {
        if (!Object.hasOwn(node, key)) continue;
        pending.push(key, (node as Record<string, unknown>)[key]);
        if (units + pending.length > maxUnits) return false;
      }
    }
  }
  return true;
}

function compileStrict(
  schema: Record<string, unknown>,
  expanded: number,
): ValidateFunction {
  const is2020 = isDraft2020(schema);
  const key = `${is2020 ? "2020" : "7"} ${JSON.stringify(schema)}`;
  const cached = validatorCache.get(key);
  if (cached) {
    validatorCache.delete(key);
    validatorCache.set(key, cached);
    return cached.validate;
  }
  const metaAjv = is2020 ? strictAjv2020 : strictAjv;
  if (!metaAjv.validateSchema(schema)) {
    throw new Error(`schema is invalid: ${metaAjv.errorsText(metaAjv.errors)}`);
  }
  const ajv = is2020
    ? new Ajv2020(compileAjvOptions)
    : new Ajv(compileAjvOptions);
  const validate = ajv.compile(schema);
  if ((validate as { $async?: unknown }).$async) {
    throw new Error("the schema validates asynchronously");
  }
  validatorCache.set(key, { validate, expanded });
  cachedValidatorNodes += expanded;
  for (const [oldest, entry] of validatorCache) {
    if (
      cachedValidatorNodes <= MAX_CACHED_VALIDATOR_NODES &&
      validatorCache.size <= MAX_CACHED_VALIDATORS
    ) {
      break;
    }
    validatorCache.delete(oldest);
    cachedValidatorNodes -= entry.expanded;
  }
  return validate;
}

function isDraft2020(schema: Record<string, unknown>): boolean {
  const declared = schema.$schema;
  return (
    typeof declared === "string" &&
    declared.replace(/#$/, "") === DRAFT_2020_DIALECT
  );
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
