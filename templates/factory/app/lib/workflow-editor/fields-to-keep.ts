/**
 * "Fields to keep" on an API request, as plain functions: the rules the server
 * refuses a list of paths by (so a mistake shows before a run), the chips a
 * person builds the list from, and the paths a response offers to pick from.
 * Every problem is a reason; the form words each one.
 *
 * A path is dotted (`user.login`), trimmed, of at most 8 segments that are each
 * 1 to 64 characters; a list holds 1 to 50 distinct paths. The segments
 * `__proto__`, `constructor` and `prototype` are never allowed.
 */

export const MAX_KEEP_PATHS = 50;
export const MAX_KEEP_SEGMENTS = 8;
export const MAX_KEEP_SEGMENT_CHARS = 64;

const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** What is wrong with the list as a whole. */
export type KeepListReason = "shape" | "empty" | "count";
/** What is wrong with one path. */
export type KeepPathReason =
  | "control"
  | "segment"
  | "deep"
  | "long"
  | "reserved"
  | "duplicate";

export interface KeepPathProblem {
  index: number;
  path: string;
  reason: KeepPathReason;
}

export interface KeepCheck {
  list?: KeepListReason;
  paths: KeepPathProblem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The strings of a saved list, or undefined when it is not a list of strings. */
export function chipsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const chips: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    chips.push(entry);
  }
  return chips;
}

/** A control character, which no part of a path may hold. */
function hasControl(text: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(text);
}

/**
 * Why one path would be refused on its own, or undefined when it would not. The
 * checks run in the server's order, so the reason shown is the one it would give.
 */
export function pathReason(
  path: string,
): Exclude<KeepPathReason, "duplicate"> | undefined {
  const text = path.trim();
  if (hasControl(text)) return "control";
  const segments = text.split(".");
  if (segments.some((segment) => segment === "")) return "segment";
  if (segments.length > MAX_KEEP_SEGMENTS) return "deep";
  if (segments.some((segment) => segment.length > MAX_KEEP_SEGMENT_CHARS)) {
    return "long";
  }
  if (segments.some((segment) => RESERVED_SEGMENTS.has(segment))) {
    return "reserved";
  }
  return undefined;
}

/** Whether the server accepts this path as a member of a list. */
export function isKeepablePath(path: string): boolean {
  return pathReason(path) === undefined;
}

/** Every way a saved value would be refused: the list as a whole, and each path by its place in it. */
export function checkFieldsToKeep(value: unknown): KeepCheck {
  const chips = chipsOf(value);
  if (chips === undefined) return { list: "shape", paths: [] };
  if (chips.length === 0) return { list: "empty", paths: [] };
  const seen = new Set<string>();
  const paths: KeepPathProblem[] = [];
  chips.forEach((path, index) => {
    const trimmed = path.trim();
    const reason =
      pathReason(trimmed) ?? (seen.has(trimmed) ? "duplicate" : undefined);
    seen.add(trimmed);
    if (reason !== undefined) paths.push({ index, path, reason });
  });
  return {
    ...(chips.length > MAX_KEEP_PATHS ? { list: "count" as const } : {}),
    paths,
  };
}

/** The first thing wrong with a saved value, for the one sentence a card or a list of problems shows. */
export function firstKeepProblem(
  value: unknown,
): { reason: KeepListReason | KeepPathReason; path?: string } | undefined {
  const check = checkFieldsToKeep(value);
  if (check.list !== undefined) return { reason: check.list };
  const [first] = check.paths.map((problem) => ({
    reason: problem.reason,
    path: problem.path,
  }));
  return first;
}

// ---------------------------------------------------------------------------
// Chips

