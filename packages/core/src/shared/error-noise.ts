/**
 * The one place that decides whether a captured error is noise.
 *
 * Isomorphic on purpose: the browser capture, the server `captureError()`
 * boundary, the Sentry `beforeSend` hooks, and the analytics ingest all call
 * `classifyErrorNoise()`. Before this module each of them kept its own list, so
 * a rule that existed in one path (Amplitude, abort) was missing from the
 * others and a stale-chunk guard could be wrong in only one of them.
 *
 * A drop is never silent: the verdict carries a `reason` and every caller
 * counts it. Unknown failures are never dropped — each rule names a specific,
 * positively identified class, and an error that matches none is reported.
 */
import { isDynamicImportFailureMessage } from "../client/route-chunk-recovery.js";

export type ErrorNoiseSurface = "browser" | "server";

export interface ErrorNoiseFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  in_app?: boolean;
}

export interface ErrorNoiseSignal {
  surface: ErrorNoiseSurface;
  type?: string;
  /** The exception message. */
  value?: string;
  /** Raw stack text. Parsed into frames when `frames` is not supplied. */
  stack?: string;
  /** Innermost frame first, the order V8 prints them. */
  frames?: ErrorNoiseFrame[];
  /**
   * Hosts that serve this app's own scripts (the page host, and the host the
   * bundle itself was loaded from). When present, a frame on any other host is
   * foreign. Absent, only positively identified third parties count: guessing
   * "foreign" without knowing where our assets live would drop every error from
   * a deployment that serves its bundle from a CDN.
   */
  firstPartyHosts?: string[];
  pageUrl?: string;
  /** Extra text mined for network destinations (request URL, breadcrumbs). */
  contextText?: string;
  tags?: Record<string, string | undefined>;
  mechanismType?: string;
  statusCode?: number;
  metadataValue?: string;
  metadataFilename?: string;
  hasExceptionValues?: boolean;
}

export type ErrorNoiseReason =
  | "validation"
  | "access-control"
  | "lambda-socket-hang-up"
  | "sdk-error-event"
  | "expected-http"
  | "test-harness"
  | "resize-observer"
  | "stale-chunk"
  | "view-transition-abort"
  | "extension-bootstrap"
  | "opaque-script-error"
  | "opaque-zero-line-stack"
  | "extension-network"
  | "extension-origin"
  | "third-party-origin"
  | "amplitude-network"
  | "unattributable-network"
  | "benign-abort"
  | "run-timeout-reconnect"
  | "agent-auto-continue"
  | "session-replay-autoplay"
  | "sourceless-emptyranges"
  | "docs-webkit-bridge"
  | "docs-sourceless-stack-overflow";

export type ErrorNoiseVerdict =
  | { drop: false }
  | { drop: true; reason: ErrorNoiseReason };

const MAX_PARSED_STACK_LINES = 200;

const EXTENSION_SCHEME_RE =
  /\b(?:chrome|moz|safari|safari-web|webkit|ms-browser)-extension:\/\//i;
