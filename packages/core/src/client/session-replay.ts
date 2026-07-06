import {
  getAnalyticsSessionId,
  getAnalyticsAnonymousId,
  scrubUrl,
} from "./analytics.js";

type ReplayEvent = Record<string, unknown>;
type QueuedReplayEvent = {
  json: string;
  timestampMs: number;
  type: number | null;
};
type ReplayStopFn = () => void;
export type SessionReplayUrlMatcher =
  | string
  | RegExp
  | ((url: string) => boolean);

interface RrwebRecordOptions {
  emit: (event: ReplayEvent) => void;
  checkoutEveryNth?: number;
  checkoutEveryNms?: number;
  inlineStylesheet?: boolean;
  blockClass?: string | RegExp;
  blockSelector?: string;
  ignoreClass?: string | RegExp;
  ignoreSelector?: string;
  maskTextClass?: string | RegExp;
  maskTextSelector?: string;
  maskAllInputs?: boolean;
  maskInputOptions?: Record<string, boolean>;
  recordCanvas?: boolean;
  recordCrossOriginIframes?: boolean;
  collectFonts?: boolean;
  inlineImages?: boolean;
  sampling?: Record<string, unknown>;
}

type RrwebRecordFn = ((
  options: RrwebRecordOptions,
) => ReplayStopFn | undefined) & {
  addCustomEvent?: (tag: string, payload: unknown) => void;
};

interface RrwebRecordModule {
  record: RrwebRecordFn;
}

interface SessionReplayState {
  active: boolean;
  startPromise: Promise<SessionReplayStartResult> | null;
  replayId: string | null;
  startedAtMs: number | null;
  sequence: number;
  /** Pre-serialized + scrubbed event JSON strings, ready to splice at flush. */
  queue: QueuedReplayEvent[];
  queuedBytes: number;
  retryBatches: QueuedReplayEvent[][];
  flushTimer: number | null;
  maxDurationTimer: number | null;
  flushing: boolean;
  stopRecorder: ReplayStopFn | null;
  restoreUrlMonitor: (() => void) | null;
  removeLifecycleListeners: (() => void) | null;
  /** rrweb's `record.addCustomEvent`, captured at start (null when absent). */
  addCustomEvent: ((tag: string, payload: unknown) => void) | null;
  /** Uninstalls console/network interceptors and flushes pending duplicates. */
  restoreCaptures: (() => void) | null;
  options: NormalizedSessionReplayOptions | null;
  lastAuthenticatedProperties: Record<string, unknown> | null;
}

interface StoredReplaySession {
  sessionId?: string;
  replayId?: string;
  startedAtMs?: number;
  sequence?: number;
}

/** rrweb `sampling` shape (mousemove/scroll/media throttles, input strategy). */
export type ReplayEventSampling = Record<string, unknown>;

/**
 * Console capture cap overrides. `maxEvents` bounds the number of
 * `agent-native.console` custom events emitted per recording session
 * (default 1000); once hit, capture stops for the rest of the session and one
 * final truncation-notice event is emitted.
 */
export interface SessionReplayConsoleOptions {
  maxEvents?: number;
}

/**
 * Network capture cap overrides. `maxEvents` bounds the number of
 * `agent-native.network` custom events emitted per recording session
 * (default 2000); once hit, capture stops for the rest of the session and one
 * final truncation-notice event is emitted.
 *
 * `captureErrorBodies` (default true) additionally captures a bounded,
 * redacted response-body snippet for 5xx responses only -- request bodies
 * and headers are never captured, and non-5xx/network-failure responses
 * never carry a body. `maxErrorBodyLength` (default 2048) caps that snippet.
 */
export interface SessionReplayNetworkOptions {
  maxEvents?: number;
  captureErrorBodies?: boolean;
  maxErrorBodyLength?: number;
}

export interface SessionReplayOptions {
  enabled?: boolean;
  publicKey?: string;
  endpoint?: string;
  requireSignedInUser?: boolean;
  sampleRate?: number;
  samplingSalt?: string;
  allowUrls?: SessionReplayUrlMatcher[];
  blockUrls?: SessionReplayUrlMatcher[];
  flushIntervalMs?: number;
  maxDurationMs?: number;
  maxEventsPerBatch?: number;
  maxBatchBytes?: number;
  checkoutEveryNth?: number;
  checkoutEveryNms?: number;
  inlineStylesheet?: boolean;
  blockSelector?: string;
  ignoreSelector?: string;
  maskTextClass?: string | RegExp;
  maskTextSelector?: string;
  maskAllInputs?: boolean;
  recordCanvas?: boolean;
  recordCrossOriginIframes?: boolean;
  collectFonts?: boolean;
  inlineImages?: boolean;
  /**
   * rrweb per-event throttling (distinct from `sampleRate`, which decides
   * whether a whole session records). Throttles high-frequency event types
   * (mousemove/scroll/input) to keep the recorded page responsive and the
   * payloads small. Passed straight through to `rrweb.record({ sampling })`.
   */
  eventSampling?: ReplayEventSampling;
  /**
   * Capture console.log/info/warn/error/debug plus window `error` and
   * `unhandledrejection` events as `agent-native.console` custom rrweb
   * events. Defaults to on whenever session replay is enabled. Pass `false`
   * to disable, or an options object to override caps.
   */
  console?: boolean | SessionReplayConsoleOptions;
  /**
   * Capture fetch/XHR requests as `agent-native.network` custom rrweb
   * events (method, URL, status, timing). Request bodies and headers are
   * never captured; response bodies are captured only as a bounded,
   * redacted snippet for 5xx responses (see `captureErrorBodies`).
   * Defaults to on whenever session replay is enabled. Pass `false` to
   * disable, or an options object to override caps.
   */
  network?: boolean | SessionReplayNetworkOptions;
  extraProperties?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | undefined);
}

export interface SessionReplayStartResult {
  started: boolean;
  reason?:
    | "disabled"
    | "not-browser"
    | "missing-public-key"
    | "missing-session-id"
    | "missing-user-id"
    | "sampled-out"
    | "url-blocked"
    | "already-active"
    | "import-failed"
    | "record-failed";
  replayId?: string;
  sessionId?: string;
  sampled?: boolean;
}

interface NormalizedSessionReplayOptions {
  publicKey: string;
  endpoint: string;
  requireSignedInUser: boolean;
  sampleRate: number;
  samplingSalt: string;
  allowUrls: SessionReplayUrlMatcher[];
  blockUrls: SessionReplayUrlMatcher[];
  flushIntervalMs: number;
  maxDurationMs: number;
  maxEventsPerBatch: number;
  maxBatchBytes: number;
  checkoutEveryNth?: number;
  checkoutEveryNms?: number;
  inlineStylesheet: boolean;
  blockSelector: string;
  ignoreSelector: string;
  maskTextClass: string | RegExp;
  maskTextSelector: string;
  maskAllInputs: boolean;
  recordCanvas: boolean;
  recordCrossOriginIframes: boolean;
  collectFonts: boolean;
  inlineImages: boolean;
  eventSampling: ReplayEventSampling;
  /** Null disables console capture entirely. */
  console: NormalizedCaptureOptions | null;
  /** Null disables network capture entirely. */
  network: NormalizedCaptureOptions | null;
  extraProperties?: SessionReplayOptions["extraProperties"];
}

interface NormalizedCaptureOptions {
  maxEvents: number;
  /** Network-only: capture a bounded 5xx response-body snippet. Unused by console. */
  captureErrorBodies?: boolean;
  /** Network-only: cap (chars) for the captured error-body snippet. */
  maxErrorBodyLength?: number;
}

