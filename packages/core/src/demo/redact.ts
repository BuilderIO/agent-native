/**
 * Pure, dependency-free, deterministic demo-mode redactor.
 *
 * Replaces every email with one canonical anonymous address and free numbers
 * with stable fake substitutes. Crucially, it NEVER rewrites identifiers,
 * structural tokens, or timestamps. Names and other free text are deliberately
 * left alone because guessing whether arbitrary text is a person's name is too
 * inaccurate. The string redactor uses a protect-first strategy (mask IDs with
 * opaque placeholders before any transform runs, restore them byte-identical
 * afterwards), and the structure-aware walker additionally protects leaf
 * values by key name.
 */

export interface RedactOptions {
  salt?: string;
  /** Redact numeric values. Defaults to true for backward compatibility. */
  redactNumbers?: boolean;
  /**
   * Redact emails stored in otherwise protected structural fields such as
   * `userId` and `userKey`. Intended for display-only frontend responses.
   */
  redactProtectedEmails?: boolean;
}

/* ------------------------------------------------------------------ *
 * Seeded hash + PRNG (xmur3 seed → mulberry32 stream)
 * ------------------------------------------------------------------ */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic PRNG seeded by `value + salt`. */
function seededRng(value: string, salt: string): () => number {
  const seedFn = xmur3(`${value}${salt}`);
  return mulberry32(seedFn());
}

/* ------------------------------------------------------------------ *
 * Stable mapping cache (bounded, TTL, leak-free)
 *
 * The fake values are already a pure deterministic function of
 * (kind, salt, original), so identical input is always stable. This cache
 * adds two things on top:
 *
 *   1. A consistent forward map so the same original keeps the same fake for
 *      the life of the entry, even if the algorithm/salt is ever tuned.
 *   2. Idempotency: every fake we emit is remembered, so when a fake value
 *      round-trips back through redaction (e.g. you edit a draft that's
 *      already showing fake text, it autosaves, then refetches) it is passed
 *      through UNCHANGED instead of being re-faked into something new. This
 *      is what stops emails drifting on every edit.
 *
 * Leak-free by construction: no timers, a hard size cap, and lazy TTL purge
 * on write. Works the same per-tab in the browser and per-process on the
 * server. Memoizing a pure function across users is safe — output depends
 * only on input.
 * ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 5000;

// original-key → { fake, at }. Insertion-ordered (Map) so the oldest key is
// first — used for cap eviction.
const forwardCache = new Map<string, { value: string; at: number }>();
// produced fake → last-seen timestamp (same bound/TTL policy).
const producedFakes = new Map<string, number>();

function purge(map: Map<string, { at: number } | number>): void {
  const now = Date.now();
  for (const [k, v] of map) {
    const at = typeof v === "number" ? v : v.at;
    if (now - at > CACHE_TTL_MS) map.delete(k);
    else break; // insertion-ordered: first fresh entry ⇒ rest are fresher
  }
  while (map.size > CACHE_MAX) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function rememberProduced(fake: string): string {
  if (fake.length === 0) return fake;
  producedFakes.delete(fake);
  producedFakes.set(fake, Date.now());
  if (producedFakes.size > CACHE_MAX) purge(producedFakes);
  return fake;
}

function isProducedFake(value: string): boolean {
  const at = producedFakes.get(value);
  if (at === undefined) return false;
  if (Date.now() - at > CACHE_TTL_MS) {
    producedFakes.delete(value);
    return false;
  }
  return true;
}

/**
 * Memoize a deterministic fake by (kind, salt, original). On a hit, the
 * entry's recency is refreshed (LRU-ish). The generated value is also
 * registered as a produced fake so it survives a round-trip unchanged.
 */
function memoFake(
  kind: string,
  original: string,
  salt: string,
  gen: () => string,
  // Numbers opt out: a fake number collides with real numbers far too often
  // to safely treat "looks like one we emitted" as "leave it alone".
  idempotent = true,
): string {
  // Already one of our fakes? Leave it exactly as-is (round-trip stable).
  if (idempotent && isProducedFake(original)) return original;

  const key = `${kind}${salt}${original}`;
  const hit = forwardCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at <= CACHE_TTL_MS) {
    forwardCache.delete(key);
    forwardCache.set(key, { value: hit.value, at: now });
    return hit.value;
  }

  const value = gen();
  forwardCache.set(key, { value, at: now });
  if (forwardCache.size > CACHE_MAX) purge(forwardCache);
  if (idempotent) rememberProduced(value);
  return value;
}

