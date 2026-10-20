/**
 * What may be stored about an unexpected event, and nothing more. Everything a
 * tripwire records, and everything the diagnostics bundle shows, passes
 * through here, so a secret that reaches an error message or a provider body
 * cannot reach the database or a person's clipboard.
 *
 * Three tools, from loosest to strictest:
 * - `scrub(text)`: free text. Removes anything token-like, then clips it.
 * - `describeShape(value)`: the structure of a value. Key names and type names,
 *   never a value.
 * - `sanitizeDetails(fields)`: the allow-list a tripwire's `details` pass
 *   through. Numbers, booleans, short scrubbed strings, shapes; the rest is
 *   dropped and counted.
 *
 * Pure: no imports from Factory, no I/O.
 */

export const SCRUB_MAX_CHARS = 200;
export const DETAILS_MAX_BYTES = 4096;
const SHAPE_MAX_DEPTH = 3;
const SHAPE_MAX_KEYS = 40;

const SHAPE_KEY_MAX_CHARS = 40;
const DETAIL_FIELDS_MAX = 64;
const DETAIL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// A field that is named for a secret never carries text, whatever the text is.
const SENSITIVE_NAME =
  /token|secret|passw|authorization|api_?key|cookie|credential|private_?key/i;
const RESERVED_DETAIL_NAMES: ReadonlySet<string> = new Set([
  "operationId",
  "invariant",
  "droppedFields",
  "suppressed",
]);

export const REDACTED = "[redacted]";
const EMAIL = "[email]";
// What a field holds when reading it threw: its own value, never a clean one.
export const UNREADABLE = "[unreadable]";
const TRUNCATED = "…[truncated]";
const ALREADY_REDACTED = String.raw`(?!\[(?:redacted|email)\])`;

// Past this the rest of a text is cut before any pattern reads it, so the work
// is bounded by the cap whatever the caller hands in.
export const REDACT_INPUT_MAX_CHARS = 100_000;

