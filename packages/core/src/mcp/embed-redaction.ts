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
const REFERENCE_READ_FACTOR = 6;
const URL_REFERENCE_START = /https?:\/*|(?<![:/])\/{2,}[^/]/g;
// Neither ? nor _ occurs in image bytes: they cannot carry a ticket-bearing
// short reference or the canonical framework route.
export const IMAGE_BYTES =
  /^(?:data:image\/[a-z0-9.+-]+;base64,)?[A-Za-z0-9+/=\s]*$/i;
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

interface EmbedReference {
  text: string;
  allowRelative: boolean;
  attachedTicket?: boolean;
}

/**
 * Inspect each query value only through the next field boundary. A nested
 * reference's query can carry a ticket; retain that fact without copying the
 * remaining query into every candidate. Fragments do not extend this scope.
 */
function* queryReferences(text: string): Iterable<EmbedReference> {
  const fragment = text.indexOf("#");
  const end = fragment < 0 ? text.length : fragment;
  const query = text.indexOf("?");
  if (query < 0 || query >= end) return;
  const parameters = text.slice(query, end);
  if (!parameters.includes("/")) return;
  const fields = [...parameters.matchAll(/[?&][^?&#=]*=/g)];
  const values = fields.map((field, index) => {
    const start = field.index + field[0].length;
    const value = parameters.slice(
      start,
      fields[index + 1]?.index ?? parameters.length,
    );
    const name = field[0].slice(1, -1);
    const ticketKey =
      name === "ticket" ||
      (name.includes("%") && new URLSearchParams(`${name}=x`).has("ticket"));
    return {
      value,
      question: field[0].startsWith("?"),
      ticket: ticketKey && value.length > 0,
      ampTicketFromHere: false,
    };
  });
  let ampTicket = false;
  for (const field of values.slice().reverse()) {
    if (!field.question && field.ticket) ampTicket = true;
    field.ampTicketFromHere = ampTicket;
  }
  for (const [index, field] of values.entries()) {
    if (!field.value.includes("/")) continue;
    const next = values.at(index + 1);
    const hasQuery = field.value.includes("?");
    const firstQuery = !hasQuery && next?.question === true;
    yield {
      text: field.value,
      allowRelative: true,
      attachedTicket:
        (hasQuery || firstQuery) &&
        ((firstQuery && next.ticket) || next?.ampTicketFromHere === true),
    };
  }
}

function* references(text: string): Iterable<EmbedReference> {
  if (IMAGE_BYTES.test(text)) return;
  const seen = new Set<string>();
  function* emit(
    value: string,
    allowRelative = true,
    attachedTicket = false,
  ): Iterable<EmbedReference> {
    const key = `${allowRelative ? 1 : 0}:${attachedTicket ? 1 : 0}:${value}`;
    if (!value || seen.has(key) || (!attachedTicket && IMAGE_BYTES.test(value)))
      return;
    seen.add(key);
    yield { text: value, allowRelative, attachedTicket };
  }
  // Inspect the whole spelling first, before lexical boundaries divide lists
  // or line breaks. URL parsing itself removes controls inside a real URL.
  yield* emit(text);
  const firstUrl = text.search(URL_REFERENCE_START);
  if (firstUrl > 0) yield* emit(text.slice(firstUrl));
  for (const [token] of text.matchAll(/[^\s<>"'`()[\]{}]+/gu)) {
    if (IMAGE_BYTES.test(token)) continue;
    yield* emit(token);
    // Query paths may contain commas. Inspect their bounded values before
    // treating commas as list separators.
    for (const nested of queryReferences(token)) {
      yield* emit(nested.text, nested.allowRelative, nested.attachedTicket);
    }
    const fragment = token.indexOf("#");
    // List members have independent bounds, rather than repeatedly parsing
    // the entire remaining list after every scheme.
    for (const part of token.matchAll(/[^,;]+/g)) {
      const value = part[0];
      if (IMAGE_BYTES.test(value)) continue;
      const absolute = /^(?:https?:|\/\/)/.test(value);
      const allowRelative = absolute || fragment < 0 || part.index <= fragment;
      yield* emit(value, allowRelative);
      if (allowRelative) {
        const boundary = value.search(/[?#]/);
        const assignment = value.indexOf("=");
        const urlStart = value.search(URL_REFERENCE_START);
        if (
          !absolute &&
          assignment >= 0 &&
          (urlStart < 0 || assignment < urlStart) &&
          (boundary < 0 || assignment < boundary)
        ) {
          yield* emit(value.slice(assignment + 1));
        }
        for (const nested of queryReferences(value)) {
          yield* emit(nested.text, nested.allowRelative, nested.attachedTicket);
        }
      }
      for (const urlStart of value.matchAll(URL_REFERENCE_START)) {
        if (urlStart.index === 0) continue;
        const nested = value.slice(urlStart.index);
        yield* emit(nested);
        for (const path of queryReferences(nested)) {
          yield* emit(path.text, path.allowRelative, path.attachedTicket);
        }
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

function isEmbedReference(
  reference: string,
  allowRelative: boolean,
  attachedTicket = false,
): boolean {
  if (!allowRelative && !/^(?:https?:|\/\/)/.test(reference)) return false;
  // Only parse path/URL candidates, not the ordinary words between them.
  if (!reference.includes("/") && !/^https?:/.test(reference)) return false;
  const url = URL.parse(reference, REFERENCE_BASE);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return false;
  }
  const relative = !reference.startsWith("/") && !/^https?:/.test(reference);
  const ticket =
    attachedTicket ||
    url.searchParams.getAll("ticket").some((value) => value.length > 0);
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
  for (const variant of exact === loose ? [exact] : [exact, loose]) {
    // Keep a new URL on its own line separate while retaining a browser's
    // control folding inside a URL (including an escaped/obfuscated scheme).
    const followingUrl = /[^\s<>"'`()[\]{},;]*https?:/y;
    const folded = variant.replace(
      /[\t\n\r]+/g,
      (controls: string, offset: number) => {
        // Consume each control run once. A lookahead on the quantified run
        // would backtrack quadratically through a long series of blank lines.
        followingUrl.lastIndex = offset + controls.length;
        return followingUrl.test(variant) ? " " : "";
      },
    );
    for (const reading of variant === folded ? [variant] : [variant, folded]) {
      let remaining = reading.length * REFERENCE_READ_FACTOR;
      for (const reference of references(reading.replace(/\\/g, "/"))) {
        if (reference.text.length > remaining) {
          return { complete: false, mentionsRoute: false };
        }
        remaining -= reference.text.length;
        if (
          isEmbedReference(
            reference.text,
            reference.allowRelative,
            reference.attachedTicket,
          )
        ) {
          return { complete: true, mentionsRoute: true };
        }
      }
    }
  }
  return { complete: true, mentionsRoute: false };
}

/** One string as every check below reads it. */
export interface StringReading {
  /**
   * The string and each layer of percent, JavaScript string and HTML escaping
   * under it, to `MAX_DECODE_ROUNDS` layers deep. Each layer also contributes
   * its control-free spelling for ticket discovery and echo matching.
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
  const scanLayers: string[] = [];
  let current = text;
  let complete = true;
  for (let round = 0; ; round += 1) {
    layers.push(current);
    scanLayers.push(current);
    const controlFree = current.replace(/[\t\n\r]/g, "");
    if (controlFree !== current) layers.push(controlFree);
    const decoded = decodeOnce(current);
    if (decoded === current) break;
    if (round === MAX_DECODE_ROUNDS) {
      complete = false;
      break;
    }
    current = decoded;
  }
  let mentionsRoute = false;
  for (const layer of scanLayers) {
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