const DEFAULT_REPLAY_PATH = "/api/analytics/replay";
const DEFAULT_SAMPLING_SALT = "agent-native-session-replay";

/**
 * Default rrweb event throttling. Without this, rrweb captures every
 * mousemove/scroll which dominates event volume and main-thread cost on
 * interactive pages. These caps keep replays faithful while staying light.
 */
const DEFAULT_EVENT_SAMPLING: ReplayEventSampling = {
  mousemove: 50,
  mouseInteraction: true,
  scroll: 100,
  media: 800,
  input: "last",
};
const SESSION_REPLAY_STATE_KEY = Symbol.for(
  "agent-native.client.sessionReplay",
);
const SESSION_REPLAY_ID_STORAGE_KEY = "agent-native.session_replay_id";
const DEFAULT_BLOCK_SELECTOR = [
  "[data-sensitive]",
  "[data-an-block]",
  "[data-an-private]",
  "[data-private]",
  ".an-block",
  ".an-replay-block",
  ".an-private",
  ".rr-block",
  "[autocomplete='cc-number']",
  "[autocomplete='cc-csc']",
  "[autocomplete='cc-exp']",
  "[name*='password' i]",
  "[name*='credit' i]",
  "[name*='card' i]",
  "[name*='ssn' i]",
].join(", ");
const DEFAULT_IGNORE_SELECTOR = ".an-ignore, [data-an-ignore]";
const DEFAULT_MASK_TEXT_CLASS = "an-mask";
const DEFAULT_MASK_TEXT_SELECTOR = "[data-an-mask]";
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_EVENTS_PER_BATCH = 50;
const DEFAULT_MAX_BATCH_BYTES = 256 * 1024;
const MAX_KEEPALIVE_REPLAY_UPLOAD_BYTES = 60 * 1024;
const RRWEB_FULL_SNAPSHOT_EVENT_TYPE = 2;

/** rrweb custom-event tag for captured console/window-error entries. */
export const SESSION_REPLAY_CONSOLE_EVENT_TAG = "agent-native.console";
/** rrweb custom-event tag for captured fetch/XHR request summaries. */
export const SESSION_REPLAY_NETWORK_EVENT_TAG = "agent-native.network";

const DEFAULT_MAX_CONSOLE_EVENTS = 1000;
const DEFAULT_MAX_NETWORK_EVENTS = 2000;
const MAX_CONSOLE_MESSAGE_LENGTH = 500;
const MAX_CONSOLE_ARGS = 10;
const MAX_CONSOLE_STACK_LENGTH = 2000;
const MAX_CONSOLE_SERIALIZE_DEPTH = 4;
const MAX_CONSOLE_SERIALIZE_ENTRIES = 20;
/** Default cap (chars) for a captured 5xx response-body snippet. */
const DEFAULT_MAX_ERROR_BODY_LENGTH = 2048;
/** Hard timeout for the async response-body read; emit without body past this. */
const ERROR_BODY_READ_TIMEOUT_MS = 1500;

/**
 * Re-entrancy guard: true while the recorder itself is emitting custom events
 * or flushing (synchronously) so the console/fetch/XHR wrappers never capture
 * the recorder's own work and feed it back into the replay stream.
 */
let replayCaptureInternal = false;

// Credential-looking token redaction for captured console/network text,
// adapted from the clips template's browser-diagnostics redaction helper.
const CAPTURE_SECRET_KEY_FRAGMENT =
  "(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|session|credential)";
const CAPTURE_AUTHORIZATION_SCHEME_RE =
  /\b(authorization)\b(\s*[:=]\s*)(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const CAPTURE_BEARER_RE = /\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const CAPTURE_DOUBLE_QUOTED_SECRET_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${CAPTURE_SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);
const CAPTURE_SINGLE_QUOTED_SECRET_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${CAPTURE_SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)'(?:[^'\\\\]|\\\\.)*'`,
  "gi",
);
const CAPTURE_UNQUOTED_SECRET_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${CAPTURE_SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)([^"',\\s;}\\]]+)`,
  "gi",
);

function redactCaptureText(value: string): string {
  return value
    .replace(CAPTURE_AUTHORIZATION_SCHEME_RE, "$1$2<redacted>")
    .replace(CAPTURE_BEARER_RE, "$1 <redacted>")
    .replace(CAPTURE_DOUBLE_QUOTED_SECRET_RE, '$1$2$1$3"<redacted>"')
    .replace(CAPTURE_SINGLE_QUOTED_SECRET_RE, "$1$2$1$3'<redacted>'")
    .replace(CAPTURE_UNQUOTED_SECRET_RE, "$1$2$1$3<redacted>");
}
const URL_LIKE_KEYS = new Set([
  "url",
  "uri",
  "href",
  "src",
  "currentUrl",
  "referrer",
  "from",
  "to",
]);

function getState(): SessionReplayState {
  const g = globalThis as typeof globalThis & {
    [SESSION_REPLAY_STATE_KEY]?: SessionReplayState;
  };
  if (!g[SESSION_REPLAY_STATE_KEY]) {
    g[SESSION_REPLAY_STATE_KEY] = {
      active: false,
      startPromise: null,
      replayId: null,
      startedAtMs: null,
      sequence: 0,
      queue: [],
      queuedBytes: 0,
      retryBatches: [],
      flushTimer: null,
      maxDurationTimer: null,
      flushing: false,
      stopRecorder: null,
      restoreUrlMonitor: null,
      removeLifecycleListeners: null,
      addCustomEvent: null,
      restoreCaptures: null,
      options: null,
      lastAuthenticatedProperties: null,
    };
  }
  return g[SESSION_REPLAY_STATE_KEY]!;
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private browsing / storage disabled -- replay still works for this page
  }
}