const EXTENSION_SCRIPT_RE = /\binjectScriptAdjust\.js\b/i;
const GTM_FILE_RE = /(?:^|\/)gtm\.js(?:$|[?#])/i;
// Scripts we do not ship that routinely throw into the page's global handlers.
// Add a host here when a new pixel shows up in the tracker; the list is the
// positive evidence that lets a stack be called third-party without knowing
// where our own assets are hosted.
const THIRD_PARTY_HOST_RE =
  /(?:^|\.)(?:googletagmanager\.com|google-analytics\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com|facebook\.net|licdn\.com|vector\.co|hotjar\.(?:com|io)|clarity\.ms|segment\.(?:com|io)|amplitude\.com|hubspot\.com|hs-scripts\.com|hsforms\.net|intercomcdn\.com|ads-twitter\.com|snap\.licdn\.com|posthog\.com|cloudflareinsights\.com)$/i;
// Our own deployments span several hosts under these domains; they are never
// foreign to each other.
const FIRST_PARTY_FAMILY_RE = /(?:^|\.)(?:agent-native\.com|builder\.io)$/i;
const AMPLITUDE_HOST_RE = /\b(?:api2?|cdn|regionconfig)\.amplitude\.com\b/i;

// Our own fetch/XHR patches (Sentry wrap, db-sync, session replay). They sit
// between the failing native call and the code that issued it, so they are the
// innermost frame of every network failure and say nothing about the cause.
const WRAPPER_FUNCTION_RE =
  /^(?:(?:window|globalThis|self)\.)?(?:fetch|XMLHttpRequest\.(?:open|send)|XMLHttpRequest\.prototype\.(?:open|send))$/;
const WRAPPER_FILE_RE =
  /(?:^|\/)(?:api-path|use-db-sync|session-replay)(?:[.-][\w-]*)?\.[cm]?js(?:$|[?#])/i;

const NETWORK_FAILURE_RE =
  /^(?:(?:Type)?Error:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed)(?:\s*\([^)]*\))?\.?$/i;
const SCRIPT_ERROR_RE = /^Script error\.?$/i;
const RESIZE_OBSERVER_RE =
  /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.?)$/i;

export type ErrorFrameOrigin =
  | "first-party"
  | "wrapper"
  | "third-party"
  | "extension"
  | "unknown";

function parseLocation(loc: string): ErrorNoiseFrame {
  const trimmed = loc.trim();
  const withColumn = /^(.*?):(\d+):(\d+)$/.exec(trimmed);
  if (withColumn) {
    return { filename: withColumn[1], lineno: Number(withColumn[2]) };
  }
  const withLine = /^(.*?):(\d+)$/.exec(trimmed);
  if (withLine) {
    return { filename: withLine[1], lineno: Number(withLine[2]) };
  }
  return { filename: trimmed };
}

function parseV8Line(line: string): ErrorNoiseFrame | undefined {
  const rest = line
    .slice(3)
    .trim()
    .replace(/^async\s+/, "");
  const parenthesised = /^(.*?)\s+\((.*)\)$/.exec(rest);
  if (parenthesised) {
    return {
      function: parenthesised[1].trim() || undefined,
      ...parseLocation(parenthesised[2]),
    };
  }
  return rest ? parseLocation(rest) : undefined;
}

function looksLikeFrameLocation(loc: string): boolean {
  return (
    /:\d+(?::\d+)?$/.test(loc) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(loc) ||
    loc === "[native code]"
  );
}

function parseGeckoLine(line: string): ErrorNoiseFrame | undefined {
  const at = line.lastIndexOf("@");
  if (at < 0) return undefined;
  const loc = line.slice(at + 1).trim();
  // `params: a@b.com` from a database error is not a frame.
  if (!looksLikeFrameLocation(loc)) return undefined;
  return {
    function: line.slice(0, at).trim() || undefined,
    ...parseLocation(loc),
  };
}

/**
 * Parse a V8 or Gecko/Safari stack into frames, innermost first. Message
 * header lines — including the continuation lines of a multi-line message — are
 * skipped, so text inside an error message can never become a frame.
 */
export function parseErrorStackFrames(
  stack: string | null | undefined,
): ErrorNoiseFrame[] {
  if (!stack || typeof stack !== "string") return [];
  const lines = stack.split("\n", MAX_PARSED_STACK_LINES);
  const isV8 = lines.some((line) => /^\s*at\s/.test(line));
  const frames: ErrorNoiseFrame[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isV8) {
      if (!line.startsWith("at ")) continue;
      const frame = parseV8Line(line);
      if (frame) frames.push(frame);
    } else {
      const frame = parseGeckoLine(line);
      if (frame) frames.push(frame);
    }
  }
  return frames;
}

function hostOf(file: string): string | undefined {
  const match = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/:?#]+)/i.exec(file);
  return match?.[1]?.toLowerCase();
}

function registrableDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const sld = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  const take =
    tld.length === 2 &&
    ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sld)
      ? 3
      : 2;
  return labels.slice(-take).join(".");
}

