/**
 * The API request step's form, as plain functions: what the step's fields mean
 * (read from the operation's own `freeForm` declaration, never from field
 * names typed here), how the form's rows and options map to the arguments a
 * node saves, and the checks that mirror the engine's typed refusals so a
 * mistake shows before a run. Every problem is a code; the form words each one.
 */
import { isCredentialQueryName, type CurlImportResult } from "./curl-import.js";
import { defaultArgs, operationsForKind } from "./defaults.js";
import {
  FREE_FORM_DEFAULT_PAGES,
  FREE_FORM_MAX_TIMEOUT_SECONDS,
  isDeniedHeader,
  readFreeHeaders,
  readFreePagination,
  readFreePath,
  readFreeQuery,
  readFreeTimeout,
  type FieldBinding,
  type FreeFormFailureCode,
  type FreeFormRequest,
  type OperationDefinition,
  type WorkflowGraph,
  type WorkflowIssue,
  type WorkflowNode,
} from "./engine.js";
import {
  firstKeepProblem,
  type KeepListReason,
  type KeepPathReason,
} from "./fields-to-keep.js";
import type { WorkflowCatalog } from "./types.js";

export type ApiRequestArgs = Record<string, FieldBinding>;

/** The field that keeps only some of an answer's fields, as the operation names it. */
export const FIELDS_TO_KEEP_FIELD = "fieldsToKeep";

export interface ApiRequestShape {
  /** The operation's own field names, by what each one is for. */
  fields: FreeFormRequest;
  /** Every field the operation declares, for the ones that are not a free-form role. */
  declared: readonly string[];
  /** Names the connection fills, which a typed path may keep as a whole segment. */
  placeholders: readonly string[];
}

/** The free-form request an operation declares, or undefined for every other operation. */
export function apiRequestShape(
  def: OperationDefinition | undefined,
): ApiRequestShape | undefined {
  if (def?.implementation.type !== "provider-request") return undefined;
  const fields = def.implementation.freeForm;
  if (!fields) return undefined;
  return {
    fields,
    declared: def.fields.map((field) => field.name),
    placeholders: fields.placeholders ?? [],
  };
}

/** The API request operations a lookup may run, one per provider, by provider name. */
export function apiRequestOperations(
  catalog: WorkflowCatalog,
): OperationDefinition[] {
  return operationsForKind(catalog, "lookup").filter(
    (def) => apiRequestShape(def) !== undefined,
  );
}

/** The API request operation for a provider, if the catalog has one. */
export function apiRequestOperationFor(
  catalog: WorkflowCatalog,
  provider: string,
): OperationDefinition | undefined {
  return apiRequestOperations(catalog).find((def) => def.provider === provider);
}

function fixedValue(
  args: ApiRequestArgs,
  name: string | undefined,
): unknown | undefined {
  const binding = name === undefined ? undefined : args[name];
  return binding?.mode === "fixed" ? binding.value : undefined;
}

function withFixed(
  args: ApiRequestArgs,
  name: string | undefined,
  value: unknown,
): ApiRequestArgs {
  return name === undefined
    ? args
    : { ...args, [name]: { mode: "fixed", value } };
}

function without(
  args: ApiRequestArgs,
  name: string | undefined,
): ApiRequestArgs {
  if (name === undefined || !(name in args)) return args;
  const { [name]: _removed, ...rest } = args;
  return rest;
}

/** A field set from upstream or by a model is shown by the generic field control, so no form control can drop it. */
export function isPlainBinding(
  args: ApiRequestArgs,
  name: string | undefined,
): boolean {
  const binding = name === undefined ? undefined : args[name];
  return binding === undefined || binding.mode === "fixed";
}

