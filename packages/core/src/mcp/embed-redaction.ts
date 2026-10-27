import { decodeHTML } from "entities/decode";

/**
 * What MCP results redact before a model or client sees them. The redaction
 * itself runs in `build-server.ts`; an opted-in action's advertised output
 * contract is derived through the same rules (`action-output-contract.ts`),
 * so both read them from here. Server logs that show a thrown value read it
 * through the same string check.
 */

/**
 * Replaces a string carrying an embed start reference, so a reader sees
 * that a value was hidden rather than finding its key missing.
 */
export const HIDDEN_EMBED_URL = "[hidden embed URL]";

/** Replaces a value already being serialized higher up the same result. */
export const CIRCULAR_RESULT = "[circular result]";

/** Keys removed from every result object, whatever their value. */
export const EMBED_RESULT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "agent-native/embedStart",
  "embedStartUrl",
  "embedTargetPath",
  "embedExpiresAt",
  "embedTicket",
]);

/** Keys removed from an object that carries an embed routing signal. */
export function isEmbedCredentialKey(key: string): boolean {
  return key === "ticket" || /Ticket$/.test(key);
}

/**
 * Whether a URL's own path is the embed start route, which redeems a ticket
 * when loaded. It decides when to mint a session, which URL is the open link
 * and which start URL a view is handed, so it must not match a page that only
 * mentions the route. Model-visible output is checked more broadly, by
 * `redactEmbedCredentials` and `modelVisibleToolResponse`.
 */
export function isEmbedStartUrl(value: string): boolean {
  try {
    const base = "http://agent-native.invalid";
    const url = value.startsWith("/") ? new URL(value, base) : new URL(value);
    return url.pathname.includes("/_agent-native/embed/start");
  } catch {
    return value.includes("/_agent-native/embed/start");
  }
}

const REFERENCE_BASE = "http://agent-native.invalid/_agent-native/";
const ORIGIN_BASE = "http://agent-native.invalid/";
// h3 mounts this handler at a path-segment boundary, including child paths.
const EMBED_START_PATH = /^\/_agent-native\/embed\/start(?:[/?#]|$)/;
// Link formatting can turn a short relative reference into this absolute path.
const SHORT_EMBED_START_PATH = /^\/embed\/start(?:\/|$)/;
// Charge all candidate text before parsing it, including overlapping nested
// URLs. Ambiguous inputs beyond this linear budget are unreadable, not safe.
const REFERENCE_READ_FACTOR = 4;
export const MAX_DECODE_ROUNDS = 8;

const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;
// Every JavaScript string escape, which covers every JSON one. A `\u` or `\x`
// without its hex digits is not an escape, and stays for a later layer.
const STRING_ESCAPE =
  /\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|([^ux]))/gi;
const SINGLE_CHARACTER_ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};
const LINE_SEPARATOR = /^[\p{Zl}\p{Zp}]$/u;

/**
 * Removes one layer of escaping. Decoding a percent or HTML escape never takes
 * away a character a path reads, so those go first. Decoding a JavaScript
 * escape can take away a backslash a path reads as a slash, so a JavaScript
 * layer goes only once nothing else is left, after the text has been read
 * with it in place.
 */