function generateReplayId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStoredReplaySession(): StoredReplaySession | null {
  const raw = safeStorageGet(SESSION_REPLAY_ID_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredReplaySession;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredReplaySession(value: StoredReplaySession): void {
  safeStorageSet(SESSION_REPLAY_ID_STORAGE_KEY, JSON.stringify(value));
}

function getOrCreateReplaySession(sessionId: string): {
  replayId: string;
  startedAtMs: number;
  sequence: number;
} {
  const parsed = readStoredReplaySession();
  if (parsed?.sessionId === sessionId && parsed.replayId) {
    const startedAtMs =
      typeof parsed.startedAtMs === "number" &&
      Number.isFinite(parsed.startedAtMs) &&
      parsed.startedAtMs > 0
        ? parsed.startedAtMs
        : Date.now();
    const sequence =
      typeof parsed.sequence === "number" &&
      Number.isFinite(parsed.sequence) &&
      parsed.sequence >= 0
        ? Math.floor(parsed.sequence)
        : 0;
    return { replayId: parsed.replayId, startedAtMs, sequence };
  }
  const replayId = generateReplayId();
  const startedAtMs = Date.now();
  writeStoredReplaySession({ sessionId, replayId, startedAtMs, sequence: 0 });
  return { replayId, startedAtMs, sequence: 0 };
}

function persistReplaySequence(
  sessionId: string,
  replayId: string,
  startedAtMs: number | null,
  sequence: number,
): void {
  writeStoredReplaySession({
    sessionId,
    replayId,
    startedAtMs: startedAtMs ?? Date.now(),
    sequence,
  });
}

function clampSamplingRate(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function readEnvString(key: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)?.[key]?.trim();
}

function readEnvNumber(key: string): number | undefined {
  const raw = readEnvString(key);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readEnvBoolean(key: string): boolean | undefined {
  const raw = readEnvString(key);
  if (!raw) return undefined;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return undefined;
}

function readFirstEnvString(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readEnvString(key);
    if (value) return value;
  }
  return undefined;
}

function readFirstEnvNumber(keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readEnvNumber(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function replayEndpointFromAnalyticsEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.pathname.endsWith("/api/analytics/track")) {
      url.pathname = url.pathname.replace(
        /\/api\/analytics\/track$/,
        "/api/analytics/replay",
      );
      return url.toString();
    }
    if (url.pathname.endsWith("/track")) {
      url.pathname = url.pathname.replace(/\/track$/, "/api/analytics/replay");
      return url.toString();
    }
  } catch {
    // Fall through to the relative path cases below.
  }
  if (value.endsWith("/api/analytics/track")) {
    return value.replace(/\/api\/analytics\/track$/, "/api/analytics/replay");
  }
  if (value.endsWith("/track")) {
    return value.replace(/\/track$/, "/api/analytics/replay");
  }
  return null;
}

function defaultReplayEndpoint(): string {
  const analyticsEndpoint = readEnvString(
    "VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT",
  );
  const derived = analyticsEndpoint
    ? replayEndpointFromAnalyticsEndpoint(analyticsEndpoint)
    : null;
  if (derived) return derived;
  return typeof window !== "undefined"
    ? `${window.location.origin}${DEFAULT_REPLAY_PATH}`
    : DEFAULT_REPLAY_PATH;
}

export function getSessionReplaySamplingScore(
  sessionId: string,
  salt = DEFAULT_SAMPLING_SALT,
): number {
  let hash = 2166136261;
  const input = `${salt}:${sessionId}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function shouldSampleSessionReplay(
  sessionId: string,
  sampleRate = 1,
  salt = DEFAULT_SAMPLING_SALT,
): boolean {
  const rate = clampSamplingRate(sampleRate);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return getSessionReplaySamplingScore(sessionId, salt) < rate;
}

function matcherAllows(matcher: SessionReplayUrlMatcher, url: string): boolean {
  if (typeof matcher === "string") return url.includes(matcher);
  if (matcher instanceof RegExp) return matcher.test(url);
  return matcher(url);
}

function isUrlRecordable(
  url: string,
  options: Pick<NormalizedSessionReplayOptions, "allowUrls" | "blockUrls">,
): boolean {
  if (options.allowUrls.length > 0) {
    const allowed = options.allowUrls.some((matcher) =>
      matcherAllows(matcher, url),
    );
    if (!allowed) return false;
  }
  return !options.blockUrls.some((matcher) => matcherAllows(matcher, url));
}

function normalizeOptions(
  options: SessionReplayOptions,
): NormalizedSessionReplayOptions | null {
  const publicKey =
    options.publicKey ||
    readFirstEnvString([
      "VITE_AGENT_NATIVE_SESSION_REPLAY_PUBLIC_KEY",
      "VITE_SESSION_REPLAY_PUBLIC_KEY",
    ]) ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (!publicKey) return null;
  const endpoint =
    options.endpoint ||
    readFirstEnvString([
      "VITE_AGENT_NATIVE_ANALYTICS_REPLAY_ENDPOINT",
      "VITE_AGENT_NATIVE_SESSION_REPLAY_ENDPOINT",
      "VITE_SESSION_REPLAY_INGEST_URL",
    ]) ||
    defaultReplayEndpoint();
  return {
    publicKey,
    endpoint,
    requireSignedInUser:
      options.requireSignedInUser ??
      readEnvBoolean("VITE_AGENT_NATIVE_SESSION_REPLAY_REQUIRE_AUTH") ??
      readEnvBoolean("VITE_SESSION_REPLAY_REQUIRE_AUTH") ??
      false,
    sampleRate: clampSamplingRate(
      options.sampleRate ??
        readFirstEnvNumber([
          "VITE_AGENT_NATIVE_SESSION_REPLAY_SAMPLE_RATE",
          "VITE_SESSION_REPLAY_SAMPLE_RATE",
        ]),
    ),
    samplingSalt: options.samplingSalt || DEFAULT_SAMPLING_SALT,
    allowUrls: options.allowUrls ?? [],
    blockUrls: options.blockUrls ?? [],
    flushIntervalMs: Math.max(
      250,
      options.flushIntervalMs ??
        readFirstEnvNumber([
          "VITE_AGENT_NATIVE_SESSION_REPLAY_CHUNK_INTERVAL_MS",
          "VITE_SESSION_REPLAY_CHUNK_INTERVAL_MS",
        ]) ??
        DEFAULT_FLUSH_INTERVAL_MS,
    ),
    maxDurationMs: Math.max(
      1000,
      options.maxDurationMs ??
        readFirstEnvNumber([
          "VITE_AGENT_NATIVE_SESSION_REPLAY_MAX_DURATION_MS",
          "VITE_SESSION_REPLAY_MAX_DURATION_MS",
        ]) ??
        DEFAULT_MAX_DURATION_MS,
    ),
    maxEventsPerBatch: Math.max(
      1,
      options.maxEventsPerBatch ?? DEFAULT_MAX_EVENTS_PER_BATCH,
    ),
    maxBatchBytes: Math.max(
      1024,
      options.maxBatchBytes ??
        readFirstEnvNumber([
          "VITE_AGENT_NATIVE_SESSION_REPLAY_CHUNK_MAX_BYTES",
          "VITE_SESSION_REPLAY_CHUNK_MAX_BYTES",
        ]) ??
        DEFAULT_MAX_BATCH_BYTES,
    ),
    checkoutEveryNth: options.checkoutEveryNth,
    checkoutEveryNms: options.checkoutEveryNms,
    inlineStylesheet: options.inlineStylesheet ?? true,
    blockSelector: options.blockSelector || DEFAULT_BLOCK_SELECTOR,
    ignoreSelector: options.ignoreSelector || DEFAULT_IGNORE_SELECTOR,
    maskTextClass: options.maskTextClass || DEFAULT_MASK_TEXT_CLASS,
    maskTextSelector: options.maskTextSelector || DEFAULT_MASK_TEXT_SELECTOR,
    maskAllInputs: options.maskAllInputs ?? true,
    recordCanvas: options.recordCanvas ?? false,
    recordCrossOriginIframes: options.recordCrossOriginIframes ?? false,
    collectFonts: options.collectFonts ?? false,
    inlineImages: options.inlineImages ?? false,
    eventSampling: options.eventSampling ?? DEFAULT_EVENT_SAMPLING,
    console: normalizeCaptureToggle(
      options.console,
      DEFAULT_MAX_CONSOLE_EVENTS,
    ),
    network: normalizeCaptureToggle(
      options.network,
      DEFAULT_MAX_NETWORK_EVENTS,
    ),
    extraProperties: options.extraProperties,
  };
}

/**
 * Console/network capture default to ON whenever session replay records;
 * `false` disables a category, an object form overrides its caps. Network
 * options may additionally carry `captureErrorBodies`/`maxErrorBodyLength`;
 * console ignores those fields.
 */
function normalizeCaptureToggle(
  value: boolean | SessionReplayNetworkOptions | undefined,
  defaultMaxEvents: number,
): NormalizedCaptureOptions | null {
  if (value === false) return null;
  const overrides = typeof value === "object" && value !== null ? value : {};
  const maxEvents =
    typeof overrides.maxEvents === "number" &&
    Number.isFinite(overrides.maxEvents)
      ? Math.max(1, Math.floor(overrides.maxEvents))
      : defaultMaxEvents;
  const maxErrorBodyLength =
    typeof overrides.maxErrorBodyLength === "number" &&
    Number.isFinite(overrides.maxErrorBodyLength)
      ? Math.max(0, Math.floor(overrides.maxErrorBodyLength))
      : DEFAULT_MAX_ERROR_BODY_LENGTH;
  return {
    maxEvents,
    captureErrorBodies: overrides.captureErrorBodies !== false,
    maxErrorBodyLength,
  };
}

function scrubStringValue(key: string, value: string): string {
  const lowerKey = key.toLowerCase();
  const isUrlKey = URL_LIKE_KEYS.has(key) || URL_LIKE_KEYS.has(lowerKey);
  if (
    isUrlKey ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/")
  ) {
    return scrubUrl(value) ?? value;
  }
  return value;
}

function scrubReplayValue(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return scrubStringValue(key, value);
  if (!value || typeof value !== "object") return value;
  if (depth > 12) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubReplayValue(item, key, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = scrubReplayValue(childValue, childKey, depth + 1, seen);
  }
  return out;
}

/**
 * JSON.stringify replacer that scrubs URL-like string values inline. Folding
 * the scrub into the single serialization pass avoids a separate deep-clone of
 * every emitted event (FullSnapshots are large DOM trees) on the hot path.
 */
function scrubReplayReplacer(key: string, value: unknown): unknown {
  return typeof value === "string" ? scrubStringValue(key, value) : value;
}

/**
 * Serialize + scrub one event in a single pass. The resulting string is stored
 * directly on the queue and reused verbatim at flush, so each event is
 * stringified exactly once (was: deep-clone + size-stringify + flush-stringify).
 */
function serializeReplayEvent(event: ReplayEvent): string {
  try {
    return JSON.stringify(event, scrubReplayReplacer);
  } catch {
    return "";
  }
}

function replayEventTimestampMs(event: ReplayEvent): number {
  const timestamp = event.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function enqueueReplayEvent(
  state: SessionReplayState,
  event: ReplayEvent,
): void {
  if (!state.options) return;
  const serialized = serializeReplayEvent(event);
  if (!serialized) return;
  const estimatedBytes = serialized.length;
  if (
    state.queue.length > 0 &&
    state.queuedBytes + estimatedBytes > state.options.maxBatchBytes
  ) {
    void flushSessionReplay("max-bytes");
  }
  state.queue.push({
    json: serialized,
    timestampMs: replayEventTimestampMs(event),
    type: typeof event.type === "number" ? event.type : null,
  });
  state.queuedBytes += estimatedBytes;
  flushQueuedReplayIfNeeded(state);
}

function replayExtraProperties(
  options: NormalizedSessionReplayOptions,
): Record<string, unknown> | undefined {
  const source = options.extraProperties;
  if (!source) return undefined;
  try {
    const props = typeof source === "function" ? source() : source;
    if (!props || typeof props !== "object") return undefined;
    return scrubReplayValue(props) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function replayString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function replayEmail(value: unknown): string | undefined {
  const raw = replayString(value);
  return raw && raw.includes("@") ? raw : undefined;
}

function replayUserEmail(
  properties: Record<string, unknown> | undefined,
): string | undefined {
  return (
    replayEmail(properties?.userEmail ?? properties?.user_email) ||
    replayEmail(properties?.email) ||
    replayEmail(properties?.userId ?? properties?.user_id)
  );
}

function replayPropertiesForUpload(
  state: SessionReplayState,
  options: NormalizedSessionReplayOptions,
): Record<string, unknown> | undefined {
  const properties = replayExtraProperties(options);
  if (replayUserEmail(properties)) {
    state.lastAuthenticatedProperties = properties ? { ...properties } : null;
    return properties;
  }
  if (options.requireSignedInUser && state.lastAuthenticatedProperties) {
    return state.lastAuthenticatedProperties;
  }
  return properties;
}

interface ReplayUploadPayload {
  body: string;
  replayId: string;
  sessionId: string;
  sequence: number;
}

function buildReplayBody(
  state: SessionReplayState,
  reason: string,
  events: QueuedReplayEvent[],
): ReplayUploadPayload | null {
  const options = state.options;
  if (!options || !state.replayId) return null;
  const sessionId = getAnalyticsSessionId();
  if (!sessionId) return null;
  const properties = replayPropertiesForUpload(state, options);
  const userEmail = replayUserEmail(properties);
  if (options.requireSignedInUser && !userEmail) return null;
  const userId =
    userEmail || replayString(properties?.userId ?? properties?.user_id);
  const eventTimestamps = events.map((event) => event.timestampMs);
  const nowMs = Date.now();
  const startedAtMs =
    state.startedAtMs ??
    (eventTimestamps.length ? Math.min(...eventTimestamps) : nowMs);
  const endedAtMs = eventTimestamps.length
    ? Math.max(...eventTimestamps)
    : nowMs;
  const envelope = {
    publicKey: options.publicKey,
    type: "session_replay",
    replayId: state.replayId,
    sessionId,
    ...(userId ? { userId } : {}),
    ...(userEmail ? { userEmail } : {}),
    anonymousId: getAnalyticsAnonymousId(),
    sequence: state.sequence,
    reason,
    status: isFinalFlushReason(reason) ? "completed" : "active",
    eventCount: events.length,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    privacyMode: "mask-inputs-and-selected-text",
    url:
      typeof window !== "undefined"
        ? scrubUrl(window.location.href)
        : undefined,
    timestamp: new Date().toISOString(),
    properties,
  };
  // Events are already serialized+scrubbed JSON strings; splice them into the
  // envelope without re-serializing the (potentially large) events array.
  const envelopeJson = JSON.stringify(envelope);
  return {
    body: `${envelopeJson.slice(0, -1)},"events":[${events
      .map((event) => event.json)
      .join(",")}]}`,
    replayId: state.replayId,
    sessionId,
    sequence: state.sequence,
  };
}

interface ReplayUploadBody {
  body: BodyInit;
  headers: Record<string, string>;
  compressed: boolean;
}

function isCrossOriginReplayEndpoint(endpoint: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      new URL(endpoint, window.location.href).origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

async function gzipReplayBody(body: string): Promise<Blob | null> {
  if (
    typeof CompressionStream === "undefined" ||
    typeof Blob === "undefined" ||
    typeof Response === "undefined"
  ) {
    return null;
  }
  try {
    const stream = new Blob([body], { type: "application/json" })
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const compressed = await new Response(stream).arrayBuffer();
    return new Blob([compressed], { type: "application/octet-stream" });
  } catch {
    return null;
  }
}

async function buildReplayUploadBody(body: string): Promise<ReplayUploadBody> {
  const compressed = await gzipReplayBody(body);
  if (compressed) {
    return {
      body: compressed,
      compressed: true,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "gzip",
      },
    };
  }
  return {
    body,
    compressed: false,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
  };
}

function replayUploadBodyBytes(body: BodyInit): number {
  if (typeof body === "string") {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(body).byteLength;
    }
    return body.length;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body.size;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return MAX_KEEPALIVE_REPLAY_UPLOAD_BYTES + 1;
}

function canUseReplayKeepalive(body: BodyInit): boolean {
  return replayUploadBodyBytes(body) <= MAX_KEEPALIVE_REPLAY_UPLOAD_BYTES;
}

async function sendReplayUpload(
  options: NormalizedSessionReplayOptions,
  body: string,
  callbacks: { beforeKeepaliveUpload?: () => void } = {},
): Promise<void> {
  if (isCrossOriginReplayEndpoint(options.endpoint)) {
    const canUseKeepalive = canUseReplayKeepalive(body);
    if (canUseKeepalive) callbacks.beforeKeepaliveUpload?.();
    const response = await fetch(options.endpoint, {
      method: "POST",
      body,
      keepalive: canUseKeepalive,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    });
    if (!response.ok) {
      throw new Error(
        `Session replay upload failed with HTTP ${response.status}`,
      );
    }
    return;
  }

  const upload = await buildReplayUploadBody(body);
  const canUseKeepalive = canUseReplayKeepalive(upload.body);
  if (canUseKeepalive) callbacks.beforeKeepaliveUpload?.();
  const response = await fetch(options.endpoint, {
    method: "POST",
    body: upload.body,
    keepalive: canUseKeepalive,
    headers: {
      ...upload.headers,
      "X-Agent-Native-Analytics-Key": options.publicKey,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Session replay upload failed with HTTP ${response.status}`,
    );
  }
}