function holesIn(value: unknown): boolean {
  if (typeof value === "string") return value.includes("{{");
  if (Array.isArray(value)) return value.some(holesIn);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(holesIn);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Authentication

export type ApiRequestAuth = "provider" | "none";

/** The provider's own sign-in is the default, so it is the absence of a setting. */
export function authenticationOf(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
): ApiRequestAuth {
  return fixedValue(args, shape.fields.auth) === "none" ? "none" : "provider";
}

export function withAuthentication(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  auth: ApiRequestAuth,
): ApiRequestArgs {
  return auth === "none"
    ? withFixed(args, shape.fields.auth, "none")
    : without(args, shape.fields.auth);
}

// ---------------------------------------------------------------------------
// Query parameters and headers, as rows

export type ParamKind = "query" | "headers";

export interface ParamRow {
  id: string;
  name: string;
  value: string;
}

function textOfValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value === undefined ? "" : JSON.stringify(value);
}

/** One row per name and value; a list repeats its name, as it repeats the parameter. */
export function rowsOf(value: unknown, nextId: () => string): ParamRow[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([name, raw]) =>
    (Array.isArray(raw) ? raw : [raw]).map((entry) => ({
      id: nextId(),
      name,
      value: textOfValue(entry),
    })),
  );
}

/** Entries as an object. A name that repeats becomes a list, or, without `list`, keeps its last value. */
function groupEntries(
  entries: Iterable<readonly [string, string]>,
  list: boolean,
): Record<string, string | string[]> {
  const grouped = new Map<string, string | string[]>();
  for (const [name, value] of entries) {
    const existing = grouped.get(name);
    if (!list || existing === undefined) grouped.set(name, value);
    else if (typeof existing === "string") {
      grouped.set(name, [existing, value]);
    } else grouped.set(name, [...existing, value]);
  }
  return Object.fromEntries(grouped);
}

/** The object a set of rows saves. A row without a name is not saved, and a repeated query name becomes a list. */
export function objectOf(
  kind: ParamKind,
  rows: readonly ParamRow[],
): Record<string, string | string[]> {
  return groupEntries(
    rows
      .filter((row) => row.name.trim() !== "")
      .map((row): [string, string] => [row.name.trim(), row.value]),
    kind === "query",
  );
}

function normalized(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value === undefined ? "" : JSON.stringify(value);
  }
  return JSON.stringify(
    Object.entries(value).map(([name, raw]) => [
      name,
      Array.isArray(raw) ? raw.map(textOfValue) : textOfValue(raw),
    ]),
  );
}

/** Whether a saved object fits the rows: each value is text, a number, a switch, or a list of those. Nothing saved fits too. */
export function fitsRows(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const scalar = (entry: unknown) =>
    typeof entry === "string" ||
    typeof entry === "number" ||
    typeof entry === "boolean";
  return Object.values(value).every((entry) =>
    Array.isArray(entry) ? entry.every(scalar) : scalar(entry),
  );
}

/** Whether the rows already say what is saved, so an echo of the form's own edit does not rebuild them. */
export function rowsMatch(
  kind: ParamKind,
  rows: readonly ParamRow[],
  saved: unknown,
): boolean {
  return normalized(objectOf(kind, rows)) === normalized(saved);
}

/**
 * The rows to show once the saved object has changed. When the rows already say
 * it they are kept as they are, so a row the object cannot hold (no name yet, a
 * header listed twice) is not lost by the object being read back, such as when a
 * person goes to the JSON editor and returns. Otherwise something else wrote the
 * object, and it is read into rows as it stands: every key, a denied header
 * among them, becomes a row that the form then refuses in plain words.
 */
export function reconcileRows(
  kind: ParamKind,
  rows: ParamRow[],
  saved: unknown,
  nextId: () => string,
): ParamRow[] {
  return rowsMatch(kind, rows, saved) ? rows : rowsOf(saved, nextId);
}

export function paramsEnabled(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  kind: ParamKind,
): boolean {
  const name = shape.fields[kind];
  return name !== undefined && name in args;
}

export function withParamsEnabled(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  kind: ParamKind,
  enabled: boolean,
): ApiRequestArgs {
  const name = shape.fields[kind];
  if (!enabled) return without(args, name);
  return name !== undefined && name in args ? args : withFixed(args, name, {});
}

export function withParams(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  kind: ParamKind,
  value: unknown,
): ApiRequestArgs {
  return withFixed(args, shape.fields[kind], value);
}