function decodeOnce(text: string): string {
  const revealed = decodeHTML(
    text.replace(PERCENT_ESCAPE, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
  );
  if (revealed !== text) return revealed;
  return text.replace(
    STRING_ESCAPE,
    (match, braced, unicode, hex, octal, single: string | undefined) => {
      if (single !== undefined) {
        if (LINE_SEPARATOR.test(single)) return "";
        return SINGLE_CHARACTER_ESCAPES[single] ?? single;
      }
      const code =
        octal !== undefined
          ? Number.parseInt(octal, 8)
          : Number.parseInt(braced ?? unicode ?? hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

// What is left of an escape once decoding stops: an HTML reference or a
// backslash escape that no decoder above reads.
const UNREAD_ESCAPE =
  /&[a-z0-9#]+;|\\(?:u\{[0-9a-f]*\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[0-7]{1,3}|[\s\S])/g;

/**
 * Whole references in prose, JSON or HTML. Relative paths can start a token
 * or an assignment's value, but never restart inside a URL query/fragment.
 * Absolute schemes and network URLs independently identify nested references,
 * even adjacent to prose.
 */
function* references(text: string): Iterable<string> {
  for (const [token] of text.matchAll(/[^\s<>"'`()[\]{}]+/gu)) {
    yield token;
    const queryOrFragment = token.search(/[?#]/);
    const assignment = token.indexOf("=");
    const valueStart =
      assignment >= 0 && (queryOrFragment < 0 || assignment < queryOrFragment)
        ? assignment + 1
        : -1;
    if (valueStart >= 0) {
      yield token.slice(valueStart);
    }
    // A schema diagnostic can put an absolute URL inside a JSON Pointer's
    // path segment. Its scheme starts a reference; a bare path suffix does not.
    for (const urlStart of token.matchAll(/https?:\/*|(?<![:/])\/{2,}[^/]/g)) {
      if (urlStart.index > 0 && urlStart.index !== valueStart) {
        yield token.slice(urlStart.index);
      }
    }
  }
}

/** h3 decodes paths after browser dot resolution, preserving encoded slashes
 * and percent signs. Match that order without turning %2F into a new segment.
 */
function serverPathname(path: string): string {
  try {
    return decodeURIComponent(
      path.replace(/%25/gi, "%2525").replace(/%2f/gi, "%252f"),
    ).toLowerCase();
  } catch {
    // h3's path decoder also keeps a malformed escape as written.
    return path;
  }
}

function isEmbedReference(reference: string): boolean {
  // Only parse path/URL candidates, not the ordinary words between them.
  if (!reference.includes("/") && !/^https?:/.test(reference)) return false;
  const url = URL.parse(reference, REFERENCE_BASE);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return false;
  }
  const relative = !reference.startsWith("/") && !/^https?:/.test(reference);
  const ticket = url.searchParams
    .getAll("ticket")
    .some((value) => value.length > 0);
  // Bare embed/start is also ordinary route discussion. Its short relative
  // spelling is sensitive only when this reference has a nonempty ticket.
  if (relative && !ticket) return false;
  const pathname = serverPathname(url.pathname);
  if (EMBED_START_PATH.test(pathname)) return true;
  if (ticket && SHORT_EMBED_START_PATH.test(pathname)) return true;
  if (relative) {
    const fromOrigin = URL.parse(reference, ORIGIN_BASE);
    if (
      fromOrigin &&
      EMBED_START_PATH.test(serverPathname(fromOrigin.pathname))
    )
      return true;
  }
  // Preserve the conservative protection for a ticket-bearing raw start URL
  // followed by /../, even though a browser resolves it away from the route.
  // This check still respects authority, path, query and filename boundaries.
  if (!ticket) return false;
  const path = (reference.split(/[?#]/)[0] ?? "").replace(
    /^(?:https?:)?\/\/[^/]*/,
    "",
  );
  if (EMBED_START_PATH.test(path) || SHORT_EMBED_START_PATH.test(path))
    return true;
  const relativePath = path.replace(/^(?:\.\/)+/, "");
  return (
    relative &&
    (EMBED_START_PATH.test(`/_agent-native/${relativePath}`) ||
      EMBED_START_PATH.test(`/${relativePath}`))
  );
}

/**
 * Inspect each decoded layer before advancing it: decoding %2F too soon can
 * change which segment a following encoded parent removes. The extra reading
 * retains the existing conservative protection for compatibility forms,
 * invisible format characters and unknown escapes, inside references only.
 */
function scanEmbedReferences(text: string): {
  complete: boolean;
  mentionsRoute: boolean;
} {
  const exact = text.toLowerCase();
  const loose = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(UNREAD_ESCAPE, "")
    .replace(/\p{Cf}/gu, "");
  for (const reading of exact === loose ? [exact] : [exact, loose]) {
    let remaining = reading.length * REFERENCE_READ_FACTOR;
    for (const reference of references(reading.replace(/\\/g, "/"))) {
      if (reference.length > remaining) {
        return { complete: false, mentionsRoute: false };
      }
      remaining -= reference.length;
      if (isEmbedReference(reference)) {
        return { complete: true, mentionsRoute: true };
      }
    }
  }
  return { complete: true, mentionsRoute: false };
}

/** One string as every check below reads it. */
export interface StringReading {
  /**
   * The string and each layer of percent, JavaScript string and HTML escaping
   * under it, to `MAX_DECODE_ROUNDS` layers deep. A URL parser drops tabs and
   * line breaks anywhere in a URL before reading anything else, so no layer
   * holds any.
   */
  layers: string[];
  /**
   * Whether every layer could be inspected within the decoding and reference
   * work limits. Otherwise no check here can say what the string holds.
   */
  complete: boolean;
  /**
   * Whether any layer carries a canonical embed URL/path or a ticket-bearing
   * relative embed reference. Ordinary route discussion and filenames survive.
   */
  mentionsRoute: boolean;
}

export function readString(text: string): StringReading {
  const layers: string[] = [];
  let current = text;
  let complete = true;
  for (let round = 0; ; round += 1) {
    current = current.replace(/[\t\n\r]/g, "");
    layers.push(current);
    const decoded = decodeOnce(current);
    if (decoded === current) break;
    if (round === MAX_DECODE_ROUNDS) {
      complete = false;
      break;
    }
    current = decoded;
  }
  let mentionsRoute = false;
  for (const layer of layers) {
    const scanned = scanEmbedReferences(layer);
    if (!scanned.complete) complete = false;
    if (scanned.mentionsRoute) mentionsRoute = true;
  }
  return { layers, complete, mentionsRoute };
}

/**
 * Text a model sees outside a result, such as an error message or a refusal.
 * The text is the whole output, so one that carries an embed reference or
 * cannot be fully inspected is hidden whole.
 */
export function redactEmbedText(text: string): string {
  const { complete, mentionsRoute } = readString(text);
  return mentionsRoute || !complete ? HIDDEN_EMBED_URL : text;
}

/**
 * A thrown value, or text built from one, as a server log shows it: its name
 * and message, hidden whole as `redactEmbedText` hides text. It is the
 * thrower's data, and reading it may throw too, so one that cannot be read is
 * named only as such.
 */
export function describeThrownForLog(error: unknown): string {
  try {
    return redactEmbedText(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
    );
  } catch {
    return "an error that could not be read";
  }
}
