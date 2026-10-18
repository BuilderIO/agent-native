import { decodeHTML } from "entities/decode";

/**
 * What MCP results redact before a model or client sees them. The redaction
 * itself runs in `build-server.ts`; an opted-in action's advertised output
 * contract is derived through the same rules (`action-output-contract.ts`),
 * so both read them from here. Server logs that show a thrown value read it
 * through the same string check.
 */

/** Replaces an embed start URL that cannot simply be dropped (an array item). */
export const HIDDEN_EMBED_URL = "[hidden embed URL]";

/** Replaces a value already being serialized higher up the same result. */
export const CIRCULAR_RESULT = "[circular result]";

/** Keys removed from every result object, whatever their value. */
export const EMBED_RESULT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
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

/** The embed start route's last two segments, letters only. */
const EMBED_START_LETTERS = "embedstart";
const MAX_DECODE_ROUNDS = 8;

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
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;
const DOT_SEGMENT = /^(?:\.|%2e)$/i;
const DOUBLE_DOT_SEGMENT = /^(?:\.|%2e){2}$/i;

/** The path a browser resolves from each run of `text` up to a `?` or `#`. */
function resolvedPaths(text: string): string {
  return text
    .split(/[?#]/)
    .map((run) => {
      const resolved: string[] = [];
      for (const segment of run.replace(/\\/g, "/").split("/")) {
        if (DOUBLE_DOT_SEGMENT.test(segment)) resolved.pop();
        else if (!DOT_SEGMENT.test(segment)) resolved.push(segment);
      }
      return resolved.join("/");
    })
    .join("?");
}

/**
 * The letters and digits of `text`, as written and with its paths resolved,
 * each read two ways. The exact reading only folds case, so its paths resolve
 * as a browser's do. The loose reading also folds compatibility forms such as
 * full-width letters and drops every escape still in the text, so an escape
 * nothing here decodes cannot keep the letters on either side of it apart.
 */
function readings(text: string): string[] {
  const exact = text.toLowerCase();
  const loose = text.normalize("NFKC").toLowerCase().replace(UNREAD_ESCAPE, "");
  return (loose === exact ? [exact] : [exact, loose])
    .flatMap((variant) =>
      // Resolving changes a path's letters only through `..` or `%2e`.
      /\.\.|%2e/.test(variant) ? [variant, resolvedPaths(variant)] : [variant],
    )
    .map((reading) => reading.replace(NOT_LETTER_OR_DIGIT, ""));
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
   * Whether the last layer has no escaping left to decode. A string escaped
   * more deeply than `MAX_DECODE_ROUNDS` is not, so no check here can say
   * what it holds.
   */
  complete: boolean;
  /**
   * Whether `embed/start` can be read in any layer. It is loose on purpose.
   * Any string whose letters run `embedstart` counts, prose about an embed
   * start included, because a missed credential costs more than a hidden
   * sentence.
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
  return {
    layers,
    complete,
    mentionsRoute: layers.some((layer) =>
      readings(layer).some((reading) => reading.includes(EMBED_START_LETTERS)),
    ),
  };
}

/**
 * Text a model sees outside a result, such as an error message or a refusal.
 * The text is the whole output, so one that mentions the start route or is
 * escaped past `MAX_DECODE_ROUNDS` is hidden whole.
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
