import { SIGNED_LINK_PARAMS } from "./agent-access.js";

export interface RedactSecretsOptions {
  /** Replaces each secret value. A quoted value keeps its quotes. */
  placeholder: string;
  /**
   * Which names mark a value as secret. `contains` redacts any name holding a
   * credential word (`stripe_secret_key`, `apiKeyHeader`). `named` redacts
   * whole credential names and hyphen or underscore compounds, so `mySecret`
   * and cursors such as `nextPageToken` stay readable.
   */
  names?: "contains" | "named";
  /**
   * The text may end partway through a credential, because a provider cut it
   * off or a capture hit its size limit. `"truncated"` also redacts a bare
   * `scheme://authority` at the end.
   */
  tail?: boolean | "truncated";
}

const CREDENTIAL_FRAGMENTS = [
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "apikey",
  "credential",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "accesskey",
  "subscriptionkey",
  "jwt",
  "dsn",
  "databaseurl",
  "databaseuri",
  "dburl",
  "dburi",
  "connectionstring",
  "connectionurl",
  "connectionuri",
  "postgresurl",
  "postgresqlurl",
  "mysqlurl",
  "mongodburl",
  "mongourl",
  "redisurl",
  "amqpurl",
  "mssqlurl",
  ...SIGNED_LINK_PARAMS.map(normalizeName),
];

const NAMED_SECRETS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "xapikey",
  "password",
  "passwd",
  "pass",
  "passphrase",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearer",
  "clientsecret",
  "privatekey",
  "secretkey",
  "signingkey",
  "encryptionkey",
  "accesskey",
  "accesskeyid",
  "secretaccesskey",
  "subscriptionkey",
  "jwt",
  "credential",
  "credentials",
  "sessiontoken",
  "pkey",
  "dsn",
  "databaseurl",
  "connectionstring",
  ...SIGNED_LINK_PARAMS.map(normalizeName),
]);

// Parameters that carry a secret in a URL whatever their text. `code` and
// `state` are the OAuth callback pair; a name ending in or made of a word from
// the list below is one too (`p-key`, `mcp_token`, `x-sig-sso`).
const QUERY_SECRET_NAMES = new Set(["code", "state", "share", "bridge"]);
const QUERY_SECRET_WORDS = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "key",
  "sig",
  "signature",
  "ticket",
  "jwt",
  "credential",
  "session",
  "auth",
]);
const QUERY_SECRET_SUFFIXES = [...QUERY_SECRET_WORDS];
// A cursor is not a credential, and an agent needs it to retry the request.
const CURSOR_TOKEN =
  /^(?:continuation|cursor|delta|idempotency|next|page|prev|previous|resume|skip|sync)+token$/;
const COMPOUND_LAST_WORDS = new Set([
  "secret",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "authorization",
  "cookie",
  "jwt",
  "ticket",
  "sig",
  "signature",
]);
const COMPOUND_KEY_PREFIXES = new Set([
  "api",
  "secret",
  "private",
  "access",
  "signing",
  "encryption",
  "subscription",
]);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Whether an object key or field name marks its value as secret: `contains`
 * for any name holding a credential word, `named` for whole credential names
 * only (`credential_kind` is not one). Only for names of fields: text goes
 * through `redactSecretsInText`.
 */
export function isSecretName(
  name: string,
  options: {
    session?: boolean;
    names?: "contains" | "named" | undefined;
  } = {},
): boolean {
  const normalized = normalizeName(name);
  if (options.names === "named") return isNamedSecret(name, normalized);
  return (
    CREDENTIAL_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
    (options.session === true && normalized.includes("session"))
  );
}

function isQuerySecretName(name: string, normalized: string): boolean {
  return (
    QUERY_SECRET_NAMES.has(normalized) ||
    QUERY_SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    name
      .toLowerCase()
      .split(/[-_.]+/)
      .some((word) => QUERY_SECRET_WORDS.has(word))
  );
}

