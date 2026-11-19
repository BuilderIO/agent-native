/**
 * What a person may type into a request step that has no fixed endpoint: the
 * path, query parameters, headers, timeout and pagination. These are pure
 * checks with typed refusals, shared by the save-time validator and the one
 * request builder, so a rule cannot be true in one place and missing in the
 * other. A refusal names the part that was wrong and never echoes a value,
 * except a header or parameter name that has already passed its character set.
 */
import { parseFieldsToKeep, type FieldsToKeep } from "./fields-to-keep.js";
import type { FreeFormRequest } from "./operations.js";

/**
 * Pages one step may read. A page of a list endpoint is typically a few
 * hundred characters per entry times 30 to 100 entries, so the 34,000-character
 * output budget is already full after one or two; pages past the fifth would be
 * fetched against the provider's quota and then cut. Core's own ceiling is 50.
 */
export const FREE_FORM_MAX_PAGES = 5;
export const FREE_FORM_DEFAULT_PAGES = 3;
export const FREE_FORM_MAX_TIMEOUT_SECONDS = 60;

const MAX_QUERY_PARAMS = 40;
const MAX_QUERY_LIST = 100;
const MAX_QUERY_VALUE_CHARS = 2_000;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE_CHARS = 1_000;
const MAX_NAME_CHARS = 100;
const MAX_PATH_CHARS = 1_000;
const MAX_CURSOR_PATH_CHARS = 200;

export type FreeFormFailureCode =
  | "full_url_refused"
  | "unsafe_path_value"
  | "invalid_query"
  | "invalid_header"
  | "header_denied"
  | "invalid_pagination"
  | "invalid_timeout"
  | "incompatible_fields"
  | "invalid_fields_to_keep"
  | "invalid_field";

export type FreeFormCheck<T> =
  | { ok: true; value: T }
  | { ok: false; code: FreeFormFailureCode; message: string };

function ok<T>(value: T): FreeFormCheck<T> {
  return { ok: true, value };
}

function refused(
  code: FreeFormFailureCode,
  message: string,
): { ok: false; code: FreeFormFailureCode; message: string } {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlOrBackslash(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function hasControl(text: string, allowTab: boolean): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 0x20 && !(allowTab && code === 0x09)) || code === 0x7f) {
      return true;
    }
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

