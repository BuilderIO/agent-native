import { operationItemId } from "../triage/ids.js";
import type { TripwireSink } from "../tripwire/types.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { evaluatePath, validateResponsePath } from "../workflow/expressions.js";
import {
  MAX_INLINE_ITEMS,
  boundItem,
  capInlineItems,
  normalizedItemSchema,
  type NormalizedItem,
} from "../workflow/items.js";
import {
  parseMappedSource,
  type OperationDefinition,
  type OperationField,
} from "../workflow/operations.js";

/** Matches `WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS`: what a workflow action may fill before the engine's 50,000-character tool-result cut. */
export const PROVIDER_OUTPUT_BUDGET_CHARS = 34_000;
// Room for the action's own envelope (status, ids, flags) around the payload.
const ENVELOPE_RESERVE_CHARS = 600;
/** What the response itself (or the item list) may fill, before the envelope around it. */
export const PROVIDER_PAYLOAD_BUDGET_CHARS =
  PROVIDER_OUTPUT_BUDGET_CHARS - ENVELOPE_RESERVE_CHARS;

type ProviderOperationFailureCode =
  | "unknown_field"
  | "missing_field"
  | "invalid_field"
  | "unsafe_path_value"
  | "invalid_table"
  | "unsafe_placeholder"
  | "unbound_placeholder"
  | "unexpected_response";

/** Never carries a response body or a field value, only the operation id and which part was wrong. */
export class ProviderOperationError extends Error {
  readonly code: ProviderOperationFailureCode;
  readonly operationId: string;

  constructor(
    code: ProviderOperationFailureCode,
    operationId: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderOperationError";
    this.code = code;
    this.operationId = operationId;
  }
}

type ProviderRequestImplementation = Extract<
  OperationDefinition["implementation"],
  { type: "provider-request" }
>;

interface ProviderRequestInput {
  fields: Readonly<Record<string, unknown>>;
  /** The stored position of a cursor source; absent on its first run. */
  cursor?: string;
  /** The span of a window source, as ISO timestamps. */
  window?: { from: string; to: string };
}

export interface BuiltProviderRequest {
  method: ProviderRequestImplementation["method"];
  /** Percent-encoded. May still hold `{projectId}`-style tokens, which core fills from the connection. */
  path: string;
  query: Record<string, string>;
  body?: unknown;
  /** Declared optional path placeholders left for core to fill. */
  openPlaceholders: readonly string[];
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const WHOLE_PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

// A path value is one segment unless its field is listed here. A field a
// graph fills from message text must not be able to reach another endpoint.
const MULTI_SEGMENT_PATH_FIELDS: Readonly<
  Record<string, { min: number; max: number }>
> = {
  repo: { min: 2, max: 2 },
  path: { min: 1, max: Number.POSITIVE_INFINITY },
};

// `table` is pasted into SQL text, so only a dotted name of identifier
// characters may go there. The backtick that quotes it can never appear.
const BIGQUERY_TABLE =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[A-Za-z0-9_]{1,128}\.[A-Za-z0-9_]{1,1024}$/;

/**
 * The only way a field may be pasted into the middle of a JSON body string.
 * A body string is where SQL and other query text live, so a field with no
 * validator listed here is refused rather than pasted.
 */
const BODY_TEXT_VALIDATORS: Readonly<
  Record<string, Readonly<Record<string, (text: string) => string | null>>>
> = {
  "bigquery.billingQuery": {
    table: (text) =>
      BIGQUERY_TABLE.test(text)
        ? null
        : "must be a table name like project.dataset.table, with letters, digits and underscores only",
  },
};

const DROP = Symbol("drop");
const DROP_ENCLOSING = Symbol("drop-enclosing");
type Dropped = typeof DROP | typeof DROP_ENCLOSING;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  code: ProviderOperationFailureCode,
  def: OperationDefinition,
  message: string,
): never {
  throw new ProviderOperationError(code, def.id, `${def.id}: ${message}`);
}

function describeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return "text";
  return typeof value;
}

/** Same rules as the engine's field check, so a direct caller gets the answer a node would. */
function checkFieldValue(field: OperationField, value: unknown): string | null {
  switch (field.type) {
    case "string":
    case "text":
      return typeof value === "string"
        ? null
        : `expected text but got ${describeKind(value)}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `expected a number but got ${describeKind(value)}`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `expected true or false but got ${describeKind(value)}`;
    case "enum":
      return typeof value === "string" && (field.enum ?? []).includes(value)
        ? null
        : `expected one of ${(field.enum ?? []).join(", ")}`;
    case "json":
      return null;
  }
}

function isBound(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return !(typeof value === "string" && value.trim() === "");
}

type Slot =
  | { kind: "literal" }
  | { kind: "bound"; value: unknown }
  | { kind: "unbound"; required: boolean; engine: boolean };

interface Resolved {
  slot(name: string): Slot;
}

function resolveInput(
  def: OperationDefinition,
  input: ProviderRequestInput,
): Resolved {
  const declared = new Map(def.fields.map((field) => [field.name, field]));
  for (const name of Object.keys(input.fields)) {
    if (!declared.has(name)) {
      fail("unknown_field", def, `has no field "${name}".`);
    }
  }
  if (input.cursor !== undefined && !def.cursor) {
    fail("invalid_field", def, "does not read from a cursor.");
  }
  if (input.window && !def.window) {
    fail("invalid_field", def, "does not read a window.");
  }

  const values = new Map<string, unknown>();
  const required = new Set<string>();
  for (const field of def.fields) {
    const given = input.fields[field.name];
    const value = isBound(given) ? given : field.default;
    if (isBound(value)) {
      const problem = checkFieldValue(field, value);
      if (problem) fail("invalid_field", def, `"${field.name}" ${problem}.`);
      values.set(field.name, value);
    }
    if (field.required) required.add(field.name);
  }
  if (def.window) {
    required.add(def.window.fromParam);
    required.add(def.window.toParam);
    for (const [param, value] of [
      [def.window.fromParam, input.window?.from],
      [def.window.toParam, input.window?.to],
    ] as const) {
      if (value === undefined) continue;
      if (Number.isNaN(Date.parse(value))) {
        fail("invalid_field", def, `the window's "${param}" is not a date.`);
      }
      values.set(param, value);
    }
  }
  if (def.cursor && input.cursor !== undefined && isBound(input.cursor)) {
    values.set(def.cursor.param, input.cursor);
  }
  if (def.cursor?.forward) {
    // The first run has no position and asks for the newest rows to prime on;
    // every run after it pages forward from the stored position.
    const { param, forward } = def.cursor;
    values.set(
      forward.sortParam,
      values.has(param) ? forward.oldestFirst : forward.newestFirst,
    );
  }
  for (const name of required) {
    if (!values.has(name)) {
      fail("missing_field", def, `needs a value for "${name}".`);
    }
  }

  const known = new Set<string>([
    ...declared.keys(),
    ...(def.cursor ? [def.cursor.param] : []),
    ...(def.cursor?.forward ? [def.cursor.forward.sortParam] : []),
    ...(def.window ? [def.window.fromParam, def.window.toParam] : []),
  ]);
  return {
    slot(name) {
      if (!known.has(name)) return { kind: "literal" };
      if (values.has(name)) return { kind: "bound", value: values.get(name) };
      return {
        kind: "unbound",
        required: required.has(name),
        engine: name === def.cursor?.param,
      };
    },
  };
}

function scalarText(
  def: OperationDefinition,
  name: string,
  value: unknown,
): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return fail(
    "invalid_field",
    def,
    `"${name}" is ${describeKind(value)}, which cannot go into text or a query.`,
  );
}

function hasControlOrBackslash(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function decodedOnce(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // coercion-ok: an undecodable segment is checked as written, which is the stricter reading
    return segment;
  }
}