export function isWrapperFrame(frame: ErrorNoiseFrame): boolean {
  return (
    WRAPPER_FUNCTION_RE.test(frame.function?.trim() ?? "") ||
    WRAPPER_FILE_RE.test(frame.filename ?? "")
  );
}

/** Whether a stack-frame file is provably not ours (vendor script, extension). */
export function isThirdPartyFrameFile(
  file: string | null | undefined,
): boolean {
  if (!file) return false;
  if (EXTENSION_SCHEME_RE.test(file) || EXTENSION_SCRIPT_RE.test(file)) {
    return true;
  }
  if (GTM_FILE_RE.test(file)) return true;
  const host = hostOf(file);
  return host !== undefined && THIRD_PARTY_HOST_RE.test(host);
}

export function classifyFrameOrigin(
  frame: ErrorNoiseFrame,
  firstPartyHosts: readonly string[] = [],
): ErrorFrameOrigin {
  const file = frame.filename?.trim();
  if (!file || file === "<anonymous>" || file === "native") return "unknown";
  if (file === "[native code]") return "unknown";
  if (EXTENSION_SCHEME_RE.test(file) || EXTENSION_SCRIPT_RE.test(file)) {
    return "extension";
  }
  if (isThirdPartyFrameFile(file)) return "third-party";
  const host = hostOf(file);
  if (
    host &&
    firstPartyHosts.length > 0 &&
    !FIRST_PARTY_FAMILY_RE.test(host) &&
    !firstPartyHosts.some(
      (own) => registrableDomain(own) === registrableDomain(host),
    )
  ) {
    return "third-party";
  }
  return isWrapperFrame(frame) ? "wrapper" : "first-party";
}

export interface ErrorOriginAnalysis {
  firstParty: number;
  wrapper: number;
  thirdParty: number;
  extension: number;
  zeroLine: number;
  withFile: number;
}

export function analyzeErrorOrigin(
  frames: readonly ErrorNoiseFrame[],
  firstPartyHosts: readonly string[] = [],
): ErrorOriginAnalysis {
  const analysis: ErrorOriginAnalysis = {
    firstParty: 0,
    wrapper: 0,
    thirdParty: 0,
    extension: 0,
    zeroLine: 0,
    withFile: 0,
  };
  for (const frame of frames) {
    const origin = classifyFrameOrigin(frame, firstPartyHosts);
    if (origin === "unknown") continue;
    analysis.withFile += 1;
    if (frame.lineno === 0) analysis.zeroLine += 1;
    if (origin === "first-party") analysis.firstParty += 1;
    else if (origin === "wrapper") analysis.wrapper += 1;
    else if (origin === "third-party") analysis.thirdParty += 1;
    else analysis.extension += 1;
  }
  return analysis;
}

export function isNetworkFailureMessage(message: string): boolean {
  return NETWORK_FAILURE_RE.test(message.trim());
}

export function isBenignAbort(type: string, message: string): boolean {
  const exceptionType = type.trim().toLowerCase();
  const exceptionValue = message.trim().toLowerCase();
  return (
    exceptionValue === "the user aborted a request." ||
    exceptionValue === "signal is aborted without reason" ||
    exceptionValue === "aborterror: the user aborted a request." ||
    exceptionValue === "aborterror: signal is aborted without reason" ||
    (exceptionType === "aborterror" &&
      (exceptionValue.includes("the user aborted a request") ||
        exceptionValue.includes("signal is aborted without reason")))
  );
}

/**
 * A fuzz/test harness replaces `process.exit` with a function that throws this
 * label; running the CLI under one must not reach production telemetry.
 */
export function isTestHarnessError(parts: {
  value?: string;
  stack?: string;
}): boolean {
  return (
    (parts.value ?? "").trim() === "fuzz-intercepted-process-exit" ||
    /fuzzInterceptedProcessExit|fuzz-exports\.js/.test(parts.stack ?? "")
  );
}

interface NoiseContext {
  signal: ErrorNoiseSignal;
  type: string;
  value: string;
  frames: ErrorNoiseFrame[];
  origin: ErrorOriginAnalysis;
  pageUrl: string;
  contextText: string;
  isNetworkFailure: boolean;
}