/* ------------------------------------------------------------------ *
 * Fake value generators (deterministic in value + salt)
 * ------------------------------------------------------------------ */

export const DEMO_ANONYMOUS_EMAIL = "anonymous@builder.io";

function fakeEmail(original: string, salt: string): string {
  return memoFake(
    "email",
    original.toLowerCase(),
    salt,
    () => DEMO_ANONYMOUS_EMAIL,
  );
}

/**
 * Replace every digit in `numericBody` with a freshly-generated digit while
 * preserving non-digit characters (grouping commas, decimal points) exactly.
 * The first digit is forced non-zero so the digit count is observable.
 */
function fakeNumberBody(
  numericBody: string,
  original: string,
  salt: string,
): string {
  // Stable per original token, but NOT registered as a produced fake — a
  // fake number coincides with real numbers too often to skip on round-trip.
  return memoFake(
    "num",
    original,
    salt,
    () => {
      const rng = seededRng(`num:${original}`, salt);
      let out = "";
      let seenDigit = false;
      for (const ch of numericBody) {
        if (ch >= "0" && ch <= "9") {
          let d: number;
          if (!seenDigit) {
            // Leading digit: 1-9 so length is preserved.
            d = 1 + Math.floor(rng() * 9);
            seenDigit = true;
          } else {
            d = Math.floor(rng() * 10);
          }
          out += String(d);
        } else {
          out += ch;
        }
      }
      return out;
    },
    false,
  );
}

/* ------------------------------------------------------------------ *
 * Protect-first tokenizer (ID-safety core)
 * ------------------------------------------------------------------ */

/**
 * Patterns whose matches must be protected from ANY transform. Order matters:
 * the most structural / specific shapes come first so they win the scan.
 */
const PROTECT_PATTERNS: RegExp[] = [
  // URLs / URIs with a scheme.
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/g,
  /\b(?:mailto|data|tel|urn):[^\s]+/gi,
  // UUID.
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  // JWT — three base64url segments separated by dots.
  /\b[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  // ISO datetime / date.
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g,
  // Bare clock time.
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // Path-like tokens containing a slash (but not bare prose with slashes —
  // require no spaces and at least one slash with adjacent non-space).
  /(?:\S*\/\S+)+/g,
  // nanoid / hex / base64-ish blobs: an unbroken [A-Za-z0-9_-] run that is
  // either long-with-a-digit, mixes letters AND digits at length >= 10, or
  // contains a `_`/`-` inside the run (real names/numbers never look so).
  /[A-Za-z0-9_-]+/g,
];

const PLACEHOLDER_PREFIX = "P";
const PLACEHOLDER_SUFFIX = "";

function makePlaceholder(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
}

/** True if a `[A-Za-z0-9_-]+` run is identifier-shaped (must be protected). */
function looksLikeIdentifierToken(tok: string): boolean {
  if (tok.length < 3) return false;
  const hasLetter = /[A-Za-z]/.test(tok);
  const hasDigit = /[0-9]/.test(tok);
  const hasSep = /[_-]/.test(tok);

  // A pure number (optionally with separators handled elsewhere) is NOT an
  // identifier here — the number rule handles those.
  if (!hasLetter && !hasSep) return false;

  // Long hex/base64-ish blob with a digit.
  if (tok.length >= 16 && hasDigit) return true;
  // nanoid-ish: length >= 10 mixing letters AND digits.
  if (tok.length >= 10 && hasLetter && hasDigit) return true;
  // Any token that has a `_`/`-` joined inside an unbroken run AND also
  // contains a digit or is long — e.g. `order-2024-abc`, `api_key_v2`.
  if (hasSep && (hasDigit || tok.length >= 10)) return true;
  // Mixed letters+digits adjacency (e.g. `abc123`, `v2`, `step3`) — protect so
  // the number rule never bites an embedded number.
  if (hasLetter && hasDigit) return true;

  return false;
}

interface Protection {
  text: string;
  restore: Map<string, string>;
}

/**
 * Walk `text`, replace every protected substring with an opaque placeholder,
 * and return the masked text plus a restore map. Non-overlapping, left-to-right
 * earliest-match-wins so a transform literally cannot see a protected value.
 */
function protect(text: string): Protection {
  const restore = new Map<string, string>();
  let counter = 0;

  // Collect all candidate matches across patterns, then resolve overlaps by
  // earliest start (and longest on tie).
  interface Span {
    start: number;
    end: number;
    value: string;
  }
  const spans: Span[] = [];

  for (let p = 0; p < PROTECT_PATTERNS.length; p++) {
    const re = new RegExp(
      PROTECT_PATTERNS[p].source,
      PROTECT_PATTERNS[p].flags,
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      if (value.length === 0) {
        re.lastIndex++;
        continue;
      }
      const isTokenPattern = p === PROTECT_PATTERNS.length - 1;
      if (isTokenPattern && !looksLikeIdentifierToken(value)) {
        continue;
      }
      spans.push({ start: m.index, end: m.index + value.length, value });
    }
  }

  if (spans.length === 0) return { text, restore };

  spans.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end,
  );

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapped by an earlier protection
    out += text.slice(cursor, span.start);
    const ph = makePlaceholder(counter++);
    restore.set(ph, span.value);
    out += ph;
    cursor = span.end;
  }
  out += text.slice(cursor);

  return { text: out, restore };
}