function encodePathValue(
  def: OperationDefinition,
  name: string,
  value: unknown,
): string {
  const text = scalarText(def, name, value);
  const segments = text.split("/");
  const shape = MULTI_SEGMENT_PATH_FIELDS[name] ?? { min: 1, max: 1 };
  if (segments.length < shape.min || segments.length > shape.max) {
    fail(
      "unsafe_path_value",
      def,
      shape.max === 1
        ? `"${name}" is one path segment and cannot contain "/".`
        : `"${name}" does not have the shape this path needs.`,
    );
  }
  for (const segment of segments) {
    const plain = decodedOnce(segment);
    if (
      segment === "" ||
      plain === "." ||
      plain === ".." ||
      hasControlOrBackslash(plain)
    ) {
      fail(
        "unsafe_path_value",
        def,
        `"${name}" has an empty, dot or control-character segment.`,
      );
    }
  }
  return segments.map(encodeURIComponent).join("/");
}

function renderPath(
  def: OperationDefinition,
  template: string,
  resolved: Resolved,
): { path: string; open: string[] } {
  const open: string[] = [];
  const path = template.replace(PLACEHOLDER, (match, name: string) => {
    const slot = resolved.slot(name);
    if (slot.kind === "literal") return match;
    if (slot.kind === "bound") return encodePathValue(def, name, slot.value);
    if (slot.required)
      fail("missing_field", def, `needs a value for "${name}".`);
    open.push(name);
    return match;
  });
  return { path, open };
}

function renderString(
  def: OperationDefinition,
  template: string,
  resolved: Resolved,
  where: "query" | "body",
): unknown | Dropped {
  const whole = WHOLE_PLACEHOLDER.exec(template);
  if (whole) {
    const name = whole[1];
    const slot = resolved.slot(name);
    if (slot.kind === "literal") return template;
    if (slot.kind === "bound") {
      return where === "query" ? scalarText(def, name, slot.value) : slot.value;
    }
    if (slot.required)
      fail("missing_field", def, `needs a value for "${name}".`);
    // The first run of a cursor source has no position: its filter goes, not
    // just its value, so the request asks for the newest page.
    return slot.engine ? DROP_ENCLOSING : DROP;
  }
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const slot = resolved.slot(name);
    if (slot.kind === "literal") return match;
    if (slot.kind === "unbound") {
      return slot.required
        ? fail("missing_field", def, `needs a value for "${name}".`)
        : fail(
            "unbound_placeholder",
            def,
            `"${name}" is optional but sits inside text, so it cannot be left out.`,
          );
    }
    const text = scalarText(def, name, slot.value);
    if (where === "query") return text;
    const validate = BODY_TEXT_VALIDATORS[def.id]?.[name];
    if (!validate) {
      return fail(
        "unsafe_placeholder",
        def,
        `"${name}" is pasted into body text and has no validator, so it is refused.`,
      );
    }
    const problem = validate(text);
    if (problem) {
      return fail(
        name === "table" ? "invalid_table" : "invalid_field",
        def,
        `"${name}" ${problem}.`,
      );
    }
    return text;
  });
}

function renderBody(
  def: OperationDefinition,
  node: unknown,
  resolved: Resolved,
): unknown | Dropped {
  if (typeof node === "string") {
    return renderString(def, node, resolved, "body");
  }
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const element of node) {
      const rendered = renderBody(def, element, resolved);
      if (rendered === DROP || rendered === DROP_ENCLOSING) continue;
      out.push(rendered);
    }
    return out;
  }
  if (isRecord(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const rendered = renderBody(def, value, resolved);
      if (rendered === DROP) continue;
      if (rendered === DROP_ENCLOSING) return DROP;
      out[key] = rendered;
    }
    return out;
  }
  return node;
}

function providerImplementation(
  def: OperationDefinition,
): ProviderRequestImplementation {
  if (def.implementation.type !== "provider-request") {
    throw new TypeError(`${def.id} is not a provider-request operation.`);
  }
  return def.implementation;
}