interface NoiseRule {
  reason: ErrorNoiseReason;
  surfaces: readonly ErrorNoiseSurface[];
  test(ctx: NoiseContext): boolean;
}

const BOTH = ["browser", "server"] as const;
const BROWSER = ["browser"] as const;
const SERVER = ["server"] as const;

/**
 * Tag a capture with this (`"true"`) when the caller raises an access-control
 * or 4xx failure as a real failure rather than answering a rejected request —
 * an automation runner whose grant was lost. The rules that drop those as
 * expected skip it, at every boundary that classifies (server capture, ingest).
 */
export const REPORT_EXPECTED_FAILURE_TAG = "reportExpected";
const EXPECTED_FAILURE_REASONS: ReadonlySet<ErrorNoiseReason> = new Set([
  "access-control",
  "expected-http",
]);

// An explicit capture names the code that raised it (`context`, `area`). That
// code is ours, so a stackless Safari/Firefox network error it reports is not
// unattributable.
function isTaggedFirstParty(
  tags: Record<string, string | undefined> | undefined,
): boolean {
  return Boolean(tags?.context?.trim() || tags?.area?.trim());
}

function isUnhandledRejection(signal: ErrorNoiseSignal): boolean {
  return (
    typeof signal.mechanismType === "string" &&
    signal.mechanismType.endsWith("onunhandledrejection")
  );
}

function hasOnlySourcelessFrames(frames: readonly ErrorNoiseFrame[]): boolean {
  return (
    frames.length === 0 ||
    frames.every((frame) => {
      const filename = String(frame.filename ?? "")
        .trim()
        .toLowerCase();
      return (
        !String(frame.function ?? "").trim() &&
        (!filename || filename === "undefined" || filename === "<anonymous>")
      );
    })
  );
}

function isAgentNativeDocsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "www.agent-native.com" || host === "agent-native.com";
  } catch {
    // coercion-ok: an unparseable page URL simply is not the docs site.
    return false;
  }
}

function isSessionReplayUrl(url: string): boolean {
  try {
    return /^\/sessions\/[^/]+\/?$/.test(new URL(url).pathname);
  } catch {
    // coercion-ok: an unparseable page URL simply is not a replay page.
    return false;
  }
}

function isExpectedHttpNoise(ctx: NoiseContext): boolean {
  const { signal } = ctx;
  if (signal.type !== "HTTPError" && signal.type !== "H3Error") return false;
  const code = signal.statusCode;
  if (typeof code === "number" && Number.isFinite(code)) {
    return code >= 400 && code < 500;
  }
  const value = ctx.value;
  return (
    /^Cannot find any route matching/i.test(value) ||
    / not found$/i.test(value) ||
    /Unauthenticated$/i.test(value) ||
    /^Unauthorized$/i.test(value) ||
    /^No access to /i.test(value)
  );
}

function isSdkErrorEventNoise(ctx: NoiseContext): boolean {
  const { signal, frames, value } = ctx;
  if (value === "[object ErrorEvent]" && isUnhandledRejection(signal)) {
    const hasApplicationFrame = frames.some(
      (frame) =>
        frame.in_app && !String(frame.filename ?? "").includes("sentry"),
    );
    const hasSentryFrame = frames.some((frame) =>
      String(frame.filename ?? "").includes("sentry"),
    );
    if (!hasApplicationFrame && hasSentryFrame) return true;
  }
  return (
    signal.metadataValue === "[object ErrorEvent]" &&
    signal.hasExceptionValues === false &&
    String(signal.metadataFilename ?? "").includes("sentry")
  );
}