export function paramsValue(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  kind: ParamKind,
): unknown {
  return fixedValue(args, shape.fields[kind]);
}

// ---------------------------------------------------------------------------
// Options

export const API_REQUEST_OPTIONS = [
  "timeout",
  "pagination",
  "includeStatus",
  "fieldsToKeep",
] as const;
export type ApiRequestOption = (typeof API_REQUEST_OPTIONS)[number];

type OptionRole = "timeoutSeconds" | "pagination" | "includeStatus";

const OPTION_ROLE: Record<
  Exclude<ApiRequestOption, typeof FIELDS_TO_KEEP_FIELD>,
  OptionRole
> = {
  timeout: "timeoutSeconds",
  pagination: "pagination",
  includeStatus: "includeStatus",
};

/** The field an option writes, as the operation declares it; undefined when the operation has no such option. */
export function optionName(
  shape: ApiRequestShape,
  option: ApiRequestOption,
): string | undefined {
  if (option === "fieldsToKeep") {
    // The operation names it as a free-form role; a field it declares by that name counts the same.
    const role = Object.entries(shape.fields).find(
      ([name]) => name === FIELDS_TO_KEEP_FIELD,
    )?.[1];
    if (typeof role === "string") return role;
    return shape.declared.includes(FIELDS_TO_KEEP_FIELD)
      ? FIELDS_TO_KEEP_FIELD
      : undefined;
  }
  return shape.fields[OPTION_ROLE[option]];
}

/** The field a problem is about, as the operation names it, to match it to the validator's `args.<field>:`. */
function problemFieldName(
  shape: ApiRequestShape,
  field: ApiRequestProblem["field"],
): string | undefined {
  return field === "fieldsToKeep"
    ? optionName(shape, "fieldsToKeep")
    : shape.fields[field];
}

/** The options this operation declares a field for. */
export function availableOptions(shape: ApiRequestShape): ApiRequestOption[] {
  return API_REQUEST_OPTIONS.filter(
    (option) => optionName(shape, option) !== undefined,
  );
}

/** The options set on the node: a status switch counts only while it is on. */
export function activeOptions(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
): ApiRequestOption[] {
  return availableOptions(shape).filter((option) => {
    const name = optionName(shape, option);
    const binding = name === undefined ? undefined : args[name];
    if (binding === undefined) return false;
    if (option !== "includeStatus") return true;
    return binding.mode !== "fixed" || binding.value === true;
  });
}

/** Status and headers come with a single response, paging with several, so each rules out the other. */
export function optionBlock(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  option: ApiRequestOption,
): "pagination_on" | "status_on" | undefined {
  const active = activeOptions(shape, args);
  if (option === "includeStatus" && active.includes("pagination")) {
    return "pagination_on";
  }
  if (option === "pagination" && active.includes("includeStatus")) {
    return "status_on";
  }
  return undefined;
}

export interface PaginationForm {
  cursorPath: string;
  cursorParam: string;
  itemsPath: string;
  maxPages: number | undefined;
}

export function paginationOf(value: unknown): PaginationForm {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  return {
    cursorPath: text("cursorPath"),
    cursorParam: text("cursorParam"),
    itemsPath: text("itemsPath"),
    maxPages: typeof record.maxPages === "number" ? record.maxPages : undefined,
  };
}

/** What the engine reads: an empty items path or page limit is left out, so its default applies. */
export function paginationValue(form: PaginationForm): Record<string, unknown> {
  return {
    cursorPath: form.cursorPath,
    cursorParam: form.cursorParam,
    ...(form.itemsPath === "" ? {} : { itemsPath: form.itemsPath }),
    ...(form.maxPages === undefined ? {} : { maxPages: form.maxPages }),
  };
}

function initialOptionValue(option: ApiRequestOption): unknown {
  switch (option) {
    case "timeout":
      return FREE_FORM_MAX_TIMEOUT_SECONDS;
    case "pagination":
      return paginationValue({
        cursorPath: "",
        cursorParam: "",
        itemsPath: "",
        maxPages: FREE_FORM_DEFAULT_PAGES,
      });
    case "includeStatus":
      return true;
    case "fieldsToKeep":
      return [];
  }
}

