/**
 * Turns a pasted `curl ...` command into the fields of the read-only API
 * request step. Nothing is executed or expanded, and no credential value
 * survives: a dropped credential is reported by its name or flag, never its
 * value, so every field and issue here is safe to store and display.
 */

export interface CurlImportProvider {
  id: string;
  baseUrl: string;
}

export type CurlImportIssueCode =
  | "method_not_get"
  | "body_ignored"
  | "credential_dropped"
  | "header_dropped"
  | "flag_ignored";

export interface CurlImportIssue {
  code: CurlImportIssueCode;
  detail?: string;
}

export type CurlImportResult =
  | {
      ok: true;
      provider: string;
      path: string;
      query: Record<string, string | string[]>;
      headers: Record<string, string>;
      issues: CurlImportIssue[];
    }
  | {
      ok: false;
      reason:
        | "not_curl"
        | "no_url"
        | "invalid_url"
        | "not_https"
        | "unknown_host"
        | "unterminated_quote"
        | "method_not_get";
      issues: CurlImportIssue[];
    };

type Failure = Extract<CurlImportResult, { ok: false }>;
type QueryEntry = [string, string];

/** One shell word. `expands` marks `$name`, `${`, `$(` or a backtick outside single quotes. */
interface Word {
  text: string;
  expands: boolean;
}

type Tokenized = { ok: true; words: Word[] } | { ok: false };

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const EXPANSION_START = /[A-Za-z0-9_{(@*#?!$-]/;
const WORD_BREAK = /[\s&|;<>]/;

const ANSI_C_ESCAPES = new Map([
  ["a", "\x07"],
  ["b", "\b"],
  ["e", "\x1b"],
  ["E", "\x1b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
  ["\\", "\\"],
  ["'", "'"],
  ['"', '"'],
  ["?", "?"],
]);

function readDoubleQuoted(
  input: string,
  start: number,
): { text: string; expands: boolean; end: number } | null {
  let text = "";
  let expands = false;
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '"') return { text, expands, end: i + 1 };
    if (ch === "\\") {
      const next = input.charAt(i + 1);
      if (next === "\n") {
        i += 2;
        continue;
      }
      if (next === "\r" && input.charAt(i + 2) === "\n") {
        i += 3;
        continue;
      }
      if (next === '"' || next === "\\" || next === "$" || next === "`") {
        text += next;
        i += 2;
        continue;
      }
    } else if (
      ch === "`" ||
      (ch === "$" && EXPANSION_START.test(input.charAt(i + 1)))
    ) {
      expands = true;
    }
    text += ch;
    i++;
  }
  return null;
}

function readAnsiC(
  input: string,
  start: number,
): { text: string; end: number } | null {
  let text = "";
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === "'") return { text, end: i + 1 };
    if (ch !== "\\") {
      text += ch;
      i++;
      continue;
    }
    const next = input.charAt(i + 1);
    if (next === "") return null;
    const simple = ANSI_C_ESCAPES.get(next);
    if (simple !== undefined) {
      text += simple;
      i += 2;
      continue;
    }
    const numeric =
      /^(?:x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3})/.exec(
        input.slice(i + 1, i + 10),
      );
    if (numeric) {
      const digits = numeric[0];
      const code = /^[0-7]/.test(digits)
        ? parseInt(digits, 8)
        : parseInt(digits.slice(1), 16);
      if (code <= 0x10ffff) {
        text += String.fromCodePoint(code);
        i += 1 + digits.length;
        continue;
      }
    }
    text += `\\${next}`;
    i += 2;
  }
  return null;
}

/**
 * Splits one shell command into words. Stops at the first `|`, `;` or `&&`
 * so a trailing `| jq .` is not read as arguments, and skips redirections.
 * A lone `&` inside a word stays literal because it is a URL's query joiner
 * far more often than a background operator.
 */