/**
 * The request for one run of a catalog operation. It reads only the catalog:
 * the caller supplies field values, never a path, method or body shape. A
 * `{name}` is a placeholder only when the operation declares it or it is the
 * cursor or window parameter; any other braces (HogQL's, for one) stay.
 */
export function buildProviderRequest(
  def: OperationDefinition,
  input: ProviderRequestInput,
): BuiltProviderRequest {
  const implementation = providerImplementation(def);
  const resolved = resolveInput(def, input);
  const { path, open } = renderPath(def, implementation.pathTemplate, resolved);
  const query: Record<string, string> = {};
  for (const [key, template] of Object.entries(implementation.query ?? {})) {
    const rendered = renderString(def, template, resolved, "query");
    if (rendered === DROP || rendered === DROP_ENCLOSING) continue;
    query[key] = rendered as string;
  }
  const body =
    implementation.bodyTemplate === undefined
      ? undefined
      : renderBody(def, implementation.bodyTemplate, resolved);
  return {
    method: implementation.method,
    path,
    query,
    ...(body === undefined || body === DROP || body === DROP_ENCLOSING
      ? {}
      : { body }),
    openPlaceholders: open,
  };
}

function unexpected(def: OperationDefinition, what: string): never {
  return fail("unexpected_response", def, `returned a response that ${what}.`);
}

type PathHit = { found: true; value: unknown } | { found: false };

function readPath(
  def: OperationDefinition,
  body: unknown,
  path: string,
): PathHit {
  const parsed = validateResponsePath(path);
  if (!parsed.ok) {
    throw new TypeError(
      `${def.id} declares an invalid response path "${path}".`,
    );
  }
  const hit = evaluatePath(
    { root: "item", segments: parsed.path.segments },
    { item: body, nodes: {}, settings: {}, run: {}, loop: {} },
  );
  return hit.found && hit.value !== null ? hit : { found: false };
}

function readScalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

interface Receipt {
  externalRef?: string;
  url?: string;
}

/** Where a response that is not what the catalog promised is reported; observe only. */
export interface ProviderObservation {
  tripwire?: TripwireSink;
  /** The HTTP status the response came with. */
  status?: number;
}

function reportShape(
  observe: ProviderObservation | undefined,
  def: OperationDefinition,
  details: Record<string, unknown>,
): void {
  observe?.tripwire?.({
    area: "provider",
    code: "provider_shape_unexpected",
    severity: "warn",
    operationId: def.id,
    details: {
      provider: def.credential.provider,
      ...(observe.status === undefined ? {} : { status: observe.status }),
      ...details,
    },
  });
}

/**
 * The write's reference and link, read from the whole response before any of
 * it is cut. A write that ran but shows no reference is not a success the
 * engine can record, so it throws `unexpected_response` for the caller to
 * turn into a needs-check outcome.
 */
export function extractReceipt(
  def: OperationDefinition,
  body: unknown,
  observe?: ProviderObservation,
): Receipt {
  const { receipt } = def;
  if (!receipt) return {};
  const ref = readPath(def, body, receipt.externalRef);
  const externalRef = ref.found ? readScalarText(ref.value) : undefined;
  if (externalRef === undefined || externalRef.length > 500) {
    reportShape(observe, def, {
      reason: !ref.found
        ? "receipt_ref_missing"
        : externalRef === undefined
          ? "receipt_ref_unreadable"
          : "receipt_ref_too_long",
      path: receipt.externalRef,
      body,
    });
    return unexpected(
      def,
      `has no usable "${receipt.externalRef}" to record as the receipt`,
    );
  }
  const link: PathHit = receipt.url
    ? readPath(def, body, receipt.url)
    : { found: false };
  const url =
    link.found && typeof link.value === "string" && isHttpUrl(link.value)
      ? link.value
      : undefined;
  return { externalRef, ...(url === undefined ? {} : { url }) };
}