/** The fields to keep as the step saves them: a list of paths, and nothing at all when there are none, which the server would refuse as an empty list. */
export function withFieldsToKeep(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  paths: readonly string[],
): ApiRequestArgs {
  return paths.length === 0
    ? withoutOption(shape, args, "fieldsToKeep")
    : withFixed(args, optionName(shape, "fieldsToKeep"), [...paths]);
}

export function withOption(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  option: ApiRequestOption,
  value: unknown = initialOptionValue(option),
): ApiRequestArgs {
  return withFixed(args, optionName(shape, option), value);
}

export function withoutOption(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  option: ApiRequestOption,
): ApiRequestArgs {
  return without(args, optionName(shape, option));
}

export function optionValue(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  option: ApiRequestOption,
): unknown {
  return fixedValue(args, optionName(shape, option));
}

// ---------------------------------------------------------------------------
// Checks that mirror the engine's refusals

export type PathReason =
  | "query"
  | "fragment"
  | "placeholder"
  | "segment"
  | "length";
export type PaginationPart =
  | "shape"
  | "cursorPath"
  | "cursorParam"
  | "itemsPath"
  | "maxPages";

export type ApiRequestProblem =
  | { field: "path"; code: "invalid_field" }
  | { field: "path"; code: "full_url_refused" }
  | { field: "path"; code: "unsafe_path_value"; reason: PathReason }
  | { field: "query"; code: "invalid_query" }
  | {
      field: "headers";
      code: "invalid_header" | "header_denied";
      name?: string;
    }
  | { field: "timeoutSeconds"; code: "invalid_timeout" }
  | { field: "pagination"; code: "invalid_pagination"; part: PaginationPart }
  | { field: "includeStatus"; code: "incompatible_fields" }
  | {
      field: "fieldsToKeep";
      code: "invalid_fields_to_keep";
      reason: KeepListReason | KeepPathReason;
      /** The path the reason is about, for a reason that is about one. */
      path?: string;
    };

function pathReason(text: string): PathReason {
  if (text.includes("?")) return "query";
  if (text.includes("#")) return "fragment";
  if (text.includes("{") || text.includes("}")) return "placeholder";
  if (text.trim().length > 1_000) return "length";
  return "segment";
}

/** Why a typed path would be refused; a path with a `{{ }}` hole is checked when it runs. An empty path is refused too, as `invalid_field`. */
export function pathProblem(
  text: string,
  placeholders: readonly string[],
): Extract<ApiRequestProblem, { field: "path" }> | undefined {
  if (text.includes("{{")) return undefined;
  if (text.trim() === "") return { field: "path", code: "invalid_field" };
  const check = readFreePath(text, placeholders);
  if (check.ok) return undefined;
  if (check.code === "full_url_refused") {
    return { field: "path", code: "full_url_refused" };
  }
  if (check.code === "unsafe_path_value") {
    return {
      field: "path",
      code: "unsafe_path_value",
      reason: pathReason(text),
    };
  }
  return undefined;
}

function paginationPart(value: unknown): PaginationPart {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "shape";
  }
  const record = value as Record<string, unknown>;
  const valid = { cursorPath: "a", cursorParam: "a", maxPages: 1 };
  for (const part of [
    "cursorPath",
    "cursorParam",
    "itemsPath",
    "maxPages",
  ] as const) {
    if (
      record[part] === undefined &&
      part !== "cursorPath" &&
      part !== "cursorParam"
    ) {
      continue;
    }
    if (!readFreePagination({ ...valid, [part]: record[part] }).ok) return part;
  }
  return "shape";
}