function tokenize(input: string): Tokenized {
  const words: Word[] = [];
  const word = {
    text: "",
    expands: false,
    started: false,
    redirectTarget: false,
  };

  const endWord = () => {
    if (word.started && word.redirectTarget) word.redirectTarget = false;
    else if (word.started) {
      words.push({ text: word.text, expands: word.expands });
    }
    word.text = "";
    word.expands = false;
    word.started = false;
  };
  const append = (chunk: string) => {
    word.text += chunk;
    word.started = true;
  };

  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    const next = input.charAt(i + 1);
    if (WHITESPACE.has(ch)) {
      endWord();
      i++;
    } else if (ch === "\\") {
      if (next === "\n") i += 2;
      else if (next === "\r" && input.charAt(i + 2) === "\n") i += 3;
      else if (next === "") i++;
      else {
        append(next);
        i += 2;
      }
    } else if (ch === "'") {
      const close = input.indexOf("'", i + 1);
      if (close === -1) return { ok: false };
      append(input.slice(i + 1, close));
      i = close + 1;
    } else if (ch === '"') {
      const quoted = readDoubleQuoted(input, i + 1);
      if (!quoted) return { ok: false };
      append(quoted.text);
      word.expands ||= quoted.expands;
      i = quoted.end;
    } else if (ch === "$" && next === "'") {
      const quoted = readAnsiC(input, i + 2);
      if (!quoted) return { ok: false };
      append(quoted.text);
      i = quoted.end;
    } else if (ch === "$" || ch === "`") {
      if (ch === "`" || EXPANSION_START.test(next)) word.expands = true;
      append(ch);
      i++;
    } else if (ch === "#" && !word.started) {
      const lineEnd = input.indexOf("\n", i);
      i = lineEnd === -1 ? input.length : lineEnd;
    } else if (ch === "|" || ch === ";") {
      break;
    } else if (ch === "&") {
      if (!word.started || next === "" || WORD_BREAK.test(next)) break;
      append(ch);
      i++;
    } else if (ch === ">" || ch === "<") {
      if (word.started && /^\d+$/.test(word.text)) {
        word.text = "";
        word.started = false;
      } else {
        endWord();
      }
      while (input.charAt(i) === ">" || input.charAt(i) === "<") i++;
      if (input.charAt(i) === "&") i++;
      word.redirectTarget = true;
    } else {
      append(ch);
      i++;
    }
  }
  endWord();
  return { ok: true, words };
}

/** Flags whose next word (or `=` suffix) is a value that must not be read as the URL. */
const LONG_VALUE_FLAGS = new Set([
  "abstract-unix-socket",
  "alt-svc",
  "aws-sigv4",
  "cacert",
  "capath",
  "cert",
  "cert-type",
  "ciphers",
  "config",
  "connect-timeout",
  "connect-to",
  "continue-at",
  "cookie",
  "cookie-jar",
  "data",
  "data-ascii",
  "data-binary",
  "data-raw",
  "data-urlencode",
  "dns-servers",
  "dump-header",
  "etag-compare",
  "etag-save",
  "expect100-timeout",
  "form",
  "form-string",
  "ftp-port",
  "header",
  "hsts",
  "interface",
  "json",
  "key",
  "key-type",
  "limit-rate",
  "local-port",
  "max-filesize",
  "max-redirs",
  "max-time",
  "noproxy",
  "oauth2-bearer",
  "output",
  "pass",
  "proxy",
  "proxy-cacert",
  "proxy-cert",
  "proxy-header",
  "proxy-key",
  "proxy-user",
  "quote",
  "range",
  "referer",
  "request",
  "request-target",
  "resolve",
  "retry",
  "retry-delay",
  "retry-max-time",
  "speed-limit",
  "speed-time",
  "stderr",
  "telnet-option",
  "time-cond",
  "tlspassword",
  "tlsuser",
  "trace",
  "trace-ascii",
  "unix-socket",
  "upload-file",
  "url",
  "user",
  "user-agent",
  "variable",
  "write-out",
]);