// A scheme followed by a slash is a URL, which would name its own host.
const SCHEME_AND_SLASH = /^[A-Za-z][A-Za-z0-9+.-]*:\//;
const WHOLE_PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * An endpoint path typed as plain text. One leading slash and one trailing
 * slash are kept apart from the segments (a trailing slash is part of some
 * APIs' paths); every segment is then checked and percent-encoded, with `:`
 * and `@` left readable because they are legal in a segment and some APIs
 * name an action after one (`datasets:list`). A segment that is exactly
 * `{name}` for a name core fills from the connection stays as it is, and its
 * name is returned in `open`. The text is never reinterpreted: a segment is
 * only ever one segment, a percent sign is a literal one, and a full URL is
 * refused because core pins every request to the provider's own host.
 */
export function readFreePath(
  value: unknown,
  placeholders: readonly string[] = [],
): FreeFormCheck<{ path: string; open: string[] }> {
  if (typeof value !== "string") {
    return refused("invalid_field", `"path" must be text.`);
  }
  let text = value.trim();
  if (text === "") return refused("invalid_field", `"path" is empty.`);
  if (text.length > MAX_PATH_CHARS) {
    return refused(
      "unsafe_path_value",
      `"path" is longer than ${MAX_PATH_CHARS} characters.`,
    );
  }
  if (text.startsWith("//") || SCHEME_AND_SLASH.test(text)) {
    return refused(
      "full_url_refused",
      `"path" is a full URL. Type only the path on the provider's own API; the host is fixed by the connection.`,
    );
  }
  if (text.startsWith("/")) text = text.slice(1);
  const trailing = text.endsWith("/");
  if (trailing) text = text.slice(0, -1);
  const segments = text.split("/");
  const open: string[] = [];
  const encoded: string[] = [];
  for (const segment of segments) {
    const plain = decodedOnce(segment);
    if (
      segment === "" ||
      plain === "." ||
      plain === ".." ||
      hasControlOrBackslash(plain)
    ) {
      return refused(
        "unsafe_path_value",
        `"path" has an empty, dot or control-character segment.`,
      );
    }
    if (segment.includes("?") || segment.includes("#")) {
      return refused(
        "unsafe_path_value",
        `"path" holds a "?" or "#". Put query parameters in the query field.`,
      );
    }
    const hole = WHOLE_PLACEHOLDER.exec(segment)?.[1];
    if (hole !== undefined && placeholders.includes(hole)) {
      open.push(hole);
      encoded.push(segment);
      continue;
    }
    if (segment.includes("{") || segment.includes("}")) {
      return refused(
        "unsafe_path_value",
        `"path" holds a {name} that is not filled in. Type the real value.`,
      );
    }
    encoded.push(
      encodeURIComponent(segment).replace(/%3A/gi, ":").replace(/%40/g, "@"),
    );
  }
  return ok({ path: `${encoded.join("/")}${trailing ? "/" : ""}`, open });
}

const QUERY_KEY = /^[A-Za-z0-9_.[\]-]+$/;

function isQueryScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * Query parameters as an object of name to scalar or list of scalars; a list
 * repeats the parameter. Everything comes back as text, which is how core
 * sends it. An empty list sends the parameter no times.
 */
export function readFreeQuery(
  value: unknown,
): FreeFormCheck<Record<string, string | string[]>> {
  if (!isRecord(value)) {
    return refused(
      "invalid_query",
      `"query" must be an object of parameter names to values.`,
    );
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_QUERY_PARAMS) {
    return refused(
      "invalid_query",
      `"query" has more than ${MAX_QUERY_PARAMS} parameters.`,
    );
  }
  const query: Record<string, string | string[]> = {};
  for (const [key, raw] of entries) {
    if (key.length > MAX_NAME_CHARS || !QUERY_KEY.test(key)) {
      return refused(
        "invalid_query",
        `"query" has a parameter name with characters other than letters, digits and - _ . [ ].`,
      );
    }
    if (!Array.isArray(raw)) {
      const text = queryText(key, raw);
      if (!text.ok) return text;
      query[key] = text.value;
      continue;
    }
    if (raw.length > MAX_QUERY_LIST) {
      return refused(
        "invalid_query",
        `Query parameter "${key}" has more than ${MAX_QUERY_LIST} values.`,
      );
    }
    const texts: string[] = [];
    for (const scalar of raw) {
      const text = queryText(key, scalar);
      if (!text.ok) return text;
      texts.push(text.value);
    }
    if (texts.length > 0) query[key] = texts;
  }
  return ok(query);
}

function queryText(key: string, scalar: unknown): FreeFormCheck<string> {
  if (!isQueryScalar(scalar)) {
    return refused(
      "invalid_query",
      `Query parameter "${key}" must be text, a number, true or false, or a list of those.`,
    );
  }
  const text = String(scalar);
  if (/[\r\n]/.test(text) || text.length > MAX_QUERY_VALUE_CHARS) {
    return refused(
      "invalid_query",
      `Query parameter "${key}" has a line break or is longer than ${MAX_QUERY_VALUE_CHARS} characters.`,
    );
  }
  return ok(text);
}

// Core's own header-name rule; it drops anything else without saying so.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Sent by the transport, the proxy or the provider's own sign-in: a person
// never supplies them. The first group mirrors what core drops silently, so a
// step that names one fails here instead of running without it; the method
// overrides are there because a read must never be tunnelled into a write.
const DENIED_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
  "cookie",
  "set-cookie",
  "host",
  "origin",
  "referer",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-http-method",
  "x-http-method-override",
  "x-method-override",
]);
// Any header whose name says it carries a credential.
const CREDENTIAL_WORDS = [
  "token",
  "secret",
  "api-key",
  "api_key",
  "apikey",
  "auth",
  "password",
  "passwd",
  "credential",
  "signature",
  "cookie",
];

/** Whether a request step may never set this header. */
export function isDeniedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    DENIED_HEADERS.has(lower) ||
    CREDENTIAL_WORDS.some((word) => lower.includes(word))
  );
}