/** The paths in typed or pasted text: split at commas and line breaks, trimmed, empty ones dropped. */
export function splitPaths(text: string): string[] {
  return text
    .split(/[,\n\r]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** The list with the paths added that it does not hold already. The same list comes back when nothing is new. */
export function addPaths(
  current: readonly string[],
  typed: readonly string[],
): string[] {
  const held = new Set(current.map((path) => path.trim()));
  const added: string[] = [];
  for (const path of typed.map((entry) => entry.trim())) {
    if (path === "" || held.has(path)) continue;
    held.add(path);
    added.push(path);
  }
  return added.length === 0 ? [...current] : [...current, ...added];
}

export function removePathAt(
  current: readonly string[],
  index: number,
): string[] {
  return current.filter((_, position) => position !== index);
}

/** A pick from the response: the path is added when the list lacks it and removed when it holds it. */
export function togglePath(current: readonly string[], path: string): string[] {
  return current.some((held) => held.trim() === path)
    ? current.filter((held) => held.trim() !== path)
    : [...current, path];
}

// ---------------------------------------------------------------------------
// Paths a response offers

/** A key that can be one segment of a path the server accepts: written as it is, no dot, a name it allows. */
function isUsableKey(key: string): boolean {
  return (
    key !== "" &&
    key === key.trim() &&
    !key.includes(".") &&
    key.length <= MAX_KEEP_SEGMENT_CHARS &&
    !RESERVED_SEGMENTS.has(key) &&
    !hasControl(key)
  );
}

export interface LeafPaths {
  paths: string[];
  /** There were more paths than `maxPaths`. */
  capped: boolean;
}

/**
 * The paths a response has values at: an object's keys, nested; a list is
 * flattened into the paths of its entries, so a list of pull requests offers
 * `number`, `title` and `user.login`. A key the server could not take as part of
 * a path is skipped with everything under it, and a path is never offered deeper
 * than a list may go, so every path returned is one the server accepts.
 */
export function leafPathsOf(
  json: unknown,
  options: { maxPaths?: number; maxDepth?: number } = {},
): LeafPaths {
  const maxPaths = options.maxPaths ?? 200;
  const maxDepth = Math.min(options.maxDepth ?? 8, MAX_KEEP_SEGMENTS);
  const paths: string[] = [];
  const seen = new Set<string>();
  let capped = false;

  const leaf = (prefix: readonly string[]) => {
    if (prefix.length === 0) return;
    const path = prefix.join(".");
    if (seen.has(path) || !isKeepablePath(path)) return;
    if (paths.length >= maxPaths) {
      capped = true;
      return;
    }
    seen.add(path);
    paths.push(path);
  };

  const visit = (value: unknown, prefix: readonly string[]) => {
    if (capped) return;
    if (Array.isArray(value)) {
      if (value.length === 0) leaf(prefix);
      for (const entry of value) visit(entry, prefix);
      return;
    }
    if (isRecord(value)) {
      const keys = Object.keys(value).filter(isUsableKey);
      // Below the deepest level a path may go, the object itself is what can be kept.
      if (keys.length === 0 || prefix.length >= maxDepth) {
        leaf(prefix);
        return;
      }
      for (const key of keys) visit(value[key], [...prefix, key]);
      return;
    }
    leaf(prefix);
  };

  visit(json, []);
  return { paths, capped };
}

/** The keys of the report a step writes beside the answer it hands on. */
const REPORT_KEYS: ReadonlySet<string> = new Set([
  "truncated",
  "cuts",
  "cutsOmitted",
  "fieldsMissing",
  "fieldsMissingMore",
  "count",
  "totalAvailable",
  "value",
]);

/**
 * A list, or any body that is not an object, as the step wraps it once it has a
 * report to add: `{ ...report, value }`. Undefined for anything else, which
 * includes an object that merely has a `value` key among its own.
 */
export function wrappedValueOf(
  output: unknown,
): { value: unknown } | undefined {
  if (!isRecord(output) || !("value" in output)) return undefined;
  const reported =
    output.truncated === true || Array.isArray(output.fieldsMissing);
  return reported && Object.keys(output).every((key) => REPORT_KEYS.has(key))
    ? { value: output.value }
    : undefined;
}

/**
 * The provider's own answer inside what a step hands on, which is what paths
 * are written against: the report's `body` when status and headers are asked
 * for, the entries of a paged answer, the value a step wrapped, and an object
 * without the keys the step added to it.
 */
export function providerBodyOf(
  output: unknown,
  options: { includeStatus: boolean },
): unknown {
  let body = output;
  if (
    options.includeStatus &&
    isRecord(body) &&
    typeof body.status === "number" &&
    "body" in body
  ) {
    body = body.body;
  }
  if (!isRecord(body)) return body;
  if (typeof body.pagesRead === "number" && Array.isArray(body.items)) {
    return body.items;
  }
  const wrapped = wrappedValueOf(body);
  if (wrapped) return wrapped.value;
  // The keys a step writes beside the answer. A `truncated` with no `cuts` beside it is the provider's own.
  const added = new Set<string>();
  if (body.truncated === true && Array.isArray(body.cuts)) {
    for (const key of ["truncated", "cuts", "cutsOmitted"]) added.add(key);
  }
  if (Array.isArray(body.fieldsMissing)) {
    added.add("fieldsMissing");
    added.add("fieldsMissingMore");
  }
  if (added.size === 0) return body;
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !added.has(key)),
  );
}