// Prefixes of credentials that appear in provider calls. The long-run rule in
// `scrub` is the net for everything not named here.
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bxox[a-z0-9]*[-.][A-Za-z0-9._-]{4,}/gi,
  /\bxapp-[A-Za-z0-9-]{4,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bglpat-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bwhsec_[A-Za-z0-9]{8,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bbpk-[A-Za-z0-9-]{8,}/g,
  /\bsntry[us]_[A-Za-z0-9+/=_-]{8,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  // The header segment is bounded: a run of `eyJ-eyJ-...` would otherwise be re-read to its end from every `eyJ`.
  /\beyJ[A-Za-z0-9_-]{4,512}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
];

const URL_PATTERN =
  /\b([a-z][a-z0-9+.-]{1,15}:\/\/)([^\s/?#<>"']*)([^\s?#<>"']*)(\?[^\s#<>"']*)?(#[^\s<>"']*)?/gi;
const BARE_QUERY = /\?(?=[\w.~%-]+=)[^\s"'<>#]*/g;

// An address in any script (`anna@bücher.de`), or with its `@` (and dots)
// percent-encoded, once or twice (`ana%40example.test`, `ana%2540example.test`).
// The lookbehind lets a match start only at the front of a run of address
// characters, so a long run with no `@` is read once and not once per letter.
const MAIL_CHARS = String.raw`\p{L}\p{M}\p{N}`;
const EMAIL_PATTERN = new RegExp(
  String.raw`(?<![${MAIL_CHARS}._%+'-])[${MAIL_CHARS}._%+'-]+(?:@|%(?:25)*40)[${MAIL_CHARS}-]+(?:(?:\.|%(?:25)*2[eE])[${MAIL_CHARS}-]+)+`,
  "gu",
);

// Between a secret's name and its value: `=`, `:`, `": "`, and the same inside
// JSON that was itself put in a string (`\"password\":\"x\"`). A name may carry
// a prefix (`DB_PASSWORD`, `X_API_KEY`), so none of these start at a word boundary.
const KEY_SEPARATOR = String.raw`(\\*["']?\s*[:=]\s*\\*["']?)`;
// One parameter of a credential: `abc`, or `realm="x y"`.
const CREDENTIAL_PARAM = String.raw`(?:[^\s"',;=]+=)?(?:"[^"]*"|[^\s"',;]+)`;
// One `name=value` or bare attribute of a cookie. `Expires` holds a date with
// spaces and a comma, which would otherwise end the header there and leave the
// cookies that follow it.
const COOKIE_PART = String.raw`(?:expires=[A-Za-z]{3},?\s+\d{1,2}[\s-][A-Za-z]{3}[\s-]\d{2,4}\s+\d{2}:\d{2}:\d{2}(?:\s+GMT)?|[^\s;"',=]+(?:=(?:"[^"]*"|[^\s;"',]*))?)`;

// The whole value: `Bearer x`, `Digest a="b", c="d"`, `AWS4-HMAC-SHA256 A=b, C=d`.
const AUTHORIZATION_VALUE = new RegExp(
  String.raw`(authorization)${KEY_SEPARATOR}(?:(?:bearer|basic|digest|token|negotiate|ntlm|oauth|dpop|hmac|aws4-hmac-sha256|apikey)\s+)?${CREDENTIAL_PARAM}(?:\s*,\s*${CREDENTIAL_PARAM})*`,
  "gi",
);
// Every pair of a `Cookie` or `Set-Cookie` header, not only the first.
const COOKIE_VALUE = new RegExp(
  String.raw`(cookie)${KEY_SEPARATOR}${COOKIE_PART}(?:[;,]\s*${COOKIE_PART})*`,
  "gi",
);
// A value starts where text does: not at `[redacted]` (a value already removed),
// and not at the backslash of a closing `\"` the separator could have backed off from.
const VALUE_START = String.raw`${ALREADY_REDACTED}(?!\\+["'])`;
const STRONG_KEY_VALUE = new RegExp(
  String.raw`(api[-_ ]?key|apikey|client[-_ ]?secret|secret|secret[-_ ]?key|access[-_ ]?key|password|passwd|pwd|private[-_ ]?key)${KEY_SEPARATOR}${VALUE_START}[^\s"',;&)}\]]+`,
  "gi",
);
const WEAK_KEY_VALUE = new RegExp(
  String.raw`((?:access|refresh|id|auth|session|csrf|bearer|api)[-_ ]?token|token|session|signature)${KEY_SEPARATOR}${VALUE_START}([^\s"',;&)}\]]+)`,
  "gi",
);

const ID_SHAPE = /^[A-Za-z0-9_.:@#/-]{1,512}$/;
const INPUT_CHARS_MIN = 4000;
const INPUT_CHARS_FACTOR = 16;

const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{24,}/g;
const PATH_SEGMENT = /^[a-z0-9._-]+$/;

/**
 * The rules with no false positives worth worrying about: named credential
 * prefixes, JWTs, bearer values, `key=value` secrets, emails, and everything
 * after a `?` in a URL. Safe to run over identifiers.
 */
export function redactSecrets(text: string): string {
  let out = (
    text.length > REDACT_INPUT_MAX_CHARS
      ? `${text.slice(0, REDACT_INPUT_MAX_CHARS)}${TRUNCATED}`
      : text
  ).replace(/\p{Cf}/gu, "");
  out = out.replace(
    URL_PATTERN,
    (_match, scheme: string, authority: string, path: string, query?: string) =>
      `${scheme}${authority.slice(authority.lastIndexOf("@") + 1)}${path}${query ? `?${REDACTED}` : ""}`,
  );
  out = out.replace(BARE_QUERY, `?${REDACTED}`);
  out = out.replace(EMAIL_PATTERN, EMAIL);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  for (const pattern of [AUTHORIZATION_VALUE, COOKIE_VALUE, STRONG_KEY_VALUE]) {
    out = out.replace(pattern, (match, name: string, separator: string) =>
      redactedValue(match, name, separator),
    );
  }
  out = out.replace(
    WEAK_KEY_VALUE,
    (match, name: string, separator: string, value: string) =>
      value.length >= 8 || /\d/.test(value)
        ? redactedValue(match, name, separator)
        : match,
  );
  return out;
}

// A value inside escaped JSON ends in the backslash of its closing `\"`, which
// stays so the text around it still reads the way it did.
function redactedValue(match: string, name: string, separator: string): string {
  const escapes = /\\+$/.exec(match)?.[0] ?? "";
  return `${name}${separator}${REDACTED}${escapes}`;
}

// A flip is a change of case between two neighbouring letters. Random base64
// flips about every other letter; a camelCase identifier flips in and out at
// each capital, about every third.
function flipsCase(run: string): boolean {
  let letters = 0;
  let flips = 0;
  let previous: string | undefined;
  for (const char of run) {
    const upper = char >= "A" && char <= "Z";
    const lower = char >= "a" && char <= "z";
    if (!upper && !lower) {
      previous = undefined;
      continue;
    }
    letters += 1;
    if (previous !== undefined && previous !== (upper ? "U" : "L")) flips += 1;
    previous = upper ? "U" : "L";
  }
  return letters >= 16 && flips / letters >= 0.45;
}

function looksOpaque(run: string): boolean {
  if (run.length < 24) return false;
  if (/\d/.test(run)) return true;
  return run.length >= 32 && flipsCase(run);
}

function isPathLike(segments: readonly string[]): boolean {
  const named = segments.filter((segment) => segment !== "");
  if (named.length < 2) return false;
  const plain = named.filter((segment) => PATH_SEGMENT.test(segment)).length;
  return plain / named.length >= 0.7;
}

// A 40-character base64 secret can contain `/`, so a run with slashes is cut
// into path segments only when it reads as a path of lowercase words.
function redactOpaqueRun(run: string): string {
  if (!run.includes("/")) return looksOpaque(run) ? REDACTED : run;
  const segments = run.split("/");
  if (!isPathLike(segments)) return looksOpaque(run) ? REDACTED : run;
  return segments
    .map((segment) => (looksOpaque(segment) ? REDACTED : segment))
    .join("/");
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Free text made safe to store or show: control characters become spaces,
 * anything token-like is replaced (`xox*`, `ghp_`, `github_pat_`, `sk-`,
 * `Bearer ...`, JWTs, `password=...`, emails, URL query strings, and any
 * opaque run of 24 or more characters that contains a digit), then the text is
 * clipped. The clip comes last, so it can only remove text, never expose some.
 */
export function scrub(
  text: string,
  maxChars: number = SCRUB_MAX_CHARS,
): string {
  // Only the front of a long text can survive the clip, so only it is read:
  // a provider's whole error body is never matched against every pattern.
  const limit = Math.max(INPUT_CHARS_MIN, maxChars * INPUT_CHARS_FACTOR);
  const bounded = text.length > limit ? text.slice(0, limit) : text;
  const normalized = bounded
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = redactSecrets(normalized).replace(
    OPAQUE_RUN,
    redactOpaqueRun,
  );
  return clip(redacted, maxChars);
}

/**
 * An identifier made safe to store. Something shaped like an id (letters,
 * digits, `_ . : @ # / -`) gets the high-precision rules only: a workflow or
 * run id is longer than 24 characters and holds digits, so `scrub` would erase
 * it, while an id that carries a credential prefix is still erased here.
 * Anything else is text, and is scrubbed as text.
 */
export function scrubId(
  id: string,
  maxChars: number = SCRUB_MAX_CHARS,
): string {
  const cleaned = redactSecrets(id.replace(/\p{Cc}/gu, " ")).trim();
  if (ID_SHAPE.test(cleaned)) return clip(cleaned, maxChars);
  // Not shaped like an id (spaces, brackets, an email's remains): it is text.
  return clip(scrub(cleaned, maxChars).replace(/\s+/g, "_"), maxChars);
}

const REDACT_DEEP_MAX_DEPTH = 16;
const REDACT_DEEP_MAX_NODES = 10_000;

interface DeepWalk {
  /** Nodes left to visit; a value wider than this is cut, and says so. */
  nodes: number;
  /** The objects on the way down, so a cycle is named once and never re-walked. */
  path: Set<object>;
}

/**
 * Applies `redactSecrets` to every string, and every key, of a JSON-like value.
 * A cycle, a value past the depth or size budget, and a property that throws
 * when read each become a marker of their own (`[cycle]`, `[redacted]`,
 * `[truncated]`, `[unreadable]`), so a hostile value costs a bounded walk and
 * never reads as clean.
 */
export function redactDeep<T>(value: T): T {
  return redactNode(value, 0, {
    nodes: REDACT_DEEP_MAX_NODES,
    path: new Set(),
  }) as T;
}

function redactNode(value: unknown, depth: number, walk: DeepWalk): unknown {
  if (walk.nodes <= 0) return TRUNCATED;
  walk.nodes -= 1;
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > REDACT_DEEP_MAX_DEPTH) return REDACTED;
  if (walk.path.has(value)) return "[cycle]";
  walk.path.add(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        out.push(redactNode(readProperty(value, index), depth + 1, walk));
      }
      return out;
    }
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(value)) {
      entries.push([
        redactSecrets(key),
        redactNode(readProperty(value, key), depth + 1, walk),
      ]);
    }
    // Not `out[key] = ...`: a key named `__proto__` would set the prototype.
    return Object.fromEntries(entries);
  } catch {
    // coercion-ok: a proxy whose traps throw is reported as "[unreadable]", a value of its own
    return UNREADABLE;
  } finally {
    walk.path.delete(value);
  }
}

function readProperty(owner: object, key: string | number): unknown {
  try {
    return (owner as Record<string | number, unknown>)[key];
  } catch {
    // coercion-ok: a getter that throws is reported as "[unreadable]", a value of its own
    return UNREADABLE;
  }
}

// Shapes

export type Shape =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "bigint"
  | "symbol"
  | "function"
  | "date"
  | "error"
  | "unreadable"
  | {
      type: "object";
      /** Own enumerable keys in all; `keys` lists the ones inside the budget. */
      keyCount: number;
      keys?: Record<string, Shape>;
    }
  | { type: "array"; length: number; of?: Shape | "mixed" }
  | { type: "map" | "set"; size: number }
  | { type: "bytes"; length: number };

// Shapes this module built. A detail field that is one of them is kept as it
// is; an object that only claims to be one is reduced to its shape like any
// other.
const BUILT_SHAPES = new WeakSet<object>();

function isShape(value: unknown): boolean {
  return typeof value === "object" && value !== null && BUILT_SHAPES.has(value);
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function shapeKey(key: string, taken: ReadonlySet<string>): string {
  const base = scrub(key, SHAPE_KEY_MAX_CHARS) || "[empty]";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}#${suffix}`)) suffix += 1;
  return `${base}#${suffix}`;
}

function shapeOf(
  value: unknown,
  depth: number,
  budget: { keys: number },
): Shape {
  try {
    const kind = typeof value;
    if (
      kind === "string" ||
      kind === "number" ||
      kind === "boolean" ||
      kind === "bigint" ||
      kind === "symbol" ||
      kind === "function" ||
      kind === "undefined"
    ) {
      return kind;
    }
    if (value === null) return "null";
    if (value instanceof Date) return "date";
    if (value instanceof Error) return "error";
    if (value instanceof Map)
      return remember({ type: "map", size: value.size });
    if (value instanceof Set)
      return remember({ type: "set", size: value.size });
    if (ArrayBuffer.isView(value)) {
      return remember({ type: "bytes", length: value.byteLength });
    }
    if (Array.isArray(value)) {
      const shape: { type: "array"; length: number; of?: Shape | "mixed" } = {
        type: "array",
        length: value.length,
      };
      if (depth < SHAPE_MAX_DEPTH && value.length > 0) {
        const first = kindOf(value[0]);
        const sampled = value.slice(0, 4);
        shape.of = sampled.every((entry) => kindOf(entry) === first)
          ? shapeOf(value[0], depth + 1, budget)
          : "mixed";
      }
      return remember(shape);
    }
    const names = Object.keys(value as object);
    const shape: {
      type: "object";
      keyCount: number;
      keys?: Record<string, Shape>;
    } = { type: "object", keyCount: names.length };
    if (depth < SHAPE_MAX_DEPTH) {
      const keys: Record<string, Shape> = {};
      const taken = new Set<string>();
      for (const name of names) {
        if (budget.keys <= 0) break;
        budget.keys -= 1;
        const safe = shapeKey(name, taken);
        taken.add(safe);
        keys[safe] = shapeOfProperty(value as object, name, depth + 1, budget);
      }
      shape.keys = keys;
    }
    return remember(shape);
  } catch {
    // coercion-ok: a getter or proxy that throws is reported as "unreadable", a value of its own
    return "unreadable";
  }
}

function shapeOfProperty(
  owner: object,
  name: string,
  depth: number,
  budget: { keys: number },
): Shape {
  let child: unknown;
  try {
    child = (owner as Record<string, unknown>)[name];
  } catch {
    // coercion-ok: a getter that throws is reported as "unreadable", a value of its own
    return "unreadable";
  }
  return shapeOf(child, depth, budget);
}

function remember<T extends Exclude<Shape, string>>(shape: T): T {
  BUILT_SHAPES.add(shape);
  return shape;
}

/**
 * The structure of a value: key names with type names, array lengths, at most
 * three levels deep and 40 keys in all. Never a value. Key names are scrubbed
 * and clipped too, since a map keyed by token or email still names them.
 */
export function describeShape(value: unknown): Shape {
  return shapeOf(value, 1, { keys: SHAPE_MAX_KEYS });
}

// Details

type DetailValue = string | number | boolean | null | Shape;

interface SanitizedDetails {
  fields: Record<string, DetailValue>;
  /** Fields refused or cut: a name not allowed, a value of a kind not stored, or one that did not fit. */
  droppedFields: number;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// Null means the value is not stored, and the caller counts it. Reading a value
// can throw (a getter on an error's `message`, a proxy), and that must cost
// this one field, never the event it belongs to.
function detailValue(value: unknown): { value: DetailValue } | null {
  try {
    return readDetailValue(value);
  } catch {
    // coercion-ok: a value that throws when read is a field that is dropped and counted in droppedFields
    return null;
  }
}

function readDetailValue(value: unknown): { value: DetailValue } | null {
  switch (typeof value) {
    case "string":
      return { value: scrub(value) };
    case "number":
      return Number.isFinite(value) ? { value } : null;
    case "boolean":
      return { value };
    case "object":
      break;
    default:
      return null;
  }
  if (value === null) return { value: null };
  if (isShape(value)) return { value: value as Shape };
  if (value instanceof Error) {
    return { value: scrub(`${value.name}: ${value.message}`) };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : { value: value.toISOString() };
  }
  return { value: describeShape(value) };
}

/**
 * The allow-list a tripwire's `details` pass through. A field survives with a
 * plain name, a value of a kind that is stored (see `TripwireDetails`), and
 * room in `maxBytes`. When the fields do not fit, the largest go first. The
 * result's `droppedFields` says how many were refused or cut, so a short
 * record is never mistaken for a complete one.
 */
export function sanitizeDetails(
  raw: unknown,
  options: { maxBytes?: number } = {},
): SanitizedDetails {
  const maxBytes = options.maxBytes ?? DETAILS_MAX_BYTES;
  const fields: Record<string, DetailValue> = {};
  let dropped = 0;
  if (raw === undefined || raw === null) return { fields, droppedFields: 0 };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { fields, droppedFields: 1 };
  }

  let names: string[];
  try {
    names = Object.keys(raw);
  } catch {
    // coercion-ok: details whose keys cannot be listed are one refusal, counted in droppedFields
    return { fields, droppedFields: 1 };
  }
  dropped += Math.max(0, names.length - DETAIL_FIELDS_MAX);
  for (const name of names.slice(0, DETAIL_FIELDS_MAX)) {
    // A name that scrubbing would change is not a plain word: it is a token or
    // an email that was used as a key.
    if (
      !DETAIL_NAME.test(name) ||
      RESERVED_DETAIL_NAMES.has(name) ||
      scrub(name, 64) !== name
    ) {
      dropped += 1;
      continue;
    }
    let value: unknown;
    try {
      value = (raw as Record<string, unknown>)[name];
    } catch {
      // coercion-ok: a getter that throws is a field that cannot be read; it is counted in droppedFields
      dropped += 1;
      continue;
    }
    if (
      SENSITIVE_NAME.test(name) &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      dropped += 1;
      continue;
    }
    const kept = detailValue(value);
    if (!kept) {
      dropped += 1;
      continue;
    }
    fields[name] = kept.value;
  }

  // Room is kept for the `droppedFields` marker the result will carry.
  const budget = maxBytes - 24;
  while (byteLength(fields) > budget) {
    const largest = Object.keys(fields)
      .map((name) => ({ name, bytes: byteLength(fields[name]) }))
      .sort((a, b) => b.bytes - a.bytes)[0];
    if (!largest) break;
    delete fields[largest.name];
    dropped += 1;
  }
  return { fields, droppedFields: dropped };
}

/** The text of one property of an error, scrubbed; `[unreadable]` when reading it throws. */
function readErrorText(read: () => unknown, maxChars?: number): string {
  try {
    const value = read();
    if (value === undefined) return "";
    return scrub(typeof value === "string" ? value : String(value), maxChars);
  } catch {
    // coercion-ok: a getter that throws is reported as "[unreadable]", a value of its own
    return UNREADABLE;
  }
}

/**
 * The facts of a caught error, as detail fields: its name, a scrubbed message,
 * its `errorCode` or `code` when it is a short word, and an HTTP status. A
 * property that throws when read is reported as `[unreadable]` (or counted in
 * `errorUnreadable` when it was optional), so a hostile error never costs the
 * event its other fields.
 */
export function errorDetails(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) {
    return {
      errorName: typeof error,
      errorMessage: typeof error === "string" ? scrub(error) : "",
    };
  }
  const carried = error as Error & {
    errorCode?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const out: Record<string, string | number> = {
    errorName: readErrorText(() => error.name, 60),
    errorMessage: readErrorText(() => error.message),
  };
  let unreadable = 0;
  const optional = (read: () => unknown): unknown => {
    try {
      return read();
    } catch {
      // coercion-ok: counted in errorUnreadable, so an absent property and an unreadable one differ
      unreadable += 1;
      return undefined;
    }
  };
  const code = [
    optional(() => carried.errorCode),
    optional(() => carried.code),
  ].find(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      /^[A-Za-z0-9_.:-]{1,60}$/.test(candidate),
  );
  if (code) out.errorCode = scrubId(code, 60);
  const status = [
    optional(() => carried.status),
    optional(() => carried.statusCode),
  ].find(
    (candidate): candidate is number =>
      typeof candidate === "number" && Number.isInteger(candidate),
  );
  if (status !== undefined) out.errorStatus = status;
  if (unreadable > 0) out.errorUnreadable = unreadable;
  return out;
}