function jsonLength(value: unknown): number {
  return JSON.stringify(value)?.length ?? 4;
}

function fitString(value: string, budget: number): string {
  let cut = value.slice(0, Math.max(0, budget - 2));
  while (cut.length > 0 && jsonLength(cut) > budget) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9));
  }
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Keeps what fits, in order, descending into the first thing that does not:
 * a long transcript keeps its leading sentences, a long list its leading
 * entries. `undefined` means not even an empty container fits.
 */
function trimToFit(value: unknown, budget: number): unknown {
  if (jsonLength(value) <= budget) return value;
  if (budget < 2) return undefined;
  if (typeof value === "string") return fitString(value, budget);
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    let used = 2;
    for (const element of value) {
      const remaining = budget - used - (kept.length > 0 ? 1 : 0);
      const fitted = trimToFit(element, remaining);
      if (fitted === undefined) break;
      kept.push(fitted);
      used += jsonLength(fitted) + (kept.length > 1 ? 1 : 0);
      if (jsonLength(element) > remaining) break;
    }
    return kept;
  }
  if (isRecord(value)) {
    const kept: Record<string, unknown> = {};
    let used = 2;
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      const keyCost = jsonLength(key) + 1 + (count > 0 ? 1 : 0);
      const fitted = trimToFit(entry, budget - used - keyCost);
      if (fitted === undefined) continue;
      kept[key] = fitted;
      used += keyCost + jsonLength(fitted);
      count += 1;
    }
    return kept;
  }
  return undefined;
}

/**
 * The response as a node reads it: the provider's own JSON, so a graph path
 * such as `nodes.thread.data[0].id` is a path into the provider's answer. Over
 * the budget it is trimmed and `truncated: true` says so; a response that is
 * not an object, or already has a `truncated` key, is wrapped as `value`.
 */
export function boundOutput(
  body: unknown,
  budgetChars: number = PROVIDER_PAYLOAD_BUDGET_CHARS,
): { output: unknown; truncated: boolean } {
  if (jsonLength(body) <= budgetChars)
    return { output: body, truncated: false };
  const room = budgetChars - 40;
  const wrap =
    !isRecord(body) || Object.prototype.hasOwnProperty.call(body, "truncated");
  const trimmed = trimToFit(body, room);
  return {
    output: wrap
      ? { value: trimmed, truncated: true }
      : { ...(trimmed as Record<string, unknown>), truncated: true },
    truncated: true,
  };
}

/** A timestamp as ISO text: epoch seconds or milliseconds, or non-blank text the item schema then checks. */
function readTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Epoch seconds are below 1e11 until the year 5138.
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A mapped number: a finite number as it is, or numeric text read as one.
 * Anything else, NaN and infinity included, is a response the operation did
 * not promise; the message names the field, never the value.
 */
function toNumber(
  def: OperationDefinition,
  value: unknown,
  target: string,
  index: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && NUMERIC_TEXT.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return unexpected(
    def,
    `has no finite number for "${target}" on item ${index}`,
  );
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0].trim();
  return line.length > 1000 ? line.slice(0, 1000) : line;
}

/** A title is one non-empty line, so a text that opens with a blank line has none. */
function readTitle(value: unknown): string | undefined {
  const text = readScalarText(value);
  const line = text === undefined ? "" : firstLine(text);
  return line === "" ? undefined : line;
}

/** What one candidate of a mapped field holds in a row; `undefined` when it holds nothing. */
function readCandidate(
  def: OperationDefinition,
  row: unknown,
  candidate: string,
): unknown {
  const parsed = parseMappedSource(candidate);
  if (!parsed.ok) {
    throw new TypeError(
      `${def.id} declares an invalid item mapping "${candidate}".`,
    );
  }
  const { source } = parsed;
  if (source.kind === "path") {
    const hit = readPath(def, row, source.path);
    return hit.found ? hit.value : undefined;
  }
  let text = "";
  let filled = 0;
  for (const part of source.parts) {
    if ("text" in part) {
      text += part.text;
      continue;
    }
    const hit = readPath(def, row, part.path);
    const value = hit.found ? readScalarText(hit.value) : undefined;
    if (value === undefined) continue;
    text += value;
    filled += 1;
  }
  const joined = text.replace(/[ \t]+/g, " ").trim();
  return filled === 0 || joined === "" ? undefined : joined;
}

