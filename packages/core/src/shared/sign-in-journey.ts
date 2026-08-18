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

/**
 * Legacy entry-point grammar. Generated apps in the wild hand-write
 * `/_agent-native/sign-in?return=<path>` and are not upgradeable, so the
 * CONSUMER side of this param is permanent API surface. New producers must
 * emit `c` instead; deleting the consumer fallback silently redirects every
 * generated app to `/`, which reads as a UX quirk rather than a regression and
 * therefore will not be caught.
 */
export const SIGN_IN_LEGACY_RETURN_PARAM = "return";

/** The clean, user-facing sign-in entry point emitted by current clients. */
export const SIGN_IN_ENTRY_PATH = "/sign-in";

/** The old framework entry point, retained for generated apps and bookmarks. */
export const SIGN_IN_LEGACY_ENTRY_PATH = "/_agent-native/sign-in";

/** Max length of an encoded continuation token, in characters. */
export const SIGN_IN_CONTINUATION_MAX_LENGTH = 512;

export interface SignInJourney {
  /**
   * Where to send the browser to authenticate — always same-origin, always
   * under the app base path, always carrying exactly one continuation.
   * `null` when the browser is ALREADY at an auth entry path: there is no
   * such thing as signing in from the sign-in page, and a caller must not
   * navigate. Distinguishable absence, never a lookalike default.
   */
  readonly signInHref: string | null;
  /**
   * Where to send the browser once a session exists. Always same-origin,
   * always under the app base path, never an auth entry path. Always a value —
   * worst case the app home, which is a correct answer rather than a swallowed
   * failure.
   */
  readonly resumeHref: string;
}

export interface SignInJourneyInput {
  /** Current location as a PATH: pathname + search + hash. Never a URL. */
  at: string;
  /** Whatever arrived in the `c` query param, if anything. */
  continuation?: string | null;
  /**
   * Legacy `?return=` value, if anything. Accepted forever; see
   * SIGN_IN_LEGACY_RETURN_PARAM.
   */
  legacyReturn?: string | null;
  /** App base path, `""` for root deploys. */
  basePath?: string;
}

/**
 * The whole runtime, as one self-contained function.
 *
 * Self-contained on purpose: `signInJourneyInlineScript()` emits this via
 * `Function.prototype.toString()` so the login documents run the identical
 * code instead of a hand-transcribed copy. A reference to anything outside
 * this function body would be undefined inside the emitted script.
 */
function createSignInJourneyRuntime(basePath: string) {
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

  function isAuthEntryPath(pathname: string): boolean {
    // Suffix match rather than equality so this holds under any base path,
    // including one this process was not configured with (a workspace host
    // serving a sibling app's URL).
    if (
      pathname === ENTRY_PATH ||
      pathname.slice(-ENTRY_PATH.length) === ENTRY_PATH ||
      pathname === LEGACY_ENTRY_PATH ||
      pathname.slice(-LEGACY_ENTRY_PATH.length) === LEGACY_ENTRY_PATH
    ) {
      return true;
    }
    var rest = pathname;
    if (base) {
      if (rest === base) rest = "/";
      else if (rest.slice(0, base.length + 1) === base + "/")
        rest = rest.slice(base.length);
    }
    return rest === "/login" || rest === "/signup";
  }

  /**
   * The shared validator. Returns a full same-origin app path, or `null` —
   * never `"/"`, so an invalid continuation stays distinguishable from a
   * genuine request for the home page. Callers that want a fallback write it
   * at the call site.
   */
  function normalizeAppPath(raw: string | null | undefined): string | null {
    if (typeof raw !== "string" || !raw) return null;
    // Header/URL injection: a `\r\n` reaching a `Location` splits the response.
    if (hasControlCharacter(raw)) return null;
    if (raw.charAt(0) !== "/") return null;
    // Scheme-relative, plus the backslash form WHATWG normalizes to `//`.
    if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return null;
    var parsed;
    try {
      parsed = new URL(raw, SENTINEL);
    } catch (e) {
      return null;
    }
    // Catches everything WHATWG normalizes that prefix checks miss. This is
    // why prefix checks alone are insufficient.
    if (parsed.origin !== SENTINEL) return null;
    var pathname = parsed.pathname || "/";
    // WHATWG path normalization can turn traversal such as `/..//host` into
    // `//host`; validate the normalized path before returning it to a redirect
    // sink.
    if (pathname.startsWith("//")) return null;
    if (isAuthEntryPath(pathname)) return null;
    // Containment in this app's own base path. On a multi-app workspace host
    // `/otherapp/admin` is same-origin but is NOT this app, so this is the
    // only control that makes an unsigned path-only token safe there. `base`
    // is resolved from configured env / `appBasePath()` and NEVER from the
    // continuation itself.
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
      // encodeURIComponent first so the input to btoa is pure ASCII; the pair
      // round-trips any UTF-8 exactly.
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
    // Re-validated on decode: a user can paste any `c`, so encode-time
    // validation is never trusted here.
    return normalizeAppPath(decoded);
  }

  function homeHref(): string {
    return base || "/";
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

  /** Read a query param out of a raw `?a=b` / `a=b` search string. */
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

function runtime(basePath: string | undefined): SignInJourneyRuntime {
  const key = basePath ?? "";
  let cached = runtimeCache.get(key);
  if (!cached) {
    cached = createSignInJourneyRuntime(key);
    runtimeCache.set(key, cached);
  }
  return cached;
}

/**
 * Validate a candidate app path. Returns the normalised full path (base path
 * included) or `null`. Pass `basePath` to additionally require containment —
 * omit it for surfaces such as provider OAuth returns whose targets are not
 * guaranteed to be base-path prefixed.
 */
export function normalizeAppPath(
  raw: string | null | undefined,
  basePath = "",
): string | null {
  return runtime(basePath).normalizeAppPath(raw);
}

/** Encode an app path as a continuation token. `""` for anything not returnable. */
export function encodeContinuation(
  path: string | null | undefined,
  basePath = "",
): string {
  return runtime(basePath).encodeContinuation(path);
}

/** Decode a continuation token to an app path. `null` for anything invalid. */
export function decodeContinuation(
  token: string | null | undefined,
  basePath = "",
): string | null {
  return runtime(basePath).decodeContinuation(token);
}

export function signInJourney(input: SignInJourneyInput): SignInJourney {
  return runtime(input.basePath).signInJourney(input);
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
