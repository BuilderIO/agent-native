export const PATH_ROOTS = ["item", "nodes", "settings", "run", "loop"] as const;
type PathRoot = (typeof PATH_ROOTS)[number];

// Reading these would reach the prototype chain of whatever object a path walks.
export const FORBIDDEN_SEGMENTS = [
  "__proto__",
  "constructor",
  "prototype",
] as const;

export const MAX_PATH_LENGTH = 200;

const EXPRESSION_ERROR_CODES = [
  "empty_expression",
  "unclosed_hole",
  "unknown_root",
  "unexpected_token",
  "bad_index",
  "forbidden_segment",
  "path_too_long",
  "missing_value",
  "not_renderable",
] as const;
export type ExpressionErrorCode = (typeof EXPRESSION_ERROR_CODES)[number];

export class ExpressionError extends Error {
  readonly code: ExpressionErrorCode;
  /** Character offset into the text handed to the function that failed. */
  readonly position: number;
  readonly path?: string;

  constructor(
    code: ExpressionErrorCode,
    position: number,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = "ExpressionError";
    this.code = code;
    this.position = position;
    this.path = path;
  }
}

export type PathSegment = string | number;

export interface ParsedPath {
  root: PathRoot;
  segments: PathSegment[];
}

interface ResponsePath {
  segments: PathSegment[];
}

interface TemplateHole extends ParsedPath {
  type: "hole";
  /** The path as written, without braces or padding. */
  path: string;
  /** Offsets of the `{{` and one past the `}}` in the template text. */
  start: number;
  end: number;
}

type TemplatePart = { type: "text"; text: string } | TemplateHole;

export interface Template {
  source: string;
  parts: TemplatePart[];
  /** The text is exactly one hole, so evaluation keeps the value's type. */
  wholeValue: boolean;
}

export interface Scope {
  item: unknown;
  nodes: Readonly<Record<string, unknown>>;
  settings: Readonly<Record<string, unknown>>;
  run: Readonly<Record<string, unknown>>;
  loop: Readonly<Record<string, unknown>>;
}

type PathCheck =
  | { ok: true; path: ParsedPath }
  | { ok: false; error: ExpressionError };

type PathLookup = { found: true; value: unknown } | { found: false };

export type ExpressionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExpressionError };

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function isForbiddenSegment(segment: string): boolean {
  return (FORBIDDEN_SEGMENTS as readonly string[]).includes(segment);
}

function isPathRoot(value: string): value is PathRoot {
  return (PATH_ROOTS as readonly string[]).includes(value);
}

function describe(text: string, at: number): string {
  const char = text[at];
  return char === undefined ? "end of expression" : `"${char}"`;
}

function readIdentifier(
  text: string,
  from: number,
): { value: string; end: number } | null {
  if (!IDENTIFIER_START.test(text[from] ?? "")) return null;
  let end = from + 1;
  while (end < text.length && IDENTIFIER_PART.test(text[end])) end += 1;
  return { value: text.slice(from, end), end };
}

/**
 * Reads `.name` and `[0]` segments from `cursor` to the end of `text`. Anything
 * else — a call, an operator, a quoted key, a space — is rejected at its
 * position, so the grammar stays closed.
 */