const RULES: readonly NoiseRule[] = [
  {
    reason: "validation",
    surfaces: BOTH,
    test: ({ signal }) =>
      signal.type === "ValidationError" ||
      signal.tags?.handled === "validation",
  },
  {
    reason: "test-harness",
    surfaces: BOTH,
    test: ({ value, signal }) =>
      isTestHarnessError({ value, stack: signal.stack }),
  },
  {
    reason: "access-control",
    surfaces: SERVER,
    test: ({ signal }) =>
      signal.type === "ForbiddenError" || signal.type === "UnauthorizedError",
  },
  {
    reason: "access-control",
    surfaces: BROWSER,
    test: ({ type, value }) => {
      const exceptionType = type.trim().toLowerCase();
      const exceptionValue = value.trim().toLowerCase();
      return (
        exceptionType === "unauthorizederror" ||
        exceptionType === "unauthenticatederror" ||
        exceptionValue === "unauthorized" ||
        exceptionValue === "unauthenticated"
      );
    },
  },
  {
    reason: "lambda-socket-hang-up",
    surfaces: SERVER,
    test: ({ value, frames, signal }) =>
      value === "socket hang up" &&
      isUnhandledRejection(signal) &&
      frames.some(
        (frame) =>
          frame.function === "Socket.socketOnEnd" ||
          frame.filename === "node:_http_client",
      ),
  },
  { reason: "sdk-error-event", surfaces: SERVER, test: isSdkErrorEventNoise },
  { reason: "expected-http", surfaces: SERVER, test: isExpectedHttpNoise },
  {
    reason: "resize-observer",
    surfaces: BROWSER,
    test: ({ value }) => RESIZE_OBSERVER_RE.test(value.trim()),
  },
  {
    // route-chunk-recovery already reloads on these; reporting each one only
    // counts every deploy as an outage. When it cannot reload (cooldown,
    // desktop) it reports one typed `RouteChunkRecoveryExhausted` instead, so
    // dropping the raw failure never hides a deploy whose chunks are gone.
    // Matched on the message alone — Chrome's `stack` for this error is just
    // its header line, so a "no stack" guard never fires.
    reason: "stale-chunk",
    surfaces: BROWSER,
    test: ({ type, value }) =>
      isDynamicImportFailureMessage(value) ||
      isDynamicImportFailureMessage(`${type}: ${value}`),
  },
  {
    reason: "view-transition-abort",
    surfaces: BROWSER,
    test: ({ type, value }) =>
      type === "InvalidStateError" &&
      /^Transition was aborted because of invalid state$/i.test(value.trim()),
  },
  {
    reason: "extension-bootstrap",
    surfaces: BROWSER,
    test: ({ value }) =>
      /^This script should only be loaded in a browser extension\.?$/i.test(
        value.trim(),
      ),
  },
  {
    // Cross-origin script failure: the browser withholds message and stack, so
    // there is nothing to act on.
    reason: "opaque-script-error",
    surfaces: BROWSER,
    test: ({ value }) => SCRIPT_ERROR_RE.test(value.trim()),
  },
  {
    // A frame at line 0 has no source position: injected or eval'd code.
    reason: "opaque-zero-line-stack",
    surfaces: BROWSER,
    test: ({ origin }) =>
      origin.withFile > 0 && origin.zeroLine === origin.withFile,
  },
  {
    reason: "extension-network",
    surfaces: BROWSER,
    test: ({ isNetworkFailure, origin }) =>
      isNetworkFailure && origin.extension > 0,
  },
  {
    reason: "extension-origin",
    surfaces: BROWSER,
    test: ({ origin }) => origin.extension > 0 && origin.firstParty === 0,
  },
  {
    reason: "third-party-origin",
    surfaces: BROWSER,
    test: ({ origin }) => origin.thirdParty > 0 && origin.firstParty === 0,
  },
  {
    reason: "amplitude-network",
    surfaces: BROWSER,
    test: ({ isNetworkFailure, value, contextText, frames }) =>
      isNetworkFailure &&
      (AMPLITUDE_HOST_RE.test(value) ||
        AMPLITUDE_HOST_RE.test(contextText) ||
        frames.some((frame) => /amplitude/i.test(frame.filename ?? ""))),
  },
  {
    // A failed fetch whose stack never reaches code we shipped cannot be
    // attributed to us (ad blockers, offline, a vendor script's own request).
    reason: "unattributable-network",
    surfaces: BROWSER,
    test: ({ isNetworkFailure, origin, signal }) =>
      isNetworkFailure &&
      origin.firstParty === 0 &&
      !isTaggedFirstParty(signal.tags),
  },
  {
    reason: "benign-abort",
    surfaces: BROWSER,
    test: ({ type, value }) => isBenignAbort(type, value),
  },
  {
    reason: "run-timeout-reconnect",
    surfaces: BROWSER,
    test: ({ signal }) =>
      signal.tags?.context === "agent-native-chat" &&
      signal.tags?.errorCode === "run_timeout" &&
      signal.tags?.reconnectTimedOut === "false" &&
      signal.tags?.reconnectTerminalReason === "run_timeout",
  },
  {
    reason: "agent-auto-continue",
    surfaces: BROWSER,
    test: ({ type }) => type === "AgentAutoContinueSignal",
  },
  {
    reason: "session-replay-autoplay",
    surfaces: BROWSER,
    test: ({ pageUrl, value }) => {
      if (!isSessionReplayUrl(pageUrl)) return false;
      const text = value.trim().toLowerCase();
      return (
        text.includes("notallowederror: play() failed") &&
        text.includes("user didn't interact with the document first")
      );
    },
  },
  {
    reason: "sourceless-emptyranges",
    surfaces: BROWSER,
    test: ({ type, value, frames }) =>
      type.trim().toLowerCase() === "referenceerror" &&
      value.toLowerCase().includes("emptyranges") &&
      hasOnlySourcelessFrames(frames),
  },
  {
    reason: "docs-webkit-bridge",
    surfaces: BROWSER,
    test: ({ pageUrl, value }) =>
      isAgentNativeDocsUrl(pageUrl) &&
      value
        .toLowerCase()
        .includes(
          "window.webkit.messagehandlers.scrolleventhandler.postmessage",
        ),
  },
  {
    reason: "docs-sourceless-stack-overflow",
    surfaces: BROWSER,
    test: ({ pageUrl, type, value, frames }) =>
      isAgentNativeDocsUrl(pageUrl) &&
      type.trim().toLowerCase() === "rangeerror" &&
      value.toLowerCase().includes("maximum call stack") &&
      hasOnlySourcelessFrames(frames),
  },
];