/** Headers as an object of name to text. Credential and transport headers are refused by name. */
export function readFreeHeaders(
  value: unknown,
): FreeFormCheck<Record<string, string>> {
  if (!isRecord(value)) {
    return refused(
      "invalid_header",
      `"headers" must be an object of header names to text.`,
    );
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_HEADERS) {
    return refused(
      "invalid_header",
      `"headers" has more than ${MAX_HEADERS} entries.`,
    );
  }
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, raw] of entries) {
    if (name.length > MAX_NAME_CHARS || !HEADER_NAME.test(name)) {
      return refused(
        "invalid_header",
        `"headers" has a name that is not a valid header name.`,
      );
    }
    if (isDeniedHeader(name)) {
      return refused(
        "header_denied",
        `The header "${name}" cannot be set: Factory sends credentials and transport headers itself.`,
      );
    }
    if (seen.has(name.toLowerCase())) {
      return refused("invalid_header", `The header "${name}" is listed twice.`);
    }
    seen.add(name.toLowerCase());
    if (typeof raw !== "string") {
      return refused("invalid_header", `The header "${name}" must be text.`);
    }
    if (hasControl(raw, true) || raw.length > MAX_HEADER_VALUE_CHARS) {
      return refused(
        "invalid_header",
        `The header "${name}" has a control character or is longer than ${MAX_HEADER_VALUE_CHARS} characters.`,
      );
    }
    headers[name] = raw;
  }
  return ok(headers);
}

/** `none` sends the request with no credential, for a public endpoint on the provider's host. */
export function readFreeAuth(
  value: unknown,
): FreeFormCheck<"default" | "none"> {
  if (value === "provider") return ok("default");
  if (value === "none") return ok("none");
  return refused("invalid_field", `"authentication" is "provider" or "none".`);
}

/** Seconds, from 1 to the ceiling, as milliseconds. */
export function readFreeTimeout(value: unknown): FreeFormCheck<number> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > FREE_FORM_MAX_TIMEOUT_SECONDS
  ) {
    return refused(
      "invalid_timeout",
      `"timeoutSeconds" is a number from 1 to ${FREE_FORM_MAX_TIMEOUT_SECONDS}.`,
    );
  }
  return ok(Math.round(value * 1_000));
}

export interface FreeFormPagination {
  cursorPath: string;
  cursorParam: string;
  itemsPath?: string;
  maxPages: number;
}

const PATH_SEGMENT = /^[A-Za-z0-9_$-]+$/;
const UNREADABLE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const PAGINATION_KEYS = new Set([
  "cursorPath",
  "cursorParam",
  "itemsPath",
  "maxPages",
]);

function isBodyPath(text: string): boolean {
  return (
    text.length <= MAX_CURSOR_PATH_CHARS &&
    text
      .split(".")
      .every(
        (segment) =>
          PATH_SEGMENT.test(segment) && !UNREADABLE_SEGMENTS.has(segment),
      )
  );
}

/**
 * Cursor paging, which core reads from the body: the page's next cursor sits at
 * `cursorPath` and is sent back in the query as `cursorParam`. Both are
 * required because a wrong guess would fetch the first page again and report it
 * as a second one. `itemsPath` names the list in each page; without it a page
 * is one entry.
 */
