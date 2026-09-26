/**
 * The single "establish a session and return the user where they started"
 * primitive.
 *
 * Before this file the framework had five return-path validators, four
 * "don't redirect to yourself" checks, and two complete copies of the login
 * document — so every anti-loop fix landed on whichever fork the ticket named
 * and the reports never stopped. Every sign-in surface now calls exactly this:
 * the client gate (`RequireSession`), the login document, the sign-in entry
 * route, and every template button.
 *
 * The continuation is a PATH, never a URL, and it is carried opaquely in the
 * `c` query param. That combination is why nesting is structurally impossible
 * rather than guarded against:
 *
 *  - the grammar is not recursive: decoding a continuation yields a string,
 *    never another continuation;
 *  - `signInJourney` returns `signInHref: null` — no token at all — when the
 *    browser is already at an auth entry path, so the one function permitted
 *    to mint continuations refuses to mint the dangerous value;
 *  - the sign-in URL is `<base>/sign-in?c=<opaque>`, so
 *    "capture the current location as the return" has no URL-shaped input to
 *    re-encode;
 *  - `c` does not look like a URL, so Better Auth's `callbackURL`, a proxy, or
 *    a future patch cannot mistake it for a redirect target and wrap it.
 *
 * There is exactly ONE auth-entry-path predicate left in the codebase and it
 * lives in `normalizeAppPath` below. The four call-site copies are gone.
 *
 * Not signed. Signing buys nothing: the user already controls their own
 * browser and can type any URL. The only threat is open redirect, which is a
 * validation problem, not an integrity problem — and an HMAC would add a
 * secret dependency to code that must run inside a CDN-cached public document.
 */

export const SIGN_IN_CONTINUATION_PARAM = "c";

export const SIGN_IN_LEGACY_RETURN_PARAM = "return";

export const SIGN_IN_ENTRY_PATH = "/sign-in";

export const SIGN_IN_LEGACY_ENTRY_PATH = "/_agent-native/sign-in";

export const SIGN_IN_CONTINUATION_MAX_LENGTH = 512;

export interface SignInJourney {
  readonly signInHref: string | null;
  readonly resumeHref: string;
}

export interface SignInJourneyInput {
  at: string;
  continuation?: string | null;
  legacyReturn?: string | null;
  basePath?: string;
  homePath?: string;
}