function unprotect(text: string, restore: Map<string, string>): string {
  if (restore.size === 0) return text;
  let out = text;
  for (const [ph, original] of restore) {
    out = out.split(ph).join(original);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Transforms (run only on protected text)
 * ------------------------------------------------------------------ */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// A standalone numeric token: optional currency + sign, digits with optional
// comma grouping and a single optional decimal part. Bounded so it is NOT
// adjacent to a letter (placeholders already removed letter-mixed tokens, but
// this keeps the rule self-contained and safe on raw structured values too).
const NUMBER_RE =
  /(^|[^A-Za-z0-9_])([$€£]?)([+-]?)(\d[\d,]*(?:\.\d+)?)(?![A-Za-z0-9_])/g;

function transformEmails(text: string, salt: string): string {
  return text.replace(EMAIL_RE, (match) => fakeEmail(match, salt));
}

function isProbablyYear(digits: string): boolean {
  if (digits.length !== 4) return false;
  const n = Number(digits);
  return n >= 1900 && n <= 2099;
}

function transformNumbers(text: string, salt: string): string {
  return text.replace(
    NUMBER_RE,
    (_full, pre: string, currency: string, sign: string, body: string) => {
      const hasGrouping = body.includes(",");
      const hasDecimal = body.includes(".");
      const digitsOnly = body.replace(/[^0-9]/g, "");

      // Skip bare years like 2026.
      if (
        !currency &&
        !sign &&
        !hasGrouping &&
        !hasDecimal &&
        isProbablyYear(digitsOnly)
      ) {
        return `${pre}${currency}${sign}${body}`;
      }

      // Skip standalone integers < 1000 with no currency and no grouping
      // (rewriting "3 unread" / "page 2" looks broken and isn't sensitive).
      if (!currency && !hasGrouping && !hasDecimal) {
        const n = Number(digitsOnly);
        if (Number.isFinite(n) && n < 1000) {
          return `${pre}${currency}${sign}${body}`;
        }
      }

      const fakeBody = fakeNumberBody(body, `${currency}${sign}${body}`, salt);
      return `${pre}${currency}${sign}${fakeBody}`;
    },
  );
}

/* ------------------------------------------------------------------ *
 * Public: string redactor
 * ------------------------------------------------------------------ */

function redactDemoStringInternal(
  text: string,
  salt: string,
  redactNumbers: boolean,
): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!text.includes("@") && (!redactNumbers || !/[\d$€£¥]/.test(text))) {
    return text;
  }

  const { text: masked, restore } = protect(text);
  let out = masked;
  out = transformEmails(out, salt);
  if (redactNumbers) out = transformNumbers(out, salt);
  return unprotect(out, restore);
}