/** Problems with the node's whole-field values, in the order the form shows them. */
export function apiRequestProblems(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
): ApiRequestProblem[] {
  const found: ApiRequestProblem[] = [];
  const path = fixedValue(args, shape.fields.path);
  if (typeof path === "string") {
    const problem = pathProblem(path, shape.placeholders);
    if (problem) found.push(problem);
  } else if (!(shape.fields.path in args)) {
    found.push({ field: "path", code: "invalid_field" });
  }
  const query = fixedValue(args, shape.fields.query);
  if (query !== undefined && !holesIn(query) && !readFreeQuery(query).ok) {
    found.push({ field: "query", code: "invalid_query" });
  }
  const headers = fixedValue(args, shape.fields.headers);
  if (headers !== undefined && !holesIn(headers)) {
    const check = readFreeHeaders(headers);
    if (!check.ok) {
      const denied =
        typeof headers === "object" && headers !== null
          ? Object.keys(headers).find(isDeniedHeader)
          : undefined;
      found.push(
        check.code === "header_denied" && denied !== undefined
          ? { field: "headers", code: "header_denied", name: denied }
          : {
              field: "headers",
              code:
                check.code === "header_denied"
                  ? "header_denied"
                  : "invalid_header",
            },
      );
    }
  }
  const timeout = fixedValue(args, shape.fields.timeoutSeconds);
  if (timeout !== undefined && !readFreeTimeout(timeout).ok) {
    found.push({ field: "timeoutSeconds", code: "invalid_timeout" });
  }
  const pagination = fixedValue(args, shape.fields.pagination);
  if (
    pagination !== undefined &&
    !holesIn(pagination) &&
    !readFreePagination(pagination).ok
  ) {
    found.push({
      field: "pagination",
      code: "invalid_pagination",
      part: paginationPart(pagination),
    });
  }
  const active = activeOptions(shape, args);
  if (active.includes("includeStatus") && active.includes("pagination")) {
    found.push({ field: "includeStatus", code: "incompatible_fields" });
  }
  const keep = fixedValue(args, optionName(shape, "fieldsToKeep"));
  if (keep !== undefined && !holesIn(keep)) {
    const problem = firstKeepProblem(keep);
    if (problem) {
      found.push({
        field: "fieldsToKeep",
        code: "invalid_fields_to_keep",
        reason: problem.reason,
        ...(problem.path === undefined ? {} : { path: problem.path }),
      });
    }
  }
  return found;
}

export interface RowProblem {
  code: FreeFormFailureCode;
  part: "name" | "nameMissing" | "value" | "duplicate" | "denied";
}

/** Problems with single rows, by row id. A row left empty is not a problem: it is not saved. */
export function rowProblems(
  kind: ParamKind,
  rows: readonly ParamRow[],
): Map<string, RowProblem> {
  const problems = new Map<string, RowProblem>();
  const seen = new Set<string>();
  const invalid: FreeFormFailureCode =
    kind === "query" ? "invalid_query" : "invalid_header";
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "") {
      if (row.value !== "") {
        problems.set(row.id, { code: invalid, part: "nameMissing" });
      }
      continue;
    }
    if (kind === "headers") {
      if (isDeniedHeader(name)) {
        problems.set(row.id, { code: "header_denied", part: "denied" });
        continue;
      }
      if (seen.has(name.toLowerCase())) {
        problems.set(row.id, { code: "invalid_header", part: "duplicate" });
        continue;
      }
      seen.add(name.toLowerCase());
    }
    // A value with a hole is filled by a run, so only its name is checked now.
    const value = row.value.includes("{{") ? "x" : row.value;
    const check =
      kind === "query"
        ? readFreeQuery({ [name]: value })
        : readFreeHeaders({ [name]: value });
    if (check.ok) continue;
    const nameCheck =
      kind === "query"
        ? readFreeQuery({ [name]: "x" })
        : readFreeHeaders({ [name]: "x" });
    problems.set(row.id, {
      code: check.code,
      part: nameCheck.ok ? "value" : "name",
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Fixes the form offers

export interface SplitPath {
  path: string;
  query: Record<string, string | string[]>;
  /** Parameters left out because their names say they carry a credential. */
  dropped: string[];
}

function decodeSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // coercion-ok: a segment that is not valid percent-encoding is kept as it was typed
        return segment;
      }
    })
    .join("/");
}