export function readFreePagination(
  value: unknown,
): FreeFormCheck<FreeFormPagination> {
  if (!isRecord(value)) {
    return refused(
      "invalid_pagination",
      `"pagination" must be an object with cursorPath and cursorParam.`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!PAGINATION_KEYS.has(key)) {
      return refused(
        "invalid_pagination",
        `"pagination" has a setting that is not cursorPath, cursorParam, itemsPath or maxPages.`,
      );
    }
  }
  const { cursorPath, cursorParam, itemsPath, maxPages } = value;
  if (typeof cursorPath !== "string" || !isBodyPath(cursorPath)) {
    return refused(
      "invalid_pagination",
      `"pagination.cursorPath" is a dotted path to the next cursor in the response, such as response_metadata.next_cursor.`,
    );
  }
  if (
    typeof cursorParam !== "string" ||
    cursorParam.length > MAX_NAME_CHARS ||
    !QUERY_KEY.test(cursorParam)
  ) {
    return refused(
      "invalid_pagination",
      `"pagination.cursorParam" is the query parameter the next cursor is sent in.`,
    );
  }
  if (
    itemsPath !== undefined &&
    (typeof itemsPath !== "string" || !isBodyPath(itemsPath))
  ) {
    return refused(
      "invalid_pagination",
      `"pagination.itemsPath" is a dotted path to the list in each page.`,
    );
  }
  if (
    maxPages !== undefined &&
    (typeof maxPages !== "number" ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > FREE_FORM_MAX_PAGES)
  ) {
    return refused(
      "invalid_pagination",
      `"pagination.maxPages" is a whole number from 1 to ${FREE_FORM_MAX_PAGES}.`,
    );
  }
  return ok({
    cursorPath,
    cursorParam,
    ...(itemsPath === undefined ? {} : { itemsPath }),
    maxPages: maxPages ?? FREE_FORM_DEFAULT_PAGES,
  });
}

/** The paths a step keeps of the provider's answer; see `fields-to-keep.ts` for the rules. */
export function readFreeFieldsToKeep(
  value: unknown,
): FreeFormCheck<FieldsToKeep> {
  const parsed = parseFieldsToKeep(value);
  return parsed.ok
    ? ok(parsed.value)
    : refused("invalid_fields_to_keep", parsed.message);
}

/** The response headers a step may hand to a graph: the ones that describe the answer, never a cookie or anything that signs in. */
export function allowedResponseHeaders(
  headers: unknown,
): Record<string, string> {
  const kept: Record<string, string> = {};
  if (!isRecord(headers)) return kept;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (typeof value !== "string") continue;
    if (
      lower === "content-type" ||
      lower === "link" ||
      lower === "etag" ||
      lower === "date" ||
      lower === "retry-after" ||
      lower.startsWith("x-ratelimit-")
    ) {
      kept[lower] = value;
    }
  }
  return kept;
}

/** What each free-form field is for, by the operation's declared field name. */
export type FreeFormRole =
  | "path"
  | "query"
  | "headers"
  | "auth"
  | "timeoutSeconds"
  | "pagination"
  | "includeStatus"
  | "fieldsToKeep";

export function freeFormRoleOf(
  freeForm: FreeFormRequest,
  fieldName: string,
): FreeFormRole | undefined {
  const roles: FreeFormRole[] = [
    "path",
    "query",
    "headers",
    "auth",
    "timeoutSeconds",
    "pagination",
    "includeStatus",
    "fieldsToKeep",
  ];
  return roles.find((role) => freeForm[role] === fieldName);
}

/**
 * Why a value typed into a free-form field would be refused, as the same typed
 * code and message a run gives, or null when it would not. For the save-time
 * check of a fixed value; a value read from an earlier step is checked when the
 * step runs.
 */
export function checkFreeFormValue(
  freeForm: FreeFormRequest,
  role: FreeFormRole,
  value: unknown,
): { code: FreeFormFailureCode; message: string } | null {
  let check: FreeFormCheck<unknown> | undefined;
  switch (role) {
    case "path":
      check =
        typeof value === "string" && value.trim() === ""
          ? undefined
          : readFreePath(value, freeForm.placeholders);
      break;
    case "query":
      check = readFreeQuery(value);
      break;
    case "headers":
      check = readFreeHeaders(value);
      break;
    case "timeoutSeconds":
      check = readFreeTimeout(value);
      break;
    case "pagination":
      check = readFreePagination(value);
      break;
    case "fieldsToKeep":
      check = readFreeFieldsToKeep(value);
      break;
    case "auth":
    case "includeStatus":
      return null;
  }
  return check && !check.ok
    ? { code: check.code, message: check.message }
    : null;
}

/** The refusal for asking for the status beside paging: only the last page's status is known. */
export const STATUS_WITH_PAGING_REFUSAL = {
  code: "incompatible_fields",
  message:
    '"includeStatus" cannot be combined with "pagination": only the last page\'s status is known.',
} as const satisfies { code: FreeFormFailureCode; message: string };