function isFinalFlushReason(reason: string): boolean {
  return [
    "auth-cleared",
    "manual",
    "pagehide",
    "beforeunload",
    "url-blocked",
    "max-duration",
  ].includes(reason);
}

function shouldReserveSequenceBeforeKeepalive(reason: string): boolean {
  return (
    reason === "pagehide" ||
    reason === "beforeunload" ||
    reason === "visibility-hidden"
  );
}

function hasFullSnapshot(events: QueuedReplayEvent[]): boolean {
  return events.some((event) => event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE);
}

function hasPendingReplayBatch(state: SessionReplayState): boolean {
  return state.retryBatches.length > 0 || state.queue.length > 0;
}

function shouldFlushQueuedReplay(state: SessionReplayState): boolean {
  if (!state.options || state.queue.length === 0) return false;
  return (
    hasFullSnapshot(state.queue) ||
    state.queue.length >= state.options.maxEventsPerBatch ||
    state.queuedBytes >= state.options.maxBatchBytes
  );
}

function flushQueuedReplayIfNeeded(state: SessionReplayState): void {
  const options = state.options;
  if (!options) return;
  if (state.retryBatches.length > 0) return;
  if (!shouldFlushQueuedReplay(state)) return;
  const reason = hasFullSnapshot(state.queue)
    ? "full-snapshot"
    : state.queue.length >= options.maxEventsPerBatch
      ? "max-events"
      : "max-bytes";
  void flushSessionReplay(reason);
}