function createSignInJourneyRuntime(
  basePath: string,
  configuredHomePath = "/home",
) {
  var PARAM = "c";
  var LEGACY_PARAM = "return";
  var ENTRY_PATH = "/sign-in";
  var LEGACY_ENTRY_PATH = "/_agent-native/sign-in";
  var MAX_TOKEN = 512;
  var SENTINEL = "http://an.invalid";

  function normalizeBasePath(raw: string): string {
    if (!raw || raw === "/") return "";
    var trimmed = String(raw).replace(/^\/+/, "").replace(/\/+$/, "");
    return trimmed ? "/" + trimmed : "";
  }

  var base = normalizeBasePath(basePath);

  function hasControlCharacter(value: string): boolean {
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
  }

  function normalizeHomePath(raw: string | null | undefined): string {
    if (typeof raw !== "string" || !raw) return "/home";
    var value = String(raw).trim();
    if (value === "/") return "/";
    if (
      value.charAt(0) !== "/" ||
      value.charAt(1) === "/" ||
      value.indexOf("\\") >= 0 ||
      value.indexOf("?") >= 0 ||
      value.indexOf("#") >= 0 ||
      hasControlCharacter(value)
    ) {
      return "/home";
    }
    var parsed;
    try {
      parsed = new URL(value, SENTINEL);
    } catch (e) {
      return "/home";
    }
    if (
      parsed.origin !== SENTINEL ||
      parsed.pathname !== value ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname.startsWith("//")
    ) {
      return "/home";
    }
    return value;
  }

  function isAuthEntryPath(pathname: string): boolean {
    if (
      pathname === ENTRY_PATH ||
      pathname.slice(-ENTRY_PATH.length) === ENTRY_PATH ||
      pathname === LEGACY_ENTRY_PATH ||
      pathname.slice(-LEGACY_ENTRY_PATH.length) === LEGACY_ENTRY_PATH ||
      pathname === "/login" ||
      pathname.slice(-"/login".length) === "/login" ||
      pathname === "/signup" ||
      pathname.slice(-"/signup".length) === "/signup"
    ) {
      return true;
    }
    return false;
  }

  var homePath = normalizeHomePath(configuredHomePath);
  if (isAuthEntryPath(homePath)) homePath = "/home";

  function normalizeAppPath(raw: string | null | undefined): string | null {
    if (typeof raw !== "string" || !raw) return null;
    if (hasControlCharacter(raw)) return null;
    if (raw.charAt(0) !== "/") return null;
    if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return null;
    var parsed;
    try {
      parsed = new URL(raw, SENTINEL);
    } catch (e) {
      return null;
    }
    if (parsed.origin !== SENTINEL) return null;
    var pathname = parsed.pathname || "/";
    if (pathname.startsWith("//")) return null;
    if (isAuthEntryPath(pathname)) return null;
    // only control that makes an unsigned path-only token safe there. `base`
    if (
      base &&
      pathname !== base &&
      pathname.slice(0, base.length + 1) !== base + "/"
    ) {
      return null;
    }
    return pathname + parsed.search + parsed.hash;
  }

  function encodeContinuation(path: string | null | undefined): string {
    var normalized = normalizeAppPath(path);
    if (!normalized) return "";
    var token;
    try {
      token = btoa(encodeURIComponent(normalized))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    } catch (e) {
      return "";
    }
    return token.length > MAX_TOKEN ? "" : token;
  }

  function decodeContinuation(token: string | null | undefined): string | null {
    if (typeof token !== "string" || !token) return null;
    if (token.length > MAX_TOKEN) return null;
    var decoded;
    try {
      var b64 = token.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4 !== 0) b64 += "=";
      decoded = decodeURIComponent(atob(b64));
    } catch (e) {
      return null;
    }
    return normalizeAppPath(decoded);
  }

  function homeHref(): string {
    return homePath === "/" ? base || "/" : base + homePath;
  }

  function signInJourney(input: {
    at: string;
    continuation?: string | null;
    legacyReturn?: string | null;
  }) {
    var here = normalizeAppPath(input.at);
    var resume =
      decodeContinuation(input.continuation) ??
      normalizeAppPath(input.legacyReturn) ??
      here ??
      homeHref();
    var signInHref = null as string | null;
    if (here !== null) {
      var token = encodeContinuation(here);
      signInHref = base + ENTRY_PATH + (token ? "?" + PARAM + "=" + token : "");
    }
    return { signInHref: signInHref, resumeHref: resume };
  }

  function readParam(search: string, name: string): string | null {
    try {
      return new URLSearchParams(search || "").get(name);
    } catch (e) {
      return null;
    }
  }

  function journeyForLocation(location: {
    pathname: string;
    search: string;
    hash: string;
  }) {
    return signInJourney({
      at:
        (location.pathname || "/") +
        (location.search || "") +
        (location.hash || ""),
      continuation: readParam(location.search, PARAM),
      legacyReturn: readParam(location.search, LEGACY_PARAM),
    });
  }

  return {
    PARAM: PARAM,
    LEGACY_PARAM: LEGACY_PARAM,
    basePath: base,
    homeHref: homeHref,
    normalizeAppPath: normalizeAppPath,
    encodeContinuation: encodeContinuation,
    decodeContinuation: decodeContinuation,
    signInJourney: signInJourney,
    journeyForLocation: journeyForLocation,
  };
}

type SignInJourneyRuntime = ReturnType<typeof createSignInJourneyRuntime>;

const runtimeCache = new Map<string, SignInJourneyRuntime>();

function runtime(
  basePath: string | undefined,
  homePath: string | undefined = "/home",
): SignInJourneyRuntime {
  const key = `${basePath ?? ""}\u0000${homePath}`;
  let cached = runtimeCache.get(key);
  if (!cached) {
    cached = createSignInJourneyRuntime(basePath ?? "", homePath);
    runtimeCache.set(key, cached);
  }
  return cached;
}

export function normalizeAppPath(
  raw: string | null | undefined,
  basePath = "",
): string | null {
  return runtime(basePath).normalizeAppPath(raw);
}

export function encodeContinuation(
  path: string | null | undefined,
  basePath = "",
): string {
  return runtime(basePath).encodeContinuation(path);
}

export function decodeContinuation(
  token: string | null | undefined,
  basePath = "",
): string | null {
  return runtime(basePath).decodeContinuation(token);
}

export function signInJourney(input: SignInJourneyInput): SignInJourney {
  return runtime(input.basePath, input.homePath).signInJourney(input);
}

/**
 * The runtime as `<script>`-embeddable source declaring
 * `__anCreateSignInJourney(basePath)`.
 *
 * Emitted from the same function the server and client call, so the login
 * document cannot drift from the module — which is exactly how the repo ended
 * up with two login pages disagreeing about return paths in the first place.
 * `packages/core` builds with plain `tsc` (no bundler, no minifier), so the
 * emitted source is verbatim; `createSignInJourneyRuntime` must therefore stay
 * self-contained, ES5-compatible, and free of references to module scope.
 */
export function signInJourneyInlineScript(): string {
  return `var __anCreateSignInJourney = ${createSignInJourneyRuntime.toString()};`;
}