export function redactDemoString(text: string, opts?: RedactOptions): string {
  return redactDemoStringInternal(
    text,
    opts?.salt ?? "",
    opts?.redactNumbers !== false,
  );
}

/* ------------------------------------------------------------------ *
 * Public: structure-aware redactor
 * ------------------------------------------------------------------ */

// Keys whose leaf values must NEVER be transformed (still recurse into nested
// objects/arrays under them). Besides ids/urls/timestamps this also covers
// code/query-bearing keys (`sql`, `query`, `expression`, `formula`, `code`):
// redacting a SQL string mutates literals and can make the query semantically
// wrong or invalid. The query must run untouched; its RESULTS are what get
// redacted so the chart still shows fake values.
const PROTECTED_KEY_RE =
  /^id$|(^|_)id$|Id$|Ids$|uuid|guid|slug|token|secret|password|passwd|apikey|api_key|hash|sha\d*|etag|cursor|nonce|sessionid|messageid|threadid|nodeid|(^|_)key$|keyid|(^|_)ref$|url$|uri$|href$|src$|path$|filename$|mimetype|mime|^sql$|sql$|query|expression|formula|^code$|createdat|updatedat|deletedat|expiresat|timestamp|.+at$|.+_at$/i;

const MAX_DEPTH = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactNumberLeaf(value: number, salt: string): number {
  if (!Number.isFinite(value)) return value;
  const repr = String(value);
  // Re-use the string number transform but only if the representation is a
  // clean numeric token we can round-trip back to a JS number.
  const redacted = transformNumbers(repr, salt);
  if (redacted === repr) return value;
  const n = Number(redacted);
  if (!Number.isFinite(n)) return value;
  return n;
}

function walk(
  value: unknown,
  salt: string,
  depth: number,
  seen: WeakSet<object>,
  redactNumbers: boolean,
  redactProtectedEmails: boolean,
): unknown {
  if (depth > MAX_DEPTH) return value;

  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === "string") {
    return redactDemoStringInternal(value as string, salt, redactNumbers);
  }

  if (t === "number") {
    return redactNumbers ? redactNumberLeaf(value as number, salt) : value;
  }

  if (t === "boolean" || t === "bigint" || t === "function" || t === "symbol") {
    return value;
  }

  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out = value.map((item) =>
      walk(item, salt, depth + 1, seen, redactNumbers, redactProtectedEmails),
    );
    seen.delete(value);
    return out;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const keyIsProtected = PROTECTED_KEY_RE.test(key);
      if (keyIsProtected) {
        if (
          entry !== null &&
          typeof entry === "object" &&
          !(entry instanceof Date)
        ) {
          // Still recurse into nested structures, but the protected key does
          // not transform its own leaf value.
          out[key] = walk(
            entry,
            salt,
            depth + 1,
            seen,
            redactNumbers,
            redactProtectedEmails,
          );
        } else if (
          redactProtectedEmails &&
          typeof entry === "string" &&
          entry.includes("@")
        ) {
          out[key] = redactDemoStringInternal(entry, salt, false);
        } else {
          // Leaf under a protected key: pass through completely untouched.
          out[key] = entry;
        }
        continue;
      }
      out[key] = walk(
        entry,
        salt,
        depth + 1,
        seen,
        redactNumbers,
        redactProtectedEmails,
      );
    }
    seen.delete(value);
    return out;
  }

  // Unknown object kind (Map, Set, class instance, etc.) — leave untouched.
  return value;
}

export function redactDemoData<T>(value: T, opts?: RedactOptions): T {
  const salt = opts?.salt ?? "";
  return walk(
    value,
    salt,
    0,
    new WeakSet<object>(),
    opts?.redactNumbers !== false,
    opts?.redactProtectedEmails === true,
  ) as T;
}

/**
 * Clear the stable-mapping caches. Test-only — the caches are process-global
 * (intentionally, so mappings stay stable for a tab's session), which would
 * otherwise let one test's produced fakes leak into another's assertions.
 */
export function __resetDemoRedactCacheForTests(): void {
  forwardCache.clear();
  producedFakes.clear();
}