function queuedReplayBytes(events: QueuedReplayEvent[]): number {
  return events.reduce((total, event) => total + event.json.length, 0);
}

function restoreReplayEvents(
  state: SessionReplayState,
  events: QueuedReplayEvent[],
): void {
  state.retryBatches.unshift(events);
}

function advanceReplaySequence(
  state: SessionReplayState,
  payload: ReplayUploadPayload,
): void {
  if (state.replayId !== payload.replayId) return;
  state.sequence = Math.max(state.sequence, payload.sequence + 1);
  persistReplaySequence(
    payload.sessionId,
    payload.replayId,
    state.startedAtMs,
    state.sequence,
  );
}

function rollbackReplaySequenceReservation(
  state: SessionReplayState,
  payload: ReplayUploadPayload,
): void {
  if (state.replayId !== payload.replayId) return;
  if (state.sequence !== payload.sequence + 1) return;
  state.sequence = payload.sequence;
  persistReplaySequence(
    payload.sessionId,
    payload.replayId,
    state.startedAtMs,
    state.sequence,
  );
}

export async function flushSessionReplay(reason = "manual"): Promise<void> {
  const state = getState();
  if (!state.options || !hasPendingReplayBatch(state) || state.flushing) return;
  const events = state.retryBatches.shift() ?? state.queue.splice(0);
  state.queuedBytes = queuedReplayBytes(state.queue);
  const payload = buildReplayBody(state, reason, events);
  if (!payload || !state.options) {
    restoreReplayEvents(state, events);
    return;
  }
  state.flushing = true;
  let uploaded = false;
  let reservedSequence = false;
  try {
    await sendReplayUpload(state.options, payload.body, {
      beforeKeepaliveUpload: shouldReserveSequenceBeforeKeepalive(reason)
        ? () => {
            advanceReplaySequence(state, payload);
            reservedSequence = true;
          }
        : undefined,
    });
    if (!reservedSequence) advanceReplaySequence(state, payload);
    uploaded = true;
  } catch (error) {
    if (reservedSequence) rollbackReplaySequenceReservation(state, payload);
    restoreReplayEvents(state, events);
    // Guard the recorder's own warning so console capture never records it
    // (a captured warning would enqueue an event and retrigger a flush).
    const previousInternal = replayCaptureInternal;
    replayCaptureInternal = true;
    try {
      console.warn("[session-replay] upload failed", error);
    } finally {
      replayCaptureInternal = previousInternal;
    }
  } finally {
    state.flushing = false;
  }
  if (uploaded && hasPendingReplayBatch(state)) {
    flushQueuedReplayIfNeeded(state);
  }
}

function installUrlMonitor(state: SessionReplayState): void {
  if (!state.options || state.restoreUrlMonitor) return;
  const options = state.options;
  const check = () => {
    if (!isUrlRecordable(window.location.href, options)) {
      stopSessionReplay("url-blocked");
    }
  };
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    queueMicrotask(check);
    return result;
  };
  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    queueMicrotask(check);
    return result;
  };
  window.addEventListener("popstate", check);
  state.restoreUrlMonitor = () => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", check);
    state.restoreUrlMonitor = null;
  };
}

function installLifecycleListeners(state: SessionReplayState): void {
  if (state.removeLifecycleListeners) return;
  const flushOnHidden = () => {
    if (document.visibilityState === "hidden") {
      void flushSessionReplay("visibility-hidden");
    }
  };
  const flushOnUnload = () => {
    void flushSessionReplay("pagehide");
  };
  document.addEventListener("visibilitychange", flushOnHidden);
  window.addEventListener("pagehide", flushOnUnload);
  state.removeLifecycleListeners = () => {
    document.removeEventListener("visibilitychange", flushOnHidden);
    window.removeEventListener("pagehide", flushOnUnload);
    state.removeLifecycleListeners = null;
  };
}

function truncateCaptureText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Circular-safe, depth/length-limited plain value for JSON.stringify. */
function toCaptureSerializable(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_CONSOLE_SERIALIZE_DEPTH) {
    return Array.isArray(value) ? "[array]" : "[object]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_CONSOLE_SERIALIZE_ENTRIES)
      .map((item) => toCaptureSerializable(item, depth + 1, seen));
    if (value.length > MAX_CONSOLE_SERIALIZE_ENTRIES) items.push("[truncated]");
    return items;
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (count >= MAX_CONSOLE_SERIALIZE_ENTRIES) {
      out["[truncated]"] = true;
      break;
    }
    out[key] = toCaptureSerializable(child, depth + 1, seen);
    count += 1;
  }
  return out;
}