function queryOf(
  search: URLSearchParams,
): Pick<SplitPath, "query" | "dropped"> {
  const kept: [string, string][] = [];
  const dropped: string[] = [];
  for (const [name, value] of search) {
    if (isCredentialQueryName(name)) {
      if (!dropped.includes(name)) dropped.push(name);
      continue;
    }
    kept.push([name, value]);
  }
  return { query: groupEntries(kept, true), dropped };
}

/** The path of a typed URL, below the provider's base URL when it is on the same host. The query string becomes parameters. */
export function pathOfUrl(
  text: string,
  baseUrl?: string,
): SplitPath | undefined {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!URL.canParse(candidate)) return undefined;
  const url = new URL(candidate);
  let pathname = url.pathname;
  const base =
    baseUrl !== undefined && URL.canParse(baseUrl) ? new URL(baseUrl) : null;
  if (base && base.host === url.host) {
    const prefix = base.pathname.replace(/\/+$/, "");
    if (
      prefix !== "" &&
      (pathname === prefix || pathname.startsWith(`${prefix}/`))
    ) {
      pathname = pathname.slice(prefix.length);
    }
  }
  return {
    path: decodeSegments(pathname.replace(/^\/+/, "")),
    ...queryOf(url.searchParams),
  };
}

/** `repos/acme/web?state=open` as a path and parameters. The fragment is dropped: a server never sees it. */
export function splitQueryFromPath(text: string): SplitPath | undefined {
  const withoutFragment = text.split("#")[0] ?? "";
  const mark = withoutFragment.indexOf("?");
  if (mark === -1) return undefined;
  return {
    path: withoutFragment.slice(0, mark).trim(),
    ...queryOf(new URLSearchParams(withoutFragment.slice(mark + 1))),
  };
}