function readSegments(
  text: string,
  cursor: number,
  base: number,
  segments: PathSegment[],
): PathSegment[] {
  let at = cursor;
  while (at < text.length) {
    const char = text[at];
    if (char === ".") {
      const name = readIdentifier(text, at + 1);
      if (!name) {
        throw new ExpressionError(
          "unexpected_token",
          base + at + 1,
          `Expected a field name after "." but found ${describe(text, at + 1)}.`,
        );
      }
      if (isForbiddenSegment(name.value)) {
        throw new ExpressionError(
          "forbidden_segment",
          base + at + 1,
          `"${name.value}" cannot be read from a path.`,
        );
      }
      segments.push(name.value);
      at = name.end;
      continue;
    }
    if (char === "[") {
      let end = at + 1;
      while (end < text.length && DIGIT.test(text[end])) end += 1;
      const digits = text.slice(at + 1, end);
      const index = Number(digits);
      if (
        digits === "" ||
        text[end] !== "]" ||
        (digits.length > 1 && digits.startsWith("0")) ||
        !Number.isSafeInteger(index)
      ) {
        throw new ExpressionError(
          "bad_index",
          base + at + 1,
          "An index must be a whole number in brackets, such as [0].",
        );
      }
      segments.push(index);
      at = end + 1;
      continue;
    }
    throw new ExpressionError(
      "unexpected_token",
      base + at,
      `Unexpected ${describe(text, at)}: paths only allow field names and [0] indexes.`,
    );
  }
  return segments;
}

function parseRooted(text: string, base: number): ParsedPath {
  if (text.length > MAX_PATH_LENGTH) {
    throw new ExpressionError(
      "path_too_long",
      base,
      `A path can be at most ${MAX_PATH_LENGTH} characters.`,
    );
  }
  if (text.length === 0) {
    throw new ExpressionError("empty_expression", base, "The path is empty.");
  }
  const root = readIdentifier(text, 0);
  if (!root) {
    throw new ExpressionError(
      "unexpected_token",
      base,
      `A path starts with ${PATH_ROOTS.join(", ")} but found ${describe(text, 0)}.`,
    );
  }
  if (!isPathRoot(root.value)) {
    throw new ExpressionError(
      "unknown_root",
      base,
      `"${root.value}" is not a path root. Use ${PATH_ROOTS.join(", ")}.`,
    );
  }
  return {
    root: root.value,
    segments: readSegments(text, root.end, base, []),
  };
}

/** Parses a bare path such as `item.payload.items[0].name`; throws on any other syntax. */
export function parsePath(path: string): ParsedPath {
  return parseRooted(path, 0);
}

export function validatePath(path: string): PathCheck {
  try {
    return { ok: true, path: parsePath(path) };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error };
    throw error;
  }
}

/**
 * A path into a provider response, which has no root: `data.items[0].name`.
 * Segments follow the same closed grammar as `parsePath`.
 */
export function validateResponsePath(
  path: string,
): { ok: true; path: ResponsePath } | { ok: false; error: ExpressionError } {
  try {
    if (path.length > MAX_PATH_LENGTH) {
      throw new ExpressionError(
        "path_too_long",
        0,
        `A path can be at most ${MAX_PATH_LENGTH} characters.`,
      );
    }
    if (path.length === 0) {
      throw new ExpressionError("empty_expression", 0, "The path is empty.");
    }
    const segments: PathSegment[] = [];
    let cursor = 0;
    if (path[0] !== "[") {
      const first = readIdentifier(path, 0);
      if (!first) {
        throw new ExpressionError(
          "unexpected_token",
          0,
          `A response path starts with a field name but found ${describe(path, 0)}.`,
        );
      }
      if (isForbiddenSegment(first.value)) {
        throw new ExpressionError(
          "forbidden_segment",
          0,
          `"${first.value}" cannot be read from a path.`,
        );
      }
      segments.push(first.value);
      cursor = first.end;
    }
    return {
      ok: true,
      path: { segments: readSegments(path, cursor, 0, segments) },
    };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error };
    throw error;
  }
}