function serializeConsoleArg(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (
      value === null ||
      value === undefined ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }
    return (
      JSON.stringify(toCaptureSerializable(value, 0, new WeakSet())) ??
      String(value)
    );
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/**
 * Emit an rrweb custom event while recording. Sets the re-entrancy guard so
 * synchronous work triggered by the emit (enqueue -> flush -> fetch of the
 * ingest endpoint) is never re-captured by the interceptors below.
 */
function emitReplayCustomEvent(
  state: SessionReplayState,
  tag: string,
  payload: Record<string, unknown>,
): void {
  const addCustomEvent = state.addCustomEvent;
  if (!state.active || !addCustomEvent) return;
  const previous = replayCaptureInternal;
  replayCaptureInternal = true;
  try {
    addCustomEvent(tag, payload);
  } catch {
    // recorder already stopped -- drop the event
  } finally {
    replayCaptureInternal = previous;
  }
}

function captureCurrentUrl(): string | undefined {
  try {
    return scrubUrl(window.location.href);
  } catch {
    return undefined;
  }
}

type CaptureConsoleLevel = "log" | "info" | "warn" | "error" | "debug";
type CaptureConsoleSource = "console" | "window-error" | "unhandledrejection";

const CAPTURE_CONSOLE_LEVELS: CaptureConsoleLevel[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
];

function installConsoleCapture(
  state: SessionReplayState,
  captureOptions: NormalizedCaptureOptions,
): () => void {
  let emitted = 0;
  let stopped = false;
  let pending: {
    key: string;
    payload: Record<string, unknown>;
    repeat: number;
  } | null = null;

  const emitPayload = (payload: Record<string, unknown>) => {
    if (stopped) return;
    if (emitted >= captureOptions.maxEvents) {
      stopped = true;
      emitReplayCustomEvent(state, SESSION_REPLAY_CONSOLE_EVENT_TAG, {
        level: "warn",
        source: "console",
        message: "session replay console capture truncated",
        truncated: true,
      });
      return;
    }
    emitted += 1;
    emitReplayCustomEvent(state, SESSION_REPLAY_CONSOLE_EVENT_TAG, payload);
  };

  /**
   * The first occurrence of a message is emitted immediately; consecutive
   * identical messages accumulate here and are flushed as one event whose
   * `repeat` is the number of collapsed duplicates.
   */
  const flushPending = () => {
    const entry = pending;
    pending = null;
    if (!entry || entry.repeat <= 0) return;
    emitPayload({ ...entry.payload, repeat: entry.repeat });
  };

  const capture = (
    level: CaptureConsoleLevel,
    source: CaptureConsoleSource,
    args: unknown[],
    stackOverride?: string,
  ) => {
    if (stopped || replayCaptureInternal) return;
    try {
      const message = truncateCaptureText(
        redactCaptureText(args.length ? serializeConsoleArg(args[0]) : ""),
        MAX_CONSOLE_MESSAGE_LENGTH,
      );
      const extraArgs = args
        .slice(1, 1 + MAX_CONSOLE_ARGS)
        .map((arg) =>
          truncateCaptureText(
            redactCaptureText(serializeConsoleArg(arg)),
            MAX_CONSOLE_MESSAGE_LENGTH,
          ),
        );
      const errorArg = args.find((arg): arg is Error => arg instanceof Error);
      const rawStack = stackOverride ?? errorArg?.stack;
      const stack =
        typeof rawStack === "string" && rawStack
          ? truncateCaptureText(
              redactCaptureText(rawStack),
              MAX_CONSOLE_STACK_LENGTH,
            )
          : undefined;
      const url = captureCurrentUrl();
      const payload: Record<string, unknown> = {
        level,
        source,
        message,
        ...(extraArgs.length ? { args: extraArgs } : {}),
        ...(stack ? { stack } : {}),
        ...(url ? { url } : {}),
      };
      const key = `${level} ${source} ${message}`;
      if (pending && pending.key === key) {
        pending.repeat += 1;
        return;
      }
      flushPending();
      emitPayload(payload);
      pending = { key, payload, repeat: 0 };
    } catch {
      // capture must never break the host page
    }
  };

  const originals: Partial<
    Record<CaptureConsoleLevel, (...args: unknown[]) => void>
  > = {};
  const wrappers: Partial<
    Record<CaptureConsoleLevel, (...args: unknown[]) => void>
  > = {};
  for (const level of CAPTURE_CONSOLE_LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    if (typeof original !== "function") continue;
    originals[level] = original;
    const wrapper = (...args: unknown[]) => {
      original.apply(console, args);
      try {
        capture(level, "console", args);
      } catch {
        // never throw from the wrapper
      }
    };
    wrappers[level] = wrapper;
    console[level] = wrapper;
  }

  const onWindowError = (event: ErrorEvent) => {
    try {
      const error = event?.error;
      capture(
        "error",
        "window-error",
        [error instanceof Error ? error : (event?.message ?? "Error")],
        error instanceof Error ? error.stack : undefined,
      );
    } catch {
      // never throw from the listener
    }
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    try {
      const reason = event?.reason;
      capture(
        "error",
        "unhandledrejection",
        [reason instanceof Error ? reason : reason],
        reason instanceof Error ? reason.stack : undefined,
      );
    } catch {
      // never throw from the listener
    }
  };
  window.addEventListener("error", onWindowError as EventListener);
  window.addEventListener(
    "unhandledrejection",
    onUnhandledRejection as EventListener,
  );

  return () => {
    try {
      flushPending();
    } catch {
      // best-effort duplicate flush
    }
    stopped = true;
    for (const level of CAPTURE_CONSOLE_LEVELS) {
      const original = originals[level];
      // Restore only what we installed: if another library patched on top of
      // our wrapper, leave the current function in place.
      if (original && console[level] === wrappers[level]) {
        console[level] = original;
      }
    }
    window.removeEventListener("error", onWindowError as EventListener);
    window.removeEventListener(
      "unhandledrejection",
      onUnhandledRejection as EventListener,
    );
  };
}

function captureRequestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) {
    return input.toString();
  }
  if (input && typeof input === "object" && "url" in input) {
    const url = (input as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return "";
}

function captureRequestMethod(
  input: unknown,
  init?: { method?: unknown },
): string {
  const initMethod = init?.method;
  if (typeof initMethod === "string" && initMethod) {
    return initMethod.toUpperCase();
  }
  if (input && typeof input === "object" && "method" in input) {
    const method = (input as { method?: unknown }).method;
    if (typeof method === "string" && method) return method.toUpperCase();
  }
  return "GET";
}

/**
 * Requests the recorder must never record: its own ingest endpoint and the
 * core analytics tracking endpoint (either would create a flush -> event ->
 * flush feedback loop), plus non-network schemes.
 */
function isCaptureExcludedUrl(rawUrl: string, ingestEndpoint: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("about:")
  ) {
    return true;
  }
  try {
    const resolved = new URL(trimmed, window.location.href);
    const ingest = new URL(ingestEndpoint, window.location.href);
    if (
      resolved.origin === ingest.origin &&
      resolved.pathname === ingest.pathname
    ) {
      return true;
    }
    if (resolved.pathname.endsWith("/api/analytics/replay")) return true;
    if (resolved.pathname.endsWith("/api/analytics/track")) return true;
  } catch {
    // Unresolvable URL -- skip capture rather than risk recording junk.
    return true;
  }
  return false;
}

/**
 * Best-effort, synchronous read of a 5xx XHR response body, sliced to `cap`
 * before redaction runs (caller redacts). Only reads `responseText` when
 * `responseType` is "" or "text" -- other response types are read via
 * `JSON.stringify` (guarded) for `"json"`, and skipped entirely otherwise
 * since arbitrary binary/blob/arraybuffer bodies are not useful error text.
 */