function isNamedSecret(name: string, normalized: string): boolean {
  if (NAMED_SECRETS.has(normalized)) return true;
  // A hyphenated name that is not a header (`write-secret`) is an action or
  // tool name, whose first error word must stay readable.
  if (!name.includes("_") && !/^x-/i.test(name)) return false;
  const words = name
    .toLowerCase()
    .split(/[-_.\s]+/)
    .filter(Boolean);
  if (words.length < 2) return false;
  const last = words.at(-1) ?? "";
  if (COMPOUND_LAST_WORDS.has(last)) return true;
  if (last === "token") return !CURSOR_TOKEN.test(normalized);
  return last === "key" && COMPOUND_KEY_PREFIXES.has(words.at(-2) ?? "");
}

function isSecretAssignment(
  name: string,
  queryParameter: boolean,
  mode: "contains" | "named",
): boolean {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (mode === "contains") {
    return (
      isSecretName(name, { session: true }) ||
      (queryParameter && isQuerySecretName(name, normalized))
    );
  }
  return (
    isNamedSecret(name, normalized) ||
    (queryParameter &&
      isQuerySecretName(name, normalized) &&
      !CURSOR_TOKEN.test(normalized))
  );
}

// A name run is tried once and, when it is not an assignment, skipped whole by
// the trailing alternative. Letting the engine restart inside the run is
// quadratic on `token_token_...`.
const ASSIGNMENT_RE =
  /(["']?)([A-Za-z0-9_$.-]+)\1[ \t]*([:=])[ \t]*|[A-Za-z0-9_$.-]+/g;
const AUTH_SCHEME_RE = /^(?:bearer|basic|digest|token|negotiate)[ \t]+/i;
const TRAILING_PUNCTUATION = ".,;!?)}]";

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function isQuote(code: number): boolean {
  return code === 34 || code === 39;
}

function isValueEnd(code: number): boolean {
  return (
    isSpace(code) ||
    isQuote(code) ||
    code === 44 ||
    code === 59 ||
    code === 125 ||
    code === 93 ||
    code === 41
  );
}

function isQueryValueEnd(code: number): boolean {
  return (
    isSpace(code) ||
    isQuote(code) ||
    code === 38 ||
    code === 35 ||
    code === 60 ||
    code === 62
  );
}

function isLineValueEnd(code: number): boolean {
  return (
    code === 10 ||
    code === 13 ||
    isQuote(code) ||
    code === 123 ||
    code === 125 ||
    code === 93
  );
}

function isQueryPosition(text: string, nameStart: number): boolean {
  const previous = text.charCodeAt(nameStart - 1);
  return (
    previous === 63 ||
    previous === 38 ||
    previous === 35 ||
    text.startsWith("&amp;", nameStart - 5)
  );
}

function skipWhile(
  text: string,
  from: number,
  stop: (code: number) => boolean,
): number {
  let end = from;
  while (end < text.length && !stop(text.charCodeAt(end))) end += 1;
  return end;
}

function readQuoted(
  text: string,
  start: number,
  placeholder: string,
): { end: number; replacement: string } {
  const quote = text[start];
  let end = start + 1;
  while (end < text.length && text[end] !== quote) {
    end += text[end] === "\\" ? 2 : 1;
  }
  return {
    end: Math.min(end + 1, text.length),
    replacement: `${quote}${placeholder}${quote}`,
  };
}

// A value another sink already redacted keeps that sink's placeholder: text
// passes through several of them, and each would overwrite the last.
const KNOWN_PLACEHOLDERS = ["<redacted>", "[REDACTED]", "[redacted]"];

function redactedValueLength(
  text: string,
  start: number,
  placeholder: string,
): number {
  for (const known of [placeholder, ...KNOWN_PLACEHOLDERS]) {
    for (const [open, close] of [
      ["", ""],
      ['"', '"'],
      ["'", "'"],
      ['["', '"]'],
    ] as const) {
      const wrapped = `${open}${known}${close}`;
      if (text.startsWith(wrapped, start)) return wrapped.length;
    }
  }
  return 0;
}

function readValue(
  text: string,
  start: number,
  placeholder: string,
  query: boolean,
  lineValued: boolean,
): { end: number; replacement: string } | undefined {
  if (start >= text.length) return undefined;
  if (redactedValueLength(text, start, placeholder) > 0) return undefined;
  const first = text.charCodeAt(start);
  if (query) {
    const end = skipWhile(text, start, isQueryValueEnd);
    let trimmed = end;
    while (
      trimmed > start &&
      TRAILING_PUNCTUATION.includes(text.charAt(trimmed - 1))
    ) {
      trimmed -= 1;
    }
    return trimmed > start
      ? { end: trimmed, replacement: placeholder }
      : undefined;
  }
  if (isQuote(first)) return readQuoted(text, start, placeholder);
  if (text[start] === "[") {
    const close = text.indexOf("]", start + 1);
    return {
      end: close === -1 ? text.length : close + 1,
      replacement: `["${placeholder}"]`,
    };
  }
  if (text[start] === "{" || isSpace(first)) return undefined;

  let valueStart = start;
  let lineEnds = lineValued;
  const scheme = AUTH_SCHEME_RE.exec(text.slice(start, start + 16));
  if (scheme) {
    lineEnds = lineEnds || scheme[0].toLowerCase().startsWith("digest");
    valueStart = start + scheme[0].length;
    const redacted = redactedValueLength(text, valueStart, placeholder);
    if (redacted > 0) {
      return {
        end: valueStart + redacted,
        replacement: text.slice(valueStart, valueStart + redacted),
      };
    }
    if (isQuote(text.charCodeAt(valueStart))) {
      const quoted = readQuoted(text, valueStart, placeholder);
      return { end: quoted.end, replacement: placeholder };
    }
  }
  const end = skipWhile(
    text,
    valueStart,
    lineEnds ? isLineValueEnd : isValueEnd,
  );
  return end > valueStart ? { end, replacement: placeholder } : undefined;
}

function isNameCharacter(code: number): boolean {
  return isSchemeCharacter(code) || code === 95 || code === 36;
}

function redactAssignments(
  text: string,
  placeholder: string,
  mode: "contains" | "named",
): string {
  ASSIGNMENT_RE.lastIndex = 0;
  let out = "";
  let copied = 0;
  // End of the value being scanned. A scan restarts inside a value it skipped,
  // so each start reuses this instead of walking the value again.
  let queryValueEnd = -1;
  for (
    let match = ASSIGNMENT_RE.exec(text);
    match;
    match = ASSIGNMENT_RE.exec(text)
  ) {
    const [, quote = "", name = "", separator = ""] = match;
    if (!name) continue;
    const valueStart = ASSIGNMENT_RE.lastIndex;
    let query =
      separator === "=" && isQueryPosition(text, match.index + quote.length);
    let secret = isSecretAssignment(name, query, mode);
    if (
      !secret &&
      !query &&
      separator === "=" &&
      isSecretAssignment(name, true, mode)
    ) {
      // `code=…&state=…` copied out of a URL has no `?` before its first name.
      if (valueStart > queryValueEnd) {
        queryValueEnd = skipWhile(text, valueStart, isQueryValueEnd);
      }
      query =
        text.charCodeAt(queryValueEnd) === 38 &&
        isNameCharacter(text.charCodeAt(queryValueEnd + 1));
      secret = query;
    }
    if (!secret) continue;
    const normalized = normalizeName(name);
    const value = readValue(
      text,
      valueStart,
      placeholder,
      query,
      normalized.endsWith("cookie"),
    );
    if (!value) continue;
    out += text.slice(copied, valueStart) + value.replacement;
    copied = value.end;
    ASSIGNMENT_RE.lastIndex = value.end;
  }
  ASSIGNMENT_RE.lastIndex = 0;
  return copied === 0 ? text : out + text.slice(copied);
}

const PEM_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const WEBHOOK_URL_RE =
  /https?:\/\/(?:hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+|(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+|[A-Za-z0-9.-]+\.webhook\.office\.com\/[^\s"'<>]+|hooks\.zapier\.com\/hooks\/[^\s"'<>]+|maker\.ifttt\.com\/use\/[A-Za-z0-9_-]+)/gi;
const BEARER_RE = /\b(bearer)[ \t]+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_RE = /\b(basic)[ \t]+([A-Za-z0-9+/]{8,}={0,2})/gi;
// A prefix that names a provider, then the key. The eyJ pattern caps its first
// segment: a run of `eyJ-eyJ-...` restarts at every `eyJ` and scans to the end.
const PROVIDER_KEY_RE = new RegExp(
  [
    String.raw`\b(?:AKIA|ASIA)[A-Z0-9]{16,}`,
    String.raw`\bsk-[A-Za-z0-9_-]{8,}`,
    String.raw`\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}`,
    String.raw`\bwhsec_[A-Za-z0-9]{8,}`,
    String.raw`\bAIza[A-Za-z0-9_-]{16,}`,
    String.raw`\bya29\.[A-Za-z0-9_-]{8,}`,
    String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}`,
    String.raw`\bgithub_pat_[A-Za-z0-9_]+`,
    String.raw`\bxox[a-z]{1,2}[-.][A-Za-z0-9_-]+`,
    String.raw`\bxapp-[A-Za-z0-9_-]+`,
    String.raw`\bSG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
    String.raw`\bpat-[A-Za-z0-9_-]+`,
    String.raw`\bnpm_[A-Za-z0-9_-]+`,
    String.raw`\bbpk-[A-Za-z0-9-]{8,}`,
    String.raw`\beyJ[A-Za-z0-9_-]{4,1024}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
  ].join("|"),
  "g",
);

function redactSchemes(text: string, placeholder: string): string {
  return text
    .replace(BEARER_RE, (_match, scheme: string) => `${scheme} ${placeholder}`)
    .replace(BASIC_RE, (match, scheme: string, token: string) =>
      /[0-9+/=]/.test(token) || /[A-Z]/.test(token.slice(1))
        ? `${scheme} ${placeholder}`
        : match,
    );
}

function isSchemeCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 43 ||
    code === 45 ||
    code === 46
  );
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAuthorityEnd(code: number): boolean {
  return code === 47 || code === 63 || code === 35 || isSpace(code);
}

// Found from `://` outward: a regex that starts at every scheme-like run is
// quadratic on `a.a.a.a...`.
function redactUserinfo(text: string, placeholder: string): string {
  let out = "";
  let copied = 0;
  for (
    let found = text.indexOf("://");
    found !== -1;
    found = text.indexOf("://", found + 3)
  ) {
    let scheme = found;
    while (scheme > 0 && isSchemeCharacter(text.charCodeAt(scheme - 1))) {
      scheme -= 1;
    }
    while (scheme < found && !isLetter(text.charCodeAt(scheme))) scheme += 1;
    if (scheme === found) continue;
    const authority = found + 3;
    const end = skipWhile(text, authority, isAuthorityEnd);
    let at = end - 1;
    while (at >= authority && text[at] !== "@") at -= 1;
    if (at < authority) continue;
    out += text.slice(copied, authority) + placeholder;
    copied = at;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

const INCOMPLETE_KEY_RE =
  /^(?:(?:AKIA|ASIA)[A-Z0-9]{0,15}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{0,7}|(?:sk|rk)_[A-Za-z0-9_]{0,12}|AIza[A-Za-z0-9_-]{0,15}|gh[pousr]_[A-Za-z0-9]{0,15}|(?:xox[a-z]{1,2}(?:[-.]|$)|xapp-|SG\.|pat-|github_pat_|npm_)[A-Za-z0-9_.-]*|eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2})$/;
// A numeric tail can be a host port, so only a nonnumeric suffix is userinfo.
const INCOMPLETE_USERINFO_RE = /^[^/:?#\s]+:(?!\d+$)[^/?#@\s]+$/;

function isTailBreak(code: number): boolean {
  return (
    isSpace(code) ||
    isQuote(code) ||
    code === 96 ||
    code === 44 ||
    code === 59 ||
    code === 40 ||
    code === 41 ||
    code === 60 ||
    code === 62 ||
    code === 123 ||
    code === 125 ||
    code === 91 ||
    code === 93 ||
    code === 61
  );
}

function redactTail(
  text: string,
  placeholder: string,
  truncated: boolean,
): string {
  let uriStart = text.length;
  while (uriStart > 0) {
    const code = text.charCodeAt(uriStart - 1);
    if (isSpace(code) || isQuote(code)) break;
    uriStart -= 1;
  }
  const marker = text.lastIndexOf("://");
  if (marker >= uriStart && marker + 3 < text.length) {
    const authority = text.slice(marker + 3);
    if (
      !/[/?#]/.test(authority) &&
      (truncated || INCOMPLETE_USERINFO_RE.test(authority))
    ) {
      return `${text.slice(0, marker + 3)}${placeholder}`;
    }
  }
  let keyStart = text.length;
  while (keyStart > 0 && !isTailBreak(text.charCodeAt(keyStart - 1))) {
    keyStart -= 1;
  }
  return INCOMPLETE_KEY_RE.test(text.slice(keyStart))
    ? `${text.slice(0, keyStart)}${placeholder}`
    : text;
}

/**
 * The one redactor for free text bound for a log, error report, analytics
 * event, audit row, or model: replaces credential values by name
 * (`token=…`, `"apiKey":"…"`, `?code=…`, `Authorization: Bearer …`) and by
 * shape (provider keys, JWTs, PEM blocks, `scheme://user:pass@` userinfo,
 * webhook URLs). Every pass is linear in the text, so a long run of repeated
 * key-like text cannot stall it. Sinks keep a thin wrapper for their own
 * placeholder and structure; URL fields go through `scrubUrl`.
 */
export function redactSecretsInText(
  text: string,
  options: RedactSecretsOptions,
): string {
  const { placeholder, names = "contains", tail = false } = options;
  const replacement = () => placeholder;
  let out = text
    .replace(PEM_PRIVATE_KEY_RE, replacement)
    .replace(WEBHOOK_URL_RE, replacement);
  out = redactAssignments(out, placeholder, names);
  out = redactSchemes(out, placeholder).replace(PROVIDER_KEY_RE, replacement);
  out = redactUserinfo(out, placeholder);
  return tail ? redactTail(out, placeholder, tail === "truncated") : out;
}

const MAX_VALUE_DEPTH = 12;

/**
 * A copy of `value` with every string redacted and every value under a
 * credential-named key replaced. A number or boolean keeps its value under such
 * a key, so `input_tokens: 12` survives. A cycle, or nesting past 12 levels, is
 * replaced too.
 */
export function redactSecretsInValue(
  value: unknown,
  options: RedactSecretsOptions & { redactText?: (text: string) => string },
): unknown {
  const { placeholder, names, redactText } = options;
  const redactString =
    redactText ?? ((text: string) => redactSecretsInText(text, options));
  const walk = (current: unknown, ancestors: object[]): unknown => {
    if (typeof current === "string") return redactString(current);
    if (current === null || typeof current !== "object") return current;
    if (current instanceof Date) return current;
    if (ancestors.length >= MAX_VALUE_DEPTH || ancestors.includes(current)) {
      return placeholder;
    }
    const path = [...ancestors, current];
    if (Array.isArray(current)) return current.map((item) => walk(item, path));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) {
      const keepsValue =
        child === null ||
        child === undefined ||
        typeof child === "number" ||
        typeof child === "boolean" ||
        (typeof child === "string" &&
          redactedValueLength(child, 0, placeholder) === child.length);
      out[key] =
        !keepsValue && isSecretName(key, { names })
          ? placeholder
          : walk(child, path);
    }
    return out;
  };
  return walk(value, []);
}