/** Splits text into literal runs and `{{ path }}` holes; throws with a position on any malformed hole. */
export function parseTemplate(text: string): Template {
  const parts: TemplatePart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{{", cursor);
    if (open === -1) {
      parts.push({ type: "text", text: text.slice(cursor) });
      break;
    }
    if (open > cursor) {
      parts.push({ type: "text", text: text.slice(cursor, open) });
    }
    const close = text.indexOf("}}", open + 2);
    if (close === -1) {
      throw new ExpressionError(
        "unclosed_hole",
        open,
        'A "{{" has no closing "}}".',
      );
    }
    const inner = text.slice(open + 2, close);
    const leading = inner.length - inner.trimStart().length;
    const path = inner.trim();
    const parsed = parseRooted(path, open + 2 + leading);
    parts.push({
      type: "hole",
      path,
      root: parsed.root,
      segments: parsed.segments,
      start: open,
      end: close + 2,
    });
    cursor = close + 2;
  }
  return {
    source: text,
    parts,
    wholeValue: parts.length === 1 && parts[0].type === "hole",
  };
}

export function collectPaths(template: Template | string): TemplateHole[] {
  const parsed =
    typeof template === "string" ? parseTemplate(template) : template;
  return parsed.parts.filter(
    (part): part is TemplateHole => part.type === "hole",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Walks `path` through `scope` without inventing values. A missing key, an
 * out-of-range index, or a step into a primitive is `{ found: false }`; a stored
 * `null`, `""`, `0`, or `false` is `{ found: true }`. Only own properties are
 * read, so `item.toString` and `list.length` are missing. A malformed path
 * throws: it is a graph bug, not an absent value.
 */
export function evaluatePath(
  path: string | ParsedPath,
  scope: Scope,
): PathLookup {
  const parsed = typeof path === "string" ? parsePath(path) : path;
  let current: unknown = scope[parsed.root];
  if (current === undefined) return { found: false };
  for (const segment of parsed.segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) {
        return { found: false };
      }
      current = current[segment];
    } else {
      if (!isRecord(current) || !hasOwn(current, segment)) {
        return { found: false };
      }
      current = current[segment];
    }
    if (current === undefined) return { found: false };
  }
  return { found: true, value: current };
}

function toTemplate(text: string | Template): ExpressionResult<Template> {
  if (typeof text !== "string") return { ok: true, value: text };
  try {
    return { ok: true, value: parseTemplate(text) };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error };
    throw error;
  }
}

function missing(hole: TemplateHole): ExpressionResult<never> {
  return {
    ok: false,
    error: new ExpressionError(
      "missing_value",
      hole.start,
      `"${hole.path}" has no value here.`,
      hole.path,
    ),
  };
}

function renderScalar(
  hole: TemplateHole,
  value: unknown,
): ExpressionResult<string> {
  if (typeof value === "string") return { ok: true, value };
  if (typeof value === "number" || typeof value === "boolean") {
    return { ok: true, value: String(value) };
  }
  return {
    ok: false,
    error: new ExpressionError(
      "not_renderable",
      hole.start,
      `"${hole.path}" is ${value === null ? "null" : "a list or object"}; text can only embed a string, number, or true/false.`,
      hole.path,
    ),
  };
}

/**
 * Fills every hole and returns the text. Any missing hole, and any value that
 * is not a string, number, or boolean, is an error instead of a blank.
 */
export function renderTemplate(
  text: string | Template,
  scope: Scope,
): ExpressionResult<string> {
  const template = toTemplate(text);
  if (!template.ok) return template;
  let out = "";
  for (const part of template.value.parts) {
    if (part.type === "text") {
      out += part.text;
      continue;
    }
    const lookup = evaluatePath(part, scope);
    if (!lookup.found) return missing(part);
    const rendered = renderScalar(part, lookup.value);
    if (!rendered.ok) return rendered;
    out += rendered.value;
  }
  return { ok: true, value: out };
}

/**
 * Like `renderTemplate`, but a text that is exactly one hole keeps its value
 * (a number stays a number, a list stays a list) so structured arguments can
 * be bound from upstream.
 */
export function evaluateTemplate(
  text: string | Template,
  scope: Scope,
): ExpressionResult<unknown> {
  const template = toTemplate(text);
  if (!template.ok) return template;
  const [only] = template.value.parts;
  if (template.value.wholeValue && only.type === "hole") {
    const lookup = evaluatePath(only, scope);
    return lookup.found ? { ok: true, value: lookup.value } : missing(only);
  }
  return renderTemplate(template.value, scope);
}