const SHORT_VALUE_FLAGS = new Map([
  ["A", "user-agent"],
  ["C", "continue-at"],
  ["D", "dump-header"],
  ["E", "cert"],
  ["F", "form"],
  ["H", "header"],
  ["K", "config"],
  ["P", "ftp-port"],
  ["Q", "quote"],
  ["T", "upload-file"],
  ["U", "proxy-user"],
  ["X", "request"],
  ["Y", "speed-limit"],
  ["b", "cookie"],
  ["c", "cookie-jar"],
  ["d", "data"],
  ["e", "referer"],
  ["m", "max-time"],
  ["o", "output"],
  ["r", "range"],
  ["t", "telnet-option"],
  ["u", "user"],
  ["w", "write-out"],
  ["x", "proxy"],
  ["y", "speed-time"],
  ["z", "time-cond"],
]);

const SHORT_SWITCHES = new Map([
  ["G", "get"],
  ["I", "head"],
  [":", "next"],
]);

const CREDENTIAL_FLAGS = new Set([
  "user",
  "proxy-user",
  "cookie",
  "oauth2-bearer",
  "aws-sigv4",
  "pass",
  "tlspassword",
]);

/** curl turns every one of these into a request with a body even without `-X`. */
const BODY_FLAGS = new Set(["form", "form-string", "upload-file", "json"]);

const DATA_FLAGS = new Set([
  "data",
  "data-ascii",
  "data-binary",
  "data-raw",
  "data-urlencode",
]);

const CURL_PROGRAMS = new Set(["curl", "curl.exe"]);

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const CREDENTIAL_HEADER_NAME =
  /token|secret|passw(?:or)?d|api[-_]?key|x-api|auth|cookie/i;
const CREDENTIAL_QUERY_NAME =
  /token|secret|passw(?:or)?d|api[-_]?key|access[-_]?key|private[-_]?key|x[-_]api|credential|signature|^(?:auth|authorization|key|sig|bearer|jwt)$/i;
/** Whether a query parameter's name says it carries a credential, so it is never kept in a step. */
export function isCredentialQueryName(name: string): boolean {
  return CREDENTIAL_QUERY_NAME.test(name);
}
const AUTH_SCHEME_VALUE = /^(?:bearer|basic|digest)\s+\S/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HEADER_VALUE_CONTROLS = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const TRANSPORT_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "accept-encoding",
  "expect",
  "upgrade",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
]);

