import {
  getAnalyticsSessionId,
  getAnalyticsAnonymousId,
  scrubUrl,
} from "./analytics.js";

type ReplayEvent = Record<string, unknown>;
type QueuedReplayEvent = {
  json: string;
  timestampMs: number;
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

interface RrwebRecordModule {
  record: (options: RrwebRecordOptions) => ReplayStopFn | undefined;
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
  flushTimer: number | null;
  maxDurationTimer: number | null;
  flushing: boolean;
  stopRecorder: ReplayStopFn | null;
  restoreUrlMonitor: (() => void) | null;
  removeLifecycleListeners: (() => void) | null;
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
  extraProperties?: SessionReplayOptions["extraProperties"];
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
      flushTimer: null,
      maxDurationTimer: null,
      flushing: false,
      stopRecorder: null,
      restoreUrlMonitor: null,
      removeLifecycleListeners: null,
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
    extraProperties: options.extraProperties,
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
  });
  state.queuedBytes += estimatedBytes;
  if (state.queue.length >= state.options.maxEventsPerBatch) {
    void flushSessionReplay("max-events");
  }
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

function buildReplayBody(
  state: SessionReplayState,
  reason: string,
  events: QueuedReplayEvent[],
): string | null {
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
  state.sequence += 1;
  persistReplaySequence(
    sessionId,
    state.replayId,
    state.startedAtMs,
    state.sequence,
  );
  // Events are already serialized+scrubbed JSON strings; splice them into the
  // envelope without re-serializing the (potentially large) events array.
  const envelopeJson = JSON.stringify(envelope);
  return `${envelopeJson.slice(0, -1)},"events":[${events
    .map((event) => event.json)
    .join(",")}]}`;
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

function replayUploadByteLength(body: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(body).byteLength;
  }
  return body.length;
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

async function sendReplayUpload(
  options: NormalizedSessionReplayOptions,
  body: string,
): Promise<void> {
  if (isCrossOriginReplayEndpoint(options.endpoint)) {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(options.endpoint, body);
      if (sent) return;
    }
    await fetch(options.endpoint, {
      method: "POST",
      body,
      keepalive:
        replayUploadByteLength(body) <= MAX_KEEPALIVE_REPLAY_UPLOAD_BYTES,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
    return;
  }

  const upload = await buildReplayUploadBody(body);
  if (!upload.compressed && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(options.endpoint, body);
    if (sent) return;
  }
  await fetch(options.endpoint, {
    method: "POST",
    body: upload.body,
    keepalive: true,
    headers: {
      ...upload.headers,
      "X-Agent-Native-Analytics-Key": options.publicKey,
    },
  }).catch(() => {});
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

export async function flushSessionReplay(reason = "manual"): Promise<void> {
  const state = getState();
  if (!state.options || state.queue.length === 0 || state.flushing) return;
  const events = state.queue.splice(0, state.queue.length);
  state.queuedBytes = 0;
  const body = buildReplayBody(state, reason, events);
  if (!body || !state.options) {
    state.queue = events.concat(state.queue);
    state.queuedBytes += events.reduce(
      (total, event) => total + event.json.length,
      0,
    );
    return;
  }
  state.flushing = true;
  try {
    await sendReplayUpload(state.options, body);
  } finally {
    state.flushing = false;
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
    return {
      started: true,
      replayId: state.replayId,
      sessionId,
      sampled,
    };
  } catch {
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
  state.active = false;
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