/** The first candidate of a mapped field that `read` can use. */
function readMapped<T>(
  def: OperationDefinition,
  row: unknown,
  source: string | readonly string[],
  read: (value: unknown) => T | undefined,
): T | undefined {
  for (const candidate of typeof source === "string" ? [source] : source) {
    const value = readCandidate(def, row, candidate);
    const usable = value === undefined ? undefined : read(value);
    if (usable !== undefined) return usable;
  }
  return undefined;
}

/** One row of the page: an item, or a row with no value for a required field. */
type MappedRow =
  | { item: NormalizedItem; position?: string }
  | { skipped: true };

function mapRow(
  def: OperationDefinition,
  element: unknown,
  index: number,
  scope: WorkflowScope,
): MappedRow {
  const mapping = def.itemMapping;
  if (!mapping) throw new TypeError(`${def.id} has no item mapping.`);
  const candidate: Record<string, unknown> = {};
  const thread: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  let skipped = false;

  for (const [target, source] of Object.entries(mapping.fields)) {
    if (target === "title" || target === "occurredAt") {
      const value = readMapped(
        def,
        element,
        source,
        target === "title" ? readTitle : readTimestamp,
      );
      if (value === undefined) skipped = true;
      else candidate[target] = value;
    } else if (target.startsWith("extras.")) {
      const value = readMapped(def, element, source, (found) => found);
      if (value !== undefined) {
        extras[target.slice(7)] = mapping.numberFields?.includes(target)
          ? toNumber(def, value, target, index)
          : value;
      }
    } else if (target.startsWith("thread.")) {
      const part = target.slice(7);
      const text = readMapped(def, element, source, readScalarText);
      if (text === undefined) continue;
      thread[part] = part === "number" ? Number(text) : text;
    } else {
      const text = readMapped(def, element, source, readScalarText);
      if (text !== undefined) candidate[target] = text;
    }
  }

  const key = readPath(def, element, mapping.dedupeKey);
  const externalId = key.found ? readScalarText(key.value) : undefined;
  if (externalId === undefined) {
    return unexpected(def, `has no "${mapping.dedupeKey}" on item ${index}`);
  }
  const forward = def.cursor?.forward;
  let position: string | undefined;
  if (forward) {
    const hit = readPath(def, element, forward.itemPath);
    position = hit.found ? readScalarText(hit.value) : undefined;
    if (position === undefined) {
      return unexpected(def, `has no "${forward.itemPath}" on item ${index}`);
    }
  }
  if (skipped) return { skipped: true };

  const parsed = normalizedItemSchema.safeParse({
    ...candidate,
    id: operationItemId(scope, def.id, externalId),
    externalId,
    kind: mapping.kind,
    provider: def.provider,
    ...(Object.keys(thread).length > 0 ? { thread } : {}),
    extras,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return unexpected(
      def,
      `does not fit the item shape on item ${index} (${issue.path.join(".") || "item"}: ${issue.message})`,
    );
  }
  return {
    item: boundItem(parsed.data),
    ...(position === undefined ? {} : { position }),
  };
}

interface MappedItems {
  items: NormalizedItem[];
  /** The position after this page; absent for an empty page, which leaves the stored one unchanged. */
  cursor?: string;
  /** Oldest-first pages only: each item's own position, so a page cut short can continue after the last row kept. */
  positions?: string[];
  /** Rows left out because a required field (title or time) had no value after every fallback. */
  skippedRows: number;
}

/** How many rows have no value for a required field; counted only to report on a page. */
function countMappingGaps(
  def: OperationDefinition,
  mapping: NonNullable<OperationDefinition["itemMapping"]>,
  rows: readonly unknown[],
) {
  let missingDedupe = 0;
  let missingTitle = 0;
  let missingOccurredAt = 0;
  for (const row of rows) {
    const key = readPath(def, row, mapping.dedupeKey);
    if (!key.found || readScalarText(key.value) === undefined) {
      missingDedupe += 1;
    }
    if (readMapped(def, row, mapping.fields.title, readTitle) === undefined) {
      missingTitle += 1;
    }
    if (
      readMapped(def, row, mapping.fields.occurredAt, readTimestamp) ===
      undefined
    ) {
      missingOccurredAt += 1;
    }
  }
  return { rows: rows.length, missingDedupe, missingTitle, missingOccurredAt };
}

/**
 * Normalizes a source response. A response with no list in it is
 * `unexpected_response`, never an empty page: an empty page is a list with
 * nothing in it. Item ids are minted in `scope`. A row with no id, or no
 * position on an oldest-first page, cannot be tracked and fails the page; a
 * row with no title or time after every fallback is skipped and counted, unless
 * no row on the page can be read, which is a changed response and fails.
 * `oldestFirst` says the page was asked for oldest first.
 */
export function mapItems(
  def: OperationDefinition,
  body: unknown,
  scope: WorkflowScope,
  observe?: ProviderObservation,
  options: { oldestFirst?: boolean } = {},
): MappedItems {
  const mapping = def.itemMapping;
  if (!mapping) throw new TypeError(`${def.id} has no item mapping.`);
  const list = mapping.itemsPath
    ? readPath(def, body, mapping.itemsPath)
    : { found: true as const, value: body };
  if (!list.found || !Array.isArray(list.value)) {
    reportShape(observe, def, {
      reason: "no_list_at_items_path",
      path: mapping.itemsPath ?? "top_level",
      body,
    });
    return unexpected(
      def,
      `has no list at "${mapping.itemsPath ?? "the top level"}"`,
    );
  }
  const rows: readonly unknown[] = list.value;
  const items: NormalizedItem[] = [];
  const positions: string[] = [];
  try {
    rows.forEach((element, index) => {
      const mapped = mapRow(def, element, index, scope);
      if ("skipped" in mapped) return;
      items.push(mapped.item);
      if (mapped.position !== undefined) positions.push(mapped.position);
    });
  } catch (error) {
    if (error instanceof ProviderOperationError) {
      reportShape(observe, def, {
        reason: "rows_unmappable",
        ...countMappingGaps(def, mapping, rows),
      });
    }
    throw error;
  }
  const skippedRows = rows.length - items.length;
  if (items.length === 0 && skippedRows > 0) {
    reportShape(observe, def, {
      reason: "rows_unmappable",
      ...countMappingGaps(def, mapping, rows),
    });
    return unexpected(
      def,
      `has no row with a readable title and time among its ${rows.length}`,
    );
  }
  if (skippedRows > 0) {
    reportShape(observe, def, {
      reason: "rows_skipped",
      skippedRows,
      ...countMappingGaps(def, mapping, rows),
    });
  }
  if (options.oldestFirst) {
    return { items, positions, skippedRows };
  }
  let cursor: string | undefined;
  if (def.cursor && items.length > 0) {
    const hit = readPath(def, body, def.cursor.path);
    cursor = hit.found ? readScalarText(hit.value) : undefined;
    if (cursor === undefined) {
      reportShape(observe, def, {
        reason: "cursor_position_missing",
        path: def.cursor.path,
        rows: items.length,
        body,
      });
      return unexpected(
        def,
        `has items but no readable position at "${def.cursor.path}"`,
      );
    }
  }
  return { items, skippedRows, ...(cursor === undefined ? {} : { cursor }) };
}

interface FittedItems {
  items: NormalizedItem[];
  /** How many the page held, when it held more than `items`. */
  totalAvailable?: number;
  cut: boolean;
}

/** Keeps leading items under the count and the character budget, and says when it kept fewer. */
export function fitItems(
  items: readonly NormalizedItem[],
  options: { limit?: number; budgetChars?: number } = {},
): FittedItems {
  const capped = capInlineItems(
    items,
    Math.min(options.limit ?? MAX_INLINE_ITEMS, MAX_INLINE_ITEMS),
  );
  const budget = options.budgetChars ?? PROVIDER_PAYLOAD_BUDGET_CHARS;
  const kept: NormalizedItem[] = [];
  let used = 2;
  let overBudget = false;
  for (const item of capped.items) {
    const cost = jsonLength(item) + 1;
    if (used + cost > budget) {
      overBudget = true;
      break;
    }
    kept.push(item);
    used += cost;
  }
  const cut = capped.truncated || overBudget;
  return {
    items: kept,
    cut,
    ...(cut ? { totalAvailable: capped.totalAvailable } : {}),
  };
}

export interface ParsedOperationResponse {
  output: unknown;
  truncated: boolean;
  items?: NormalizedItem[];
  totalAvailable?: number;
  cursor?: string;
  primed?: boolean;
  /** Rows left out for want of a title or time; absent when none were. */
  skippedRows?: number;
  externalRef?: string;
  url?: string;
}

/**
 * Turns the provider's JSON into what the engine takes. A source returns
 * items and the position after them. A newest-first page returns that position
 * only when it kept every row (a position past rows it did not return would
 * skip them for good); an oldest-first page returns the position of the last
 * row it kept, so a page cut at the limit continues next tick. Anything that is
 * not a source returns the response itself, with the receipt read before it is
 * bounded. `prime` is a cursor source's first live run: it takes the position
 * and no items, so only what arrives afterwards is processed; over an empty
 * page it takes the catalog's origin, so the source still counts as primed.
 * `cursor` is the position the request was sent with. A source needs the
 * `scope` its item ids are minted in.
 */
export function parseProviderResponse(
  def: OperationDefinition,
  body: unknown,
  options: {
    scope?: WorkflowScope;
    limit?: number;
    prime?: boolean;
    cursor?: string;
    budgetChars?: number;
    observe?: ProviderObservation;
  } = {},
): ParsedOperationResponse {
  if (body === undefined) {
    reportShape(options.observe, def, { reason: "not_json" });
    unexpected(def, "is not JSON");
  }
  if (def.itemMapping) {
    if (!options.scope) {
      throw new TypeError(`${def.id} is a source, so it needs a scope.`);
    }
    const oldestFirst =
      def.cursor?.forward !== undefined && options.cursor !== undefined;
    const mapped = mapItems(def, body, options.scope, options.observe, {
      oldestFirst,
    });
    const skipped =
      mapped.skippedRows > 0 ? { skippedRows: mapped.skippedRows } : {};
    if (options.prime) {
      const cursor =
        mapped.items.length === 0 ? def.cursor?.origin : mapped.cursor;
      return {
        output: { primed: true, skipped: mapped.items.length, ...skipped },
        truncated: false,
        items: [],
        primed: true,
        ...skipped,
        ...(cursor === undefined ? {} : { cursor }),
      };
    }
    const fitted = fitItems(mapped.items, {
      limit: options.limit,
      budgetChars: options.budgetChars,
    });
    const cursor = oldestFirst
      ? mapped.positions?.[fitted.items.length - 1]
      : fitted.cut
        ? undefined
        : mapped.cursor;
    return {
      output: {
        itemCount: fitted.items.length,
        truncated: fitted.cut,
        ...skipped,
      },
      truncated: fitted.cut,
      items: fitted.items,
      ...skipped,
      ...(fitted.totalAvailable === undefined
        ? {}
        : { totalAvailable: fitted.totalAvailable }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  }
  const receipt = extractReceipt(def, body, options.observe);
  const bounded = boundOutput(body, options.budgetChars);
  return { ...bounded, ...receipt };
}