function readXhrErrorBody(
  xhr: XMLHttpRequest,
  cap: number,
): string | undefined {
  try {
    const responseType = xhr.responseType;
    if (responseType === "" || responseType === "text") {
      const text = xhr.responseText;
      return typeof text === "string" ? text.slice(0, cap) : undefined;
    }
    if (responseType === "json") {
      try {
        return JSON.stringify(xhr.response)?.slice(0, cap);
      } catch {
        return undefined;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function installNetworkCapture(
  state: SessionReplayState,
  captureOptions: NormalizedCaptureOptions,
): () => void {
  const options = state.options;
  if (!options) return () => {};
  const ingestEndpoint = options.endpoint;
  let emitted = 0;
  let stopped = false;

  const emitPayload = (payload: Record<string, unknown>) => {
    if (stopped) return;
    if (emitted >= captureOptions.maxEvents) {
      stopped = true;
      emitReplayCustomEvent(state, SESSION_REPLAY_NETWORK_EVENT_TAG, {
        message: "session replay network capture truncated",
        truncated: true,
      });
      return;
    }
    emitted += 1;
    emitReplayCustomEvent(state, SESSION_REPLAY_NETWORK_EVENT_TAG, payload);
  };

  const errorBodyCap =
    captureOptions.captureErrorBodies !== false
      ? (captureOptions.maxErrorBodyLength ?? DEFAULT_MAX_ERROR_BODY_LENGTH)
      : null;

  const recordRequest = (
    api: "fetch" | "xhr",
    method: string,
    rawUrl: string,
    status: number,
    ok: boolean,
    durationMs: number,
    error?: string,
    responseBody?: string,
  ) => {
    if (stopped) return;
    try {
      if (isCaptureExcludedUrl(rawUrl, ingestEndpoint)) return;
      const absolute = new URL(rawUrl, window.location.href).toString();
      const url = scrubUrl(absolute) ?? absolute;
      emitPayload({
        api,
        method: method.toUpperCase(),
        url,
        status,
        ok,
        durationMs: Math.max(0, Math.round(durationMs)),
        ...(error
          ? {
              error: truncateCaptureText(
                redactCaptureText(error),
                MAX_CONSOLE_MESSAGE_LENGTH,
              ),
            }
          : {}),
        ...(responseBody
          ? {
              responseBody: truncateCaptureText(
                redactCaptureText(responseBody),
                errorBodyCap ?? DEFAULT_MAX_ERROR_BODY_LENGTH,
              ),
            }
          : {}),
      });
    } catch {
      // capture must never break the host page
    }
  };

  /**
   * Best-effort bounded read of a 5xx response body. Reads a decoded stream
   * up to `cap` chars and cancels the reader, or falls back to `.text()`
   * sliced to `cap` when no readable stream is exposed. Never throws --
   * opaque/no-body responses (or any read failure) resolve to undefined.
   */
  const readBoundedErrorBody = async (
    response: Response,
    cap: number,
  ): Promise<string | undefined> => {
    try {
      const reader = response.body?.getReader?.();
      if (reader) {
        const decoder = new TextDecoder();
        let text = "";
        while (text.length < cap) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) text += decoder.decode(value, { stream: true });
        }
        // Fire-and-forget: cancelling an already-exhausted (or still-open but
        // no-longer-wanted) reader can hang indefinitely on some stream
        // implementations. We never need the result, so don't await it --
        // that would defeat the whole point of bounding this read.
        try {
          reader.cancel().catch(() => {});
        } catch {
          // best-effort; some readers throw synchronously instead
        }
        return text.slice(0, cap);
      }
      const text = await response.text();
      return text.slice(0, cap);
    } catch {
      return undefined;
    }
  };

  const restores: Array<() => void> = [];

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    const wrappedFetch = function (
      this: unknown,
      input?: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const self = this ?? window;
      if (stopped || replayCaptureInternal) {
        return originalFetch.call(self, input as RequestInfo | URL, init);
      }
      let method = "GET";
      let url = "";
      let skip = true;
      try {
        method = captureRequestMethod(input, init);
        url = captureRequestUrl(input);
        skip = isCaptureExcludedUrl(url, ingestEndpoint);
      } catch {
        skip = true;
      }
      if (skip) {
        return originalFetch.call(self, input as RequestInfo | URL, init);
      }
      const startedAt = performance.now();
      // Call the original exactly as the page did; never read the caller's
      // response before returning it, never replace the response, propagate
      // rejections untouched. A 5xx body snippet (if any) is read from a
      // clone and emitted from a detached promise chain afterward.
      const result = originalFetch.call(self, input as RequestInfo | URL, init);
      if (!result || typeof (result as Promise<Response>).then !== "function") {
        return result;
      }
      return result.then(
        (response) => {
          try {
            const durationMs = performance.now() - startedAt;
            if (errorBodyCap !== null && response.status >= 500) {
              // Clone immediately -- before any other code (including this
              // handler returning) can consume the original body -- so the
              // clone's stream is guaranteed unconsumed.
              let clone: Response | null = null;
              try {
                clone = response.clone();
              } catch {
                clone = null;
              }
              if (clone) {
                const bodyPromise = readBoundedErrorBody(clone, errorBodyCap);
                const timeoutPromise = new Promise<undefined>((resolve) => {
                  setTimeout(
                    () => resolve(undefined),
                    ERROR_BODY_READ_TIMEOUT_MS,
                  );
                });
                // Detached chain: never rejects, never awaited by the caller.
                Promise.race([bodyPromise, timeoutPromise])
                  .then((responseBody) => {
                    recordRequest(
                      "fetch",
                      method,
                      url,
                      response.status,
                      response.ok,
                      durationMs,
                      undefined,
                      responseBody,
                    );
                  })
                  .catch(() => {
                    // never affect the caller
                  });
              } else {
                recordRequest(
                  "fetch",
                  method,
                  url,
                  response.status,
                  response.ok,
                  durationMs,
                );
              }
            } else {
              recordRequest(
                "fetch",
                method,
                url,
                response.status,
                response.ok,
                durationMs,
              );
            }
          } catch {
            // never affect the caller
          }
          return response;
        },
        (error) => {
          try {
            recordRequest(
              "fetch",
              method,
              url,
              0,
              false,
              performance.now() - startedAt,
              error instanceof Error ? error.message : String(error),
            );
          } catch {
            // never affect the caller
          }
          throw error;
        },
      );
    };
    window.fetch = wrappedFetch as typeof window.fetch;
    restores.push(() => {
      // Restore only what we installed (another lib may have patched on top).
      if (window.fetch === (wrappedFetch as typeof window.fetch)) {
        window.fetch = originalFetch;
      }
    });
  }

  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const xhrInfo = new WeakMap<
      XMLHttpRequest,
      { method: string; url: string }
    >();

    const wrappedOpen = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      try {
        xhrInfo.set(this, { method: String(method), url: String(url) });
      } catch {
        // never throw from the wrapper
      }
      return originalOpen.call(
        this,
        method,
        url as string,
        async ?? true,
        username,
        password,
      );
    };

    const wrappedSend = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      try {
        const info = xhrInfo.get(this);
        if (info && !stopped && !replayCaptureInternal) {
          const startedAt = performance.now();
          let errorMessage: string | undefined;
          const markError = (message: string) => () => {
            errorMessage = message;
          };
          this.addEventListener("error", markError("XMLHttpRequest failed"), {
            once: true,
          });
          this.addEventListener("abort", markError("XMLHttpRequest aborted"), {
            once: true,
          });
          this.addEventListener(
            "timeout",
            markError("XMLHttpRequest timed out"),
            { once: true },
          );
          this.addEventListener(
            "loadend",
            () => {
              const status = typeof this.status === "number" ? this.status : 0;
              const effectiveStatus = errorMessage ? 0 : status;
              let responseBody: string | undefined;
              if (errorBodyCap !== null && !errorMessage && status >= 500) {
                responseBody = readXhrErrorBody(this, errorBodyCap);
              }
              recordRequest(
                "xhr",
                info.method,
                info.url,
                effectiveStatus,
                !errorMessage && status >= 200 && status < 300,
                performance.now() - startedAt,
                errorMessage,
                responseBody,
              );
              xhrInfo.delete(this);
            },
            { once: true },
          );
        }
      } catch {
        // never throw from the wrapper
      }
      return originalSend.call(this, body ?? null);
    };

    XMLHttpRequest.prototype.open =
      wrappedOpen as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send =
      wrappedSend as typeof XMLHttpRequest.prototype.send;
    restores.push(() => {
      if (
        XMLHttpRequest.prototype.open ===
        (wrappedOpen as typeof XMLHttpRequest.prototype.open)
      ) {
        XMLHttpRequest.prototype.open = originalOpen;
      }
      if (
        XMLHttpRequest.prototype.send ===
        (wrappedSend as typeof XMLHttpRequest.prototype.send)
      ) {
        XMLHttpRequest.prototype.send = originalSend;
      }
    });
  }

  return () => {
    stopped = true;
    for (const restore of restores) {
      try {
        restore();
      } catch {
        // best-effort restore
      }
    }
  };
}