/** An index read that is `T | undefined` under every tsconfig, not only the strict one. */
function at<T>(items: readonly T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

type Note = (code: CurlImportIssueCode, detail?: string) => void;

function issueCollector(): { issues: CurlImportIssue[]; note: Note } {
  const issues: CurlImportIssue[] = [];
  const seen = new Set<string>();
  const note: Note = (code, detail) => {
    const key = `${code}\u0000${detail ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(detail === undefined ? { code } : { code, detail });
  };
  return { issues, note };
}

interface DataPiece {
  flag: string;
  urlencode: boolean;
  value: string;
}

interface Scan {
  method: { flag: string; value: string } | null;
  getFlag: boolean;
  headFlag: string | null;
  bodyFlags: string[];
  dataPieces: DataPiece[];
  urlFlag: Word | null;
  positional: Word[];
  headers: Map<string, { name: string; value: string }>;
}

function addHeader(scan: Scan, raw: string, note: Note) {
  const colon = raw.indexOf(":");
  const name = colon === -1 ? "" : raw.slice(0, colon).trim();
  if (!HEADER_NAME.test(name)) {
    note("flag_ignored", "header");
    return;
  }
  const key = name.toLowerCase();
  const value = raw.slice(colon + 1).trim();
  if (CREDENTIAL_HEADER_NAME.test(key)) {
    note("credential_dropped", name);
  } else if (TRANSPORT_HEADERS.has(key)) {
    note("header_dropped", name);
  } else if (value === "" || HEADER_VALUE_CONTROLS.test(value)) {
    note("flag_ignored", "header");
  } else if (AUTH_SCHEME_VALUE.test(value)) {
    note("credential_dropped", name);
  } else {
    scan.headers.delete(key);
    scan.headers.set(key, { name, value });
  }
}

/** Reads every flag; values are consumed here so none is mistaken for the URL. */
function scanArguments(args: Word[], note: Note): Scan {
  const scan: Scan = {
    method: null,
    getFlag: false,
    headFlag: null,
    bodyFlags: [],
    dataPieces: [],
    urlFlag: null,
    positional: [],
    headers: new Map(),
  };

  /** Returns true when the command moves on to a second request. */
  const apply = (name: string, flag: string, value: Word | undefined) => {
    if (name === "next") {
      note("flag_ignored", flag);
      return true;
    }
    if (LONG_VALUE_FLAGS.has(name) && value === undefined) {
      note("flag_ignored", flag);
      return false;
    }
    const text = value === undefined ? "" : value.text;
    if (name === "header") addHeader(scan, text, note);
    else if (name === "request") scan.method = { flag, value: text };
    else if (name === "get") scan.getFlag = true;
    else if (name === "head") scan.headFlag ??= flag;
    else if (name === "url") scan.urlFlag ??= value ?? null;
    else if (DATA_FLAGS.has(name)) {
      scan.dataPieces.push({
        flag,
        urlencode: name === "data-urlencode",
        value: text,
      });
    } else if (BODY_FLAGS.has(name)) scan.bodyFlags.push(flag);
    else if (CREDENTIAL_FLAGS.has(name)) note("credential_dropped", flag);
    else note("flag_ignored", flag);
    return false;
  };

  let optionsEnded = false;
  let done = false;
  for (let i = 0; i < args.length && !done; i++) {
    const word = at(args, i);
    if (word === undefined) break;
    const text = word.text;
    if (optionsEnded || !text.startsWith("-") || text === "-") {
      scan.positional.push(word);
    } else if (text === "--") {
      optionsEnded = true;
    } else if (text.startsWith("--")) {
      const equals = text.indexOf("=");
      const name = equals === -1 ? text.slice(2) : text.slice(2, equals);
      let value: Word | undefined =
        equals === -1
          ? undefined
          : { text: text.slice(equals + 1), expands: word.expands };
      if (equals === -1 && LONG_VALUE_FLAGS.has(name)) {
        value = at(args, i + 1);
        i++;
      }
      done = apply(name, `--${name}`, value);
    } else {
      for (let j = 1; j < text.length && !done; j++) {
        const ch = text.charAt(j);
        const valueFlag = SHORT_VALUE_FLAGS.get(ch);
        if (valueFlag === undefined) {
          done = apply(SHORT_SWITCHES.get(ch) ?? "", `-${ch}`, undefined);
          continue;
        }
        const attached = text.slice(j + 1);
        let value: Word | undefined;
        if (attached !== "") {
          value = { text: attached, expands: word.expands };
        } else {
          value = at(args, i + 1);
          i++;
        }
        done = apply(valueFlag, `-${ch}`, value);
        break;
      }
    }
  }
  return scan;
}

function parseUrl(text: string): URL | null {
  return URL.canParse(text) ? new URL(text) : null;
}

/** `+` and `%XX` decode the way a query string does, without splitting on `&` or `=`. */
function decodeFormComponent(text: string): string {
  const escaped = text.replace(/[&=]/g, encodeURIComponent);
  for (const [key] of new URLSearchParams(`${escaped}=`)) return key;
  return text;
}

/** What `-G` turns one `-d` or `--data-urlencode` argument into: query parameters. */
function dataEntries(piece: DataPiece, note: Note): QueryEntry[] {
  const { value, flag } = piece;
  if (piece.urlencode) {
    const at = value.indexOf("@");
    const equals = value.indexOf("=");
    if (equals > 0 && (at === -1 || equals < at)) {
      return [
        [decodeFormComponent(value.slice(0, equals)), value.slice(equals + 1)],
      ];
    }
    note("body_ignored", flag);
    return [];
  }
  if (value.startsWith("@")) {
    note("body_ignored", flag);
    return [];
  }
  const entries: QueryEntry[] = [];
  for (const part of value.split("&")) {
    if (part === "") continue;
    if (part.indexOf("=") <= 0) note("body_ignored", flag);
    else entries.push(...new URLSearchParams(part));
  }
  return entries;
}

function matchProvider(
  url: URL,
  providers: readonly CurlImportProvider[],
): { id: string; path: string } | null {
  let best: { id: string; prefixLength: number; path: string } | null = null;
  for (const provider of providers) {
    const base = parseUrl(provider.baseUrl);
    if (!base || base.host !== url.host) continue;
    const prefix = base.pathname.replace(/\/+$/, "");
    if (
      prefix !== "" &&
      url.pathname !== prefix &&
      !url.pathname.startsWith(`${prefix}/`)
    ) {
      continue;
    }
    if (best && best.prefixLength >= prefix.length) continue;
    best = {
      id: provider.id,
      prefixLength: prefix.length,
      path: url.pathname.slice(prefix.length).replace(/^\/+/, ""),
    };
  }
  return best && { id: best.id, path: best.path };
}

function groupQuery(entries: QueryEntry[]): Record<string, string | string[]> {
  const grouped = new Map<string, string | string[]>();
  for (const [name, value] of entries) {
    const existing = grouped.get(name);
    if (existing === undefined) grouped.set(name, value);
    else if (typeof existing === "string") grouped.set(name, [existing, value]);
    else existing.push(value);
  }
  return Object.fromEntries(grouped);
}

export function parseCurlImport(
  command: string,
  providers: readonly CurlImportProvider[],
): CurlImportResult {
  const { issues, note } = issueCollector();
  const fail = (reason: Failure["reason"]): Failure => ({
    ok: false,
    reason,
    issues,
  });

  const tokenized = tokenize(command);
  if (!tokenized.ok) return fail("unterminated_quote");
  const prompt = at(tokenized.words, 0);
  const words =
    prompt !== undefined && prompt.text === "$"
      ? tokenized.words.slice(1)
      : tokenized.words;
  const program = at(words, 0);
  if (program === undefined || !CURL_PROGRAMS.has(program.text.toLowerCase())) {
    return fail("not_curl");
  }

  const scan = scanArguments(words.slice(1), note);
  const urlWord = scan.urlFlag ?? at(scan.positional, 0);
  if (urlWord === undefined) return fail("no_url");
  if (scan.positional.length > (scan.urlFlag === null ? 1 : 0)) {
    note("flag_ignored", "extra-url");
  }

  const url =
    urlWord.expands || CONTROL_CHARACTERS.test(urlWord.text)
      ? null
      : parseUrl(urlWord.text);
  if (!url) return fail("invalid_url");
  if (url.protocol === "http:") return fail("not_https");
  if (url.protocol !== "https:") return fail("invalid_url");
  if (url.username !== "" || url.password !== "") {
    note("credential_dropped", "url-userinfo");
  }

  const explicitGet =
    scan.method !== null && scan.method.value.toUpperCase() === "GET";
  const dataPiece = scan.getFlag ? undefined : at(scan.dataPieces, 0);
  const bodyFlag =
    at(scan.bodyFlags, 0) ??
    (dataPiece === undefined ? undefined : dataPiece.flag);
  let nonGetFlag: string | null = null;
  if (scan.method !== null && !explicitGet) nonGetFlag = scan.method.flag;
  else if (scan.headFlag !== null) nonGetFlag = scan.headFlag;
  else if (bodyFlag !== undefined && !explicitGet) nonGetFlag = bodyFlag;
  if (nonGetFlag !== null) {
    note("method_not_get", nonGetFlag);
    return fail("method_not_get");
  }

  const match = matchProvider(url, providers);
  if (!match) return fail("unknown_host");

  const entries: QueryEntry[] = [...url.searchParams];
  if (scan.getFlag) {
    for (const piece of scan.dataPieces) {
      entries.push(...dataEntries(piece, note));
    }
  } else {
    for (const piece of scan.dataPieces) note("body_ignored", piece.flag);
  }
  for (const flag of scan.bodyFlags) note("body_ignored", flag);

  const query = groupQuery(
    entries.filter(([name]) => {
      if (!CREDENTIAL_QUERY_NAME.test(name)) return true;
      note("credential_dropped", name);
      return false;
    }),
  );
  const headers = Object.fromEntries(
    [...scan.headers.values()].map(({ name, value }) => [name, value]),
  );
  return {
    ok: true,
    provider: match.id,
    path: match.path,
    query,
    headers,
    issues,
  };
}