/** Sets the path, and adds any parameters to those already saved; a name already there takes the new value. */
export function withSplitPath(
  shape: ApiRequestShape,
  args: ApiRequestArgs,
  split: SplitPath,
): ApiRequestArgs {
  let next = withFixed(args, shape.fields.path, split.path);
  if (Object.keys(split.query).length > 0) {
    const saved = fixedValue(args, shape.fields.query);
    const existing =
      typeof saved === "object" && saved !== null && !Array.isArray(saved)
        ? saved
        : {};
    next = withFixed(next, shape.fields.query, { ...existing, ...split.query });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Import from cURL

type ImportSuccess = Extract<CurlImportResult, { ok: true }>;

/**
 * What a parsed command sets: it overwrites the step's settings, so nothing from
 * before survives but the fields to keep, which say what to do with the answer
 * and not what request a command makes, and are the person's own choice.
 */
export function applyCurlImport(
  catalog: WorkflowCatalog,
  result: ImportSuccess,
  current: ApiRequestArgs = {},
): { operation: string; args: ApiRequestArgs } | undefined {
  const def = apiRequestOperationFor(catalog, result.provider);
  const shape = apiRequestShape(def);
  if (!def || !shape) return undefined;
  let args = defaultArgs(def);
  args = withFixed(args, shape.fields.path, result.path);
  if (Object.keys(result.query).length > 0) {
    args = withFixed(args, shape.fields.query, result.query);
  }
  if (Object.keys(result.headers).length > 0) {
    args = withFixed(args, shape.fields.headers, result.headers);
  }
  const keepName = optionName(shape, "fieldsToKeep");
  const kept = keepName === undefined ? undefined : current[keepName];
  if (keepName !== undefined && kept !== undefined) {
    args = { ...args, [keepName]: kept };
  }
  return { operation: def.id, args };
}

export interface ImportedLeftOut {
  /** Credential headers and flags, by name. */
  credentials: string[];
  /** Transport headers the request sends itself. */
  headers: string[];
  /** Body flags: the step only reads. */
  bodies: string[];
  /** Options that have no meaning here, by flag. */
  flags: string[];
  /** A header that could not be read. */
  unreadableHeader: boolean;
  /** More than one URL was given; only the first was used. */
  extraUrl: boolean;
}

/** The issues of a parsed command, sorted by what was left out. */
export function leftOutOf(
  issues: readonly { code: string; detail?: string }[],
): ImportedLeftOut {
  const out: ImportedLeftOut = {
    credentials: [],
    headers: [],
    bodies: [],
    flags: [],
    unreadableHeader: false,
    extraUrl: false,
  };
  const add = (list: string[], detail: string | undefined) => {
    if (detail !== undefined && !list.includes(detail)) list.push(detail);
  };
  for (const issue of issues) {
    switch (issue.code) {
      case "credential_dropped":
        add(out.credentials, issue.detail);
        break;
      case "header_dropped":
        add(out.headers, issue.detail);
        break;
      case "body_ignored":
        add(out.bodies, issue.detail);
        break;
      case "flag_ignored":
        if (issue.detail === "header") out.unreadableHeader = true;
        else if (issue.detail === "extra-url") out.extraUrl = true;
        else add(out.flags, issue.detail);
        break;
    }
  }
  return out;
}

export function hasLeftOut(left: ImportedLeftOut): boolean {
  return (
    left.credentials.length > 0 ||
    left.headers.length > 0 ||
    left.bodies.length > 0 ||
    left.flags.length > 0 ||
    left.unreadableHeader ||
    left.extraUrl
  );
}

// ---------------------------------------------------------------------------
// The card

function lookupShape(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): { shape: ApiRequestShape; args: ApiRequestArgs } | undefined {
  if (node.kind !== "lookup") return undefined;
  const shape = apiRequestShape(catalog.get(node.settings.operation));
  return shape ? { shape, args: node.settings.args } : undefined;
}

function pathText(shape: ApiRequestShape, args: ApiRequestArgs): string {
  const name = shape.fields.path;
  const binding = name in args ? args[name] : undefined;
  if (binding === undefined) return "";
  if (binding.mode === "path") return `{{ ${binding.path} }}`;
  if (binding.mode === "fixed") {
    return typeof binding.value === "string" ? binding.value.trim() : "";
  }
  return "";
}

/** The path a card shows after `GET:`, or undefined when the step is not an API request. */
export function requestPathOf(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): string | undefined {
  const found = lookupShape(node, catalog);
  return found && pathText(found.shape, found.args);
}

/** An API request with no path has nothing to read, which the card shows as a missing required field. */
export function hasEmptyPath(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): boolean {
  return requestPathOf(node, catalog) === "";
}

/** A validator issue with the typed problem behind it, so a sentence can be worded from the code. */
export type AnnotatedIssue = WorkflowIssue & { apiProblem?: ApiRequestProblem };

/**
 * The issues the editor shows for API request steps. The validator words a
 * refused field in English and names the field (`args.path: ...`), so the
 * problem is looked up again from the node's own values and attached by code.
 * An empty path is something the validator lets through, since a run refuses
 * it, so the card gets an issue for it here.
 */
export function annotateApiRequestIssues(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
  issues: readonly WorkflowIssue[],
): AnnotatedIssue[] {
  const steps = new Map<
    string,
    { shape: ApiRequestShape; args: ApiRequestArgs }
  >();
  for (const node of graph.nodes) {
    const found = lookupShape(node, catalog);
    if (found) steps.set(node.id, found);
  }
  const annotated = issues.map((issue): AnnotatedIssue => {
    const found =
      issue.nodeId === undefined ? undefined : steps.get(issue.nodeId);
    if (!found || issue.code !== "field_type_mismatch") return issue;
    const field = /^args\.([A-Za-z_][A-Za-z0-9_]*):/.exec(
      issue.detail ?? "",
    )?.[1];
    const apiProblem = apiRequestProblems(found.shape, found.args).find(
      (problem) =>
        field !== undefined &&
        problemFieldName(found.shape, problem.field) === field,
    );
    return apiProblem ? { ...issue, apiProblem } : issue;
  });
  const empty = [...steps].flatMap(([nodeId, { shape, args }]) =>
    pathText(shape, args) === ""
      ? [
          {
            code: "missing_required_field",
            nodeId,
            apiProblem: { field: "path", code: "invalid_field" },
          } satisfies AnnotatedIssue,
        ]
      : [],
  );
  return [...annotated, ...empty];
}