function installCaptureInterceptors(state: SessionReplayState): void {
  const options = state.options;
  if (!options || state.restoreCaptures || !state.addCustomEvent) return;
  if (!options.console && !options.network) return;
  const restores: Array<() => void> = [];
  try {
    if (options.console) {
      restores.push(installConsoleCapture(state, options.console));
    }
    if (options.network) {
      restores.push(installNetworkCapture(state, options.network));
    }
  } catch {
    // keep whatever installed cleanly; restores below still uninstall it
  }
  if (restores.length === 0) return;
  state.restoreCaptures = () => {
    state.restoreCaptures = null;
    for (const restore of restores) {
      try {
        restore();
      } catch {
        // best-effort restore
      }
    }
  };
}

export async function startSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  if (options.enabled === false) return { started: false, reason: "disabled" };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { started: false, reason: "not-browser" };
  }
  const normalized = normalizeOptions(options);
  if (!normalized) return { started: false, reason: "missing-public-key" };

  const sessionId = getAnalyticsSessionId();
  if (!sessionId) return { started: false, reason: "missing-session-id" };
  const sampled = shouldSampleSessionReplay(
    sessionId,
    normalized.sampleRate,
    normalized.samplingSalt,
  );
  if (!sampled) {
    return { started: false, reason: "sampled-out", sessionId, sampled };
  }
  const initialProperties = replayExtraProperties(normalized);
  if (normalized.requireSignedInUser) {
    if (!replayUserEmail(initialProperties)) {
      return {
        started: false,
        reason: "missing-user-id",
        sessionId,
        sampled,
      };
    }
  }
  if (!isUrlRecordable(window.location.href, normalized)) {
    return { started: false, reason: "url-blocked", sessionId, sampled };
  }

  const state = getState();
  if (state.active && state.replayId) {
    return {
      started: true,
      reason: "already-active",
      replayId: state.replayId,
      sessionId,
      sampled,
    };
  }
  if (state.startPromise) return state.startPromise;

  let startPromise: Promise<SessionReplayStartResult>;
  startPromise = startSessionReplayRecorder(
    state,
    normalized,
    sessionId,
    sampled,
    initialProperties,
  ).finally(() => {
    if (state.startPromise === startPromise) {
      state.startPromise = null;
    }
  });
  state.startPromise = startPromise;
  return startPromise;
}

async function startSessionReplayRecorder(
  state: SessionReplayState,
  normalized: NormalizedSessionReplayOptions,
  sessionId: string,
  sampled: boolean,
  initialProperties: Record<string, unknown> | undefined,
): Promise<SessionReplayStartResult> {
  if (state.active && state.replayId) {
    return {
      started: true,
      reason: "already-active",
      replayId: state.replayId,
      sessionId,
      sampled,
    };
  }

  let rrweb: RrwebRecordModule;
  try {
    rrweb = (await import("@rrweb/record")) as RrwebRecordModule;
  } catch {
    return { started: false, reason: "import-failed", sessionId, sampled };
  }

  const replaySession = getOrCreateReplaySession(sessionId);
  state.options = normalized;
  state.replayId = replaySession.replayId;
  state.startedAtMs = replaySession.startedAtMs;
  state.sequence = replaySession.sequence;
  state.queue = [];
  state.queuedBytes = 0;
  state.retryBatches = [];
  state.stopRecorder = null;
  state.lastAuthenticatedProperties = replayUserEmail(initialProperties)
    ? { ...initialProperties }
    : null;
  state.active = true;

  try {
    const stopRecorder = rrweb.record({
      emit: (event) => enqueueReplayEvent(state, event),
      sampling: normalized.eventSampling,
      checkoutEveryNth: normalized.checkoutEveryNth,
      checkoutEveryNms: normalized.checkoutEveryNms,
      inlineStylesheet: normalized.inlineStylesheet,
      blockSelector: normalized.blockSelector,
      ignoreSelector: normalized.ignoreSelector,
      maskTextClass: normalized.maskTextClass,
      maskTextSelector: normalized.maskTextSelector,
      maskAllInputs: normalized.maskAllInputs,
      recordCanvas: normalized.recordCanvas,
      recordCrossOriginIframes: normalized.recordCrossOriginIframes,
      collectFonts: normalized.collectFonts,
      inlineImages: normalized.inlineImages,
      maskInputOptions: {
        color: true,
        date: true,
        "datetime-local": true,
        email: true,
        month: true,
        number: true,
        password: true,
        range: true,
        search: true,
        tel: true,
        text: true,
        time: true,
        url: true,
        week: true,
      },
    });
    if (typeof stopRecorder !== "function") {
      state.active = false;
      state.options = null;
      state.replayId = null;
      state.startedAtMs = null;
      state.lastAuthenticatedProperties = null;
      return { started: false, reason: "record-failed", sessionId, sampled };
    }
    state.stopRecorder = stopRecorder;
    state.flushTimer = window.setInterval(
      () => void flushSessionReplay("interval"),
      normalized.flushIntervalMs,
    );
    state.maxDurationTimer = window.setTimeout(
      () => stopSessionReplay("max-duration"),
      normalized.maxDurationMs,
    );
    installUrlMonitor(state);
    installLifecycleListeners(state);
    state.addCustomEvent =
      typeof rrweb.record.addCustomEvent === "function"
        ? rrweb.record.addCustomEvent
        : null;
    installCaptureInterceptors(state);
    return {
      started: true,
      replayId: state.replayId,
      sessionId,
      sampled,
    };
  } catch {
    try {
      state.restoreCaptures?.();
    } catch {
      // best-effort interceptor teardown
    }
    state.restoreCaptures = null;
    state.addCustomEvent = null;
    state.active = false;
    state.options = null;
    state.replayId = null;
    state.startedAtMs = null;
    state.lastAuthenticatedProperties = null;
    return { started: false, reason: "record-failed", sessionId, sampled };
  }
}

export async function stopSessionReplay(reason = "manual"): Promise<void> {
  const state = getState();
  if (!state.active) return;
  // Restore console/fetch/XHR before tearing down the recorder: the restore
  // flushes any pending collapsed console duplicate, which must still be able
  // to emit through rrweb while it is recording.
  try {
    state.restoreCaptures?.();
  } catch {
    // best-effort interceptor teardown
  }
  state.restoreCaptures = null;
  state.active = false;
  state.addCustomEvent = null;
  try {
    state.stopRecorder?.();
  } catch {
    // best-effort recorder shutdown
  }
  state.stopRecorder = null;
  if (state.flushTimer) {
    window.clearInterval(state.flushTimer);
    state.flushTimer = null;
  }
  if (state.maxDurationTimer) {
    window.clearTimeout(state.maxDurationTimer);
    state.maxDurationTimer = null;
  }
  state.restoreUrlMonitor?.();
  state.removeLifecycleListeners?.();
  await flushSessionReplay(reason);
}

export function maybeStartSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  return startSessionReplay(options);
}

export function isSessionReplayActive(): boolean {
  return getState().active;
}