export function classifyErrorNoise(
  signal: ErrorNoiseSignal,
): ErrorNoiseVerdict {
  const frames = signal.frames ?? parseErrorStackFrames(signal.stack);
  const value = signal.value ?? "";
  const ctx: NoiseContext = {
    signal,
    type: signal.type ?? "",
    value,
    frames,
    origin: analyzeErrorOrigin(frames, signal.firstPartyHosts),
    pageUrl: (signal.pageUrl ?? "").toLowerCase(),
    contextText: signal.contextText ?? "",
    isNetworkFailure: isNetworkFailureMessage(value),
  };
  const reportExpected = signal.tags?.[REPORT_EXPECTED_FAILURE_TAG] === "true";
  for (const rule of RULES) {
    if (reportExpected && EXPECTED_FAILURE_REASONS.has(rule.reason)) continue;
    if (rule.surfaces.includes(signal.surface) && rule.test(ctx)) {
      return { drop: true, reason: rule.reason };
    }
  }
  return { drop: false };
}

const SQL_PARAMS_LINE_RE = /(?:\r?\n)[ \t]*params:[^\n]*/g;

/**
 * Drizzle's `Failed query: <sql>\nparams: a,b,c` carries the bound values —
 * emails, ids, tokens — on a second line. Left in, that line is stored in the
 * issue title and parsed as the culprit frame, so every user gets their own
 * issue and their address is readable in the list.
 */
export function stripSqlParams(text: string): string {
  return text.replace(SQL_PARAMS_LINE_RE, "");
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Replace the user's home directory so a path never names the person. */
export function scrubUserPaths(text: string): string {
  return text
    .replace(/\/(?:Users|home)\/[^/\s:'"()]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s:'"()]+/gi, "~");
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
