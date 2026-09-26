import {
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
  SESSION_REPLAY_IFRAME_PROBE,
  SESSION_REPLAY_IFRAME_START,
  SESSION_REPLAY_IFRAME_STOP,
  type SessionReplayIframePrivacyOptions,
  type SessionReplayIframeStartMessage,
  type SessionReplayIframeStopMessage,
} from "../session-replay-iframe-protocol.js";
import { isSyntheticTrafficValue } from "../shared/test-traffic.js";
import {
  getOrCreateAnalyticsAnonymousId,
  getOrCreateAnalyticsSessionId,
} from "./analytics-session.js";
import {
  decideReplayQuotaResponse,
  parseRetryAfterSeconds,
} from "./session-replay-quota.js";
import { scrubUrl } from "./url-scrub.js";

function isSyntheticBrowserTraffic(): boolean {
  return (
    typeof window !== "undefined" &&
    isSyntheticTrafficValue(
      (
        window as Window & {
          __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown;
        }
      ).__AGENT_NATIVE_SYNTHETIC_TRAFFIC__,
    )
  );
}

type ReplayEvent = Record<string, unknown>;
type QueuedReplayEvent = {
  json: string;
  byteLength: number;
  timestampMs: number;
  type: number | null;
};
type ReplayStopFn = () => void;
type ReplayResourceNode = {
  tagName: string;
  rel: string;
  as: string;
  type: string;
};
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
  takeFullSnapshot?: (isCheckout?: boolean) => void;
};

interface RrwebRecordModule {
  record: RrwebRecordFn;
}

interface SessionReplayState {
  active: boolean;
  startPromise: Promise<SessionReplayStartResult> | null;
  startGeneration: number;
  replayId: string | null;
  startedAtMs: number | null;
  replayLinkBaseUrl: string | null;
  sequence: number;
  queue: QueuedReplayEvent[];
  queuedBytes: number;
  retryBatches: QueuedReplayEvent[][];
  transientClientErrorFailures: number;
  quotaPause: { publicKey: string; untilMs: number } | null;
  flushTimer: number | null;
  maxDurationTimer: number | null;
  flushing: boolean;
  pendingFlushReason: string | null;
  pendingFlushWaiters: Array<() => void>;
  pendingReplayUpload: PendingReplayUpload | null;
  pendingReplayStart: PendingReplayStart | null;
  pendingReplayRecovery: Promise<void> | null;
  bfcacheRestored: boolean;
  awaitingFullSnapshot: boolean;
  stopRecorder: ReplayStopFn | null;
  restoreUrlMonitor: (() => void) | null;
  removeLifecycleListeners: (() => void) | null;
  restoreIframeBridge: (() => void) | null;
  addCustomEvent: ((tag: string, payload: unknown) => void) | null;
  takeFullSnapshot: ((isCheckout?: boolean) => void) | null;
  restoreCaptures: (() => void) | null;
  options: NormalizedSessionReplayOptions | null;
  lastAuthenticatedProperties: Record<string, unknown> | null;
  resourceNodes: Map<number, ReplayResourceNode>;
  automaticConflictRestartAttempted: boolean;
  broadcastChannel: BroadcastChannel | null;
}

interface StoredReplaySession {
  sessionId?: string;
  replayId?: string;
  startedAtMs?: number;
  sequence?: number;
  linkBaseUrl?: string;
}

interface ReplayClaimMessage {
  type: "an-replay-claim";
  replayId: string;
  instanceNonce: string;
}

interface ReplayClaimTakenMessage {
  type: "an-replay-claim-taken";
  replayId: string;
  claimantNonce?: string;
}

type ReplayBroadcastMessage = ReplayClaimMessage | ReplayClaimTakenMessage;

export type ReplayEventSampling = Record<string, unknown>;

export interface SessionReplayConsoleOptions {
  maxEvents?: number;
}

export interface SessionReplayNetworkOptions {
  maxEvents?: number;
  captureErrorBodies?: boolean;
  maxErrorBodyLength?: number;
}

export interface SessionReplayUploadRejectedDetails {
  status: number;
  restartAttempted: boolean;
  restartSucceeded: boolean;
  restartReason?: SessionReplayStartResult["reason"];
  failureReason?: "quota_pause" | "quota_stop" | "oversized_event";
  retryAfterSeconds?: number | null;
}

export interface SessionReplayOptions {
  enabled?: boolean;
  shouldStart?: () => boolean;
  publicKey?: string;
  endpoint?: string;
  linkBaseUrl?: string;
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
  eventSampling?: ReplayEventSampling;
  console?: boolean | SessionReplayConsoleOptions;
  network?: boolean | SessionReplayNetworkOptions;
  onUploadRejected?: (details: SessionReplayUploadRejectedDetails) => void;
  onUploadRejectedWithAttemptId?: (
    details: SessionReplayUploadRejectedDetails,
    recordingAttemptId: string,
  ) => void;
  onRecordingStarted?: (recordingAttemptId: string) => void;
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
  linkBaseUrl: string | null;
  requireSignedInUser: boolean;
  sampleRate: number;
  samplingSalt: string;
  allowUrls: SessionReplayUrlMatcher[];
  blockUrls: SessionReplayUrlMatcher[];
  flushIntervalMs: number;
  maxDurationMs?: number;
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
  console: NormalizedCaptureOptions | null;
  network: NormalizedCaptureOptions | null;
  onUploadRejected?: SessionReplayOptions["onUploadRejected"];
  onUploadRejectedWithAttemptId?: SessionReplayOptions["onUploadRejectedWithAttemptId"];
  onRecordingStarted?: SessionReplayOptions["onRecordingStarted"];
  extraProperties?: SessionReplayOptions["extraProperties"];
  shouldStart?: SessionReplayOptions["shouldStart"];
}

interface NormalizedCaptureOptions {
  maxEvents: number;
  captureErrorBodies?: boolean;
  maxErrorBodyLength?: number;
}

const DEFAULT_REPLAY_PATH = "/api/analytics/replay";
const DEFAULT_SAMPLING_SALT = "agent-native-session-replay";

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
const SESSION_REPLAY_IFRAME_BLOCK_SELECTOR = `iframe[${SESSION_REPLAY_IFRAME_ATTRIBUTE}]`;
const DEFAULT_BLOCK_SELECTOR = [
  SESSION_REPLAY_IFRAME_BLOCK_SELECTOR,
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
const DEFAULT_MASK_INPUT_OPTIONS: Record<string, boolean> = {
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
};
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_EVENTS_PER_BATCH = 50;
const DEFAULT_MAX_BATCH_BYTES = 256 * 1024;
const MAX_REPLAY_CHUNKS_PER_RECORDING = 2_000;
const MAX_KEEPALIVE_REPLAY_UPLOAD_BYTES = 60 * 1024;
const REPLAY_TEXT_ENCODER =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const RRWEB_FULL_SNAPSHOT_EVENT_TYPE = 2;
const RRWEB_META_EVENT_TYPE = 4;
const SESSION_REPLAY_BROADCAST_CHANNEL_NAME = "agent-native-session-replay";
const SESSION_REPLAY_CLAIM_TIMEOUT_MS = 150;

export const SESSION_REPLAY_CONSOLE_EVENT_TAG = "agent-native.console";
export const SESSION_REPLAY_NETWORK_EVENT_TAG = "agent-native.network";
export const SESSION_REPLAY_AGENT_CHAT_EVENT_TAG = "agent-native.chat";
const SESSION_REPLAY_LIFECYCLE_EVENT_TAG = "agent-native.session_replay";

const DEFAULT_MAX_CONSOLE_EVENTS = 1000;
const DEFAULT_MAX_NETWORK_EVENTS = 2000;
const MAX_CONSOLE_MESSAGE_LENGTH = 500;
const MAX_CONSOLE_ARGS = 10;
const MAX_CONSOLE_STACK_LENGTH = 2000;
const MAX_CONSOLE_SERIALIZE_DEPTH = 4;
const MAX_CONSOLE_SERIALIZE_ENTRIES = 20;
const DEFAULT_MAX_ERROR_BODY_LENGTH = 2048;
const ERROR_BODY_READ_TIMEOUT_MS = 1500;

let replayCaptureInternal = false;

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
      startGeneration: 0,
      replayId: null,
      startedAtMs: null,
      replayLinkBaseUrl: null,
      sequence: 0,
      queue: [],
      queuedBytes: 0,
      retryBatches: [],
      transientClientErrorFailures: 0,
      quotaPause: null,
      flushTimer: null,
      maxDurationTimer: null,
      flushing: false,
      pendingFlushReason: null,
      pendingFlushWaiters: [],
      pendingReplayUpload: null,
      pendingReplayStart: null,
      pendingReplayRecovery: null,
      bfcacheRestored: false,
      awaitingFullSnapshot: false,
      stopRecorder: null,
      restoreUrlMonitor: null,
      removeLifecycleListeners: null,
      restoreIframeBridge: null,
      addCustomEvent: null,
      takeFullSnapshot: null,
      restoreCaptures: null,
      options: null,
      lastAuthenticatedProperties: null,
      resourceNodes: new Map(),
      automaticConflictRestartAttempted: false,
      broadcastChannel: null,
    };
  }
  const state = g[SESSION_REPLAY_STATE_KEY]!;
  state.resourceNodes ??= new Map();
  state.transientClientErrorFailures ??= 0;
  state.restoreIframeBridge ??= null;
  state.pendingFlushReason ??= null;
  state.pendingFlushWaiters ??= [];
  state.pendingReplayUpload ??= null;
  state.pendingReplayStart ??= null;
  state.pendingReplayRecovery ??= null;
  state.bfcacheRestored ??= false;
  state.awaitingFullSnapshot ??= false;
  state.startGeneration ??= 0;
  state.replayLinkBaseUrl ??= null;
  return state;
}

function safeSessionStorageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // private browsing / storage disabled -- replay still works for this page
  }
}

function safeSessionStorageRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // private browsing / storage disabled -- replay still works for this page
  }
}

let legacyLocalStorageReplaySessionCleared = false;

function clearLegacyLocalStorageReplaySession(): void {
  if (legacyLocalStorageReplaySessionCleared) return;
  legacyLocalStorageReplaySessionCleared = true;
  try {
    window.localStorage.removeItem(SESSION_REPLAY_ID_STORAGE_KEY);
  } catch {
    // best-effort only -- a stray legacy record is harmless once ignored
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
  const raw = safeSessionStorageGet(SESSION_REPLAY_ID_STORAGE_KEY);
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
  safeSessionStorageSet(SESSION_REPLAY_ID_STORAGE_KEY, JSON.stringify(value));
}

function removeStoredReplaySession(replayId: string): void {
  if (readStoredReplaySession()?.replayId !== replayId) return;
  safeSessionStorageRemove(SESSION_REPLAY_ID_STORAGE_KEY);
}

function getOrCreateReplaySession(
  sessionId: string,
  linkBaseUrl?: string | null,
): {
  replayId: string;
  startedAtMs: number;
  sequence: number;
  linkBaseUrl?: string;
  resumed: boolean;
} {
  clearLegacyLocalStorageReplaySession();
  const parsed = readStoredReplaySession();
  const parsedSequence =
    typeof parsed?.sequence === "number" &&
    Number.isFinite(parsed.sequence) &&
    parsed.sequence >= 0
      ? Math.floor(parsed.sequence)
      : 0;
  if (
    parsed?.sessionId === sessionId &&
    parsed.replayId &&
    parsedSequence < MAX_REPLAY_CHUNKS_PER_RECORDING - 1
  ) {
    const startedAtMs =
      typeof parsed.startedAtMs === "number" &&
      Number.isFinite(parsed.startedAtMs) &&
      parsed.startedAtMs > 0
        ? parsed.startedAtMs
        : Date.now();
    const sequence = parsedSequence;
    const resolvedLinkBaseUrl = linkBaseUrl ?? parsed.linkBaseUrl;
    if (linkBaseUrl && parsed.linkBaseUrl !== linkBaseUrl) {
      writeStoredReplaySession({ ...parsed, linkBaseUrl });
    }
    return {
      replayId: parsed.replayId,
      startedAtMs,
      sequence,
      ...(resolvedLinkBaseUrl ? { linkBaseUrl: resolvedLinkBaseUrl } : {}),
      resumed: true,
    };
  }
  const replayId = generateReplayId();
  const startedAtMs = Date.now();
  writeStoredReplaySession({
    sessionId,
    replayId,
    startedAtMs,
    sequence: 0,
    ...(linkBaseUrl ? { linkBaseUrl } : {}),
  });
  return {
    replayId,
    startedAtMs,
    sequence: 0,
    ...(linkBaseUrl ? { linkBaseUrl } : {}),
    resumed: false,
  };
}

function openReplayBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(SESSION_REPLAY_BROADCAST_CHANNEL_NAME);
  } catch {
    return null;
  }
}

function createReplayClaimChannel(
  state: SessionReplayState,
  instanceNonce: string,
): {
  channel: BroadcastChannel | null;
  probeClaim: (replayId: string) => Promise<boolean>;
} {
  const channel = openReplayBroadcastChannel();
  if (!channel) {
    return { channel: null, probeClaim: async () => false };
  }
  let pending: {
    replayId: string;
    resolve: (taken: boolean) => void;
    timer: number;
  } | null = null;
  channel.onmessage = (event: MessageEvent) => {
    const data = event?.data as ReplayBroadcastMessage | undefined | null;
    if (!data || typeof data !== "object") return;
    if (data.type === "an-replay-claim") {
      if (data.instanceNonce === instanceNonce) return;
      const ownsReplayId = state.active && state.replayId === data.replayId;
      const winsSimultaneousClaim =
        pending?.replayId === data.replayId &&
        instanceNonce.localeCompare(data.instanceNonce) < 0;
      if (!ownsReplayId && !winsSimultaneousClaim) {
        if (
          pending?.replayId === data.replayId &&
          data.instanceNonce.localeCompare(instanceNonce) < 0
        ) {
          window.clearTimeout(pending.timer);
          const resolve = pending.resolve;
          pending = null;
          resolve(true);
        }
        return;
      }
      try {
        const reply: ReplayClaimTakenMessage = {
          type: "an-replay-claim-taken",
          replayId: data.replayId,
          claimantNonce: data.instanceNonce,
        };
        channel.postMessage(reply);
      } catch {
        // best-effort -- a lost reply just means the duplicate tab resumes
        // recording under the shared id; later 409s still protect the
        // stream from getting corrupted merges.
      }
      return;
    }
    if (data.type === "an-replay-claim-taken") {
      if (
        pending &&
        data.replayId === pending.replayId &&
        (!data.claimantNonce || data.claimantNonce === instanceNonce)
      ) {
        window.clearTimeout(pending.timer);
        const resolve = pending.resolve;
        pending = null;
        resolve(true);
      }
    }
  };
  const probeClaim = (replayId: string): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        pending = null;
        resolve(false);
      }, SESSION_REPLAY_CLAIM_TIMEOUT_MS);
      pending = { replayId, resolve, timer };
      try {
        const claim: ReplayClaimMessage = {
          type: "an-replay-claim",
          replayId,
          instanceNonce,
        };
        channel.postMessage(claim);
      } catch {
        window.clearTimeout(timer);
        pending = null;
        resolve(false);
      }
    });
  return { channel, probeClaim };
}

function persistReplaySequence(
  sessionId: string,
  replayId: string,
  startedAtMs: number | null,
  sequence: number,
  linkBaseUrl?: string | null,
): void {
  const existing = readStoredReplaySession();
  writeStoredReplaySession({
    sessionId,
    replayId,
    startedAtMs: startedAtMs ?? Date.now(),
    sequence,
    ...(linkBaseUrl || existing?.linkBaseUrl
      ? { linkBaseUrl: linkBaseUrl ?? existing?.linkBaseUrl }
      : {}),
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

function normalizeReplayLinkBaseUrl(value?: string): string | null {
  const raw =
    value?.trim() ||
    readEnvString("VITE_AGENT_NATIVE_ANALYTICS_APP_URL") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!raw) return null;
  try {
    return new URL(
      raw,
      typeof window !== "undefined" ? window.location.href : undefined,
    ).origin;
  } catch {
    return null;
  }
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
  const maxDurationMs =
    options.maxDurationMs ??
    readFirstEnvNumber([
      "VITE_AGENT_NATIVE_SESSION_REPLAY_MAX_DURATION_MS",
      "VITE_SESSION_REPLAY_MAX_DURATION_MS",
    ]);
  return {
    publicKey,
    endpoint,
    linkBaseUrl: normalizeReplayLinkBaseUrl(options.linkBaseUrl),
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
    ...(maxDurationMs === undefined
      ? {}
      : { maxDurationMs: Math.max(1000, maxDurationMs) }),
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
    blockSelector: mergeReplayBlockSelector(
      options.blockSelector || DEFAULT_BLOCK_SELECTOR,
    ),
    ignoreSelector: options.ignoreSelector || DEFAULT_IGNORE_SELECTOR,
    maskTextClass: options.maskTextClass || DEFAULT_MASK_TEXT_CLASS,
    maskTextSelector: options.maskTextSelector || DEFAULT_MASK_TEXT_SELECTOR,
    maskAllInputs: options.maskAllInputs ?? true,
    recordCanvas: options.recordCanvas ?? false,
    recordCrossOriginIframes:
      options.recordCrossOriginIframes ?? window.parent === window,
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
    onUploadRejected: options.onUploadRejected,
    onUploadRejectedWithAttemptId: options.onUploadRejectedWithAttemptId,
    onRecordingStarted: options.onRecordingStarted,
    extraProperties: options.extraProperties,
    shouldStart: options.shouldStart,
  };
}

function mergeReplayBlockSelector(blockSelector: string): string {
  return blockSelector.includes(SESSION_REPLAY_IFRAME_BLOCK_SELECTOR)
    ? blockSelector
    : `${blockSelector}, ${SESSION_REPLAY_IFRAME_BLOCK_SELECTOR}`;
}

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

const REPLAY_RESOURCE_LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "apple-touch-icon",
  "mask-icon",
]);
const REPLAY_RESOURCE_PRELOAD_TYPES = new Set([
  "style",
  "font",
  "image",
  "audio",
  "video",
  "track",
]);
const REPLAY_RESOURCE_TAGS = new Set([
  "img",
  "source",
  "video",
  "audio",
  "track",
  "input",
  "link",
]);
const NO_REPLAY_RESOURCE_ATTRIBUTES = new Set<string>();
const REPLAY_SRC_ATTRIBUTES = new Set(["src"]);
const REPLAY_SRCSET_ATTRIBUTES = new Set(["src", "srcset"]);
const REPLAY_VIDEO_ATTRIBUTES = new Set(["src", "poster"]);
const REPLAY_HREF_ATTRIBUTES = new Set(["href"]);

function replayAttributeString(
  attributes: Record<string, unknown>,
  key: string,
): string {
  return typeof attributes[key] === "string"
    ? attributes[key].toLowerCase()
    : "";
}

function updateReplayResourceNode(
  current: ReplayResourceNode,
  attributes: Record<string, unknown>,
): ReplayResourceNode {
  return {
    tagName: current.tagName,
    rel: Object.prototype.hasOwnProperty.call(attributes, "rel")
      ? replayAttributeString(attributes, "rel")
      : current.rel,
    as: Object.prototype.hasOwnProperty.call(attributes, "as")
      ? replayAttributeString(attributes, "as")
      : current.as,
    type: Object.prototype.hasOwnProperty.call(attributes, "type")
      ? replayAttributeString(attributes, "type")
      : current.type,
  };
}

function replayPreservedResourceAttributes(
  node: ReplayResourceNode,
): ReadonlySet<string> {
  switch (node.tagName) {
    case "img":
    case "source":
      return REPLAY_SRCSET_ATTRIBUTES;
    case "video":
      return REPLAY_VIDEO_ATTRIBUTES;
    case "audio":
    case "track":
      return REPLAY_SRC_ATTRIBUTES;
    case "input":
      return node.type === "image"
        ? REPLAY_SRC_ATTRIBUTES
        : NO_REPLAY_RESOURCE_ATTRIBUTES;
    case "link": {
      const rels = node.rel.split(/\s+/);
      const isLoadBearingResource =
        rels.some((rel) => REPLAY_RESOURCE_LINK_RELS.has(rel)) ||
        (rels.includes("preload") &&
          REPLAY_RESOURCE_PRELOAD_TYPES.has(node.as));
      return isLoadBearingResource
        ? REPLAY_HREF_ATTRIBUTES
        : NO_REPLAY_RESOURCE_ATTRIBUTES;
    }
    default:
      return NO_REPLAY_RESOURCE_ATTRIBUTES;
  }
}

function createReplayScrubReplacer(
  resourceNodes: Map<number, ReplayResourceNode>,
): (this: unknown, key: string, value: unknown) => unknown {
  const preservedAttributes = new WeakMap<object, ReadonlySet<string>>();

  return function replayScrubReplacer(
    this: unknown,
    key: string,
    value: unknown,
  ): unknown {
    if (key === "attributes" && value && typeof value === "object") {
      const attributes = value as Record<string, unknown>;
      const holder =
        this && typeof this === "object"
          ? (this as Record<string, unknown>)
          : undefined;
      const tagName =
        typeof holder?.tagName === "string" ? holder.tagName.toLowerCase() : "";
      const nodeId =
        typeof holder?.id === "number" && Number.isFinite(holder.id)
          ? holder.id
          : undefined;
      let resourceNode: ReplayResourceNode | undefined;
      if (tagName && REPLAY_RESOURCE_TAGS.has(tagName)) {
        resourceNode = updateReplayResourceNode(
          { tagName, rel: "", as: "", type: "" },
          attributes,
        );
      } else if (nodeId !== undefined && !tagName) {
        const current = resourceNodes.get(nodeId);
        if (current) {
          resourceNode = updateReplayResourceNode(current, attributes);
        }
      }
      if (nodeId !== undefined && resourceNode) {
        resourceNodes.set(nodeId, resourceNode);
      }

      const resourceKeys = resourceNode
        ? replayPreservedResourceAttributes(resourceNode)
        : NO_REPLAY_RESOURCE_ATTRIBUTES;

      if (resourceKeys.size > 0) preservedAttributes.set(value, resourceKeys);
      return value;
    }

    if (
      typeof value === "string" &&
      this &&
      typeof this === "object" &&
      preservedAttributes.get(this)?.has(key.toLowerCase())
    ) {
      return value;
    }
    return typeof value === "string" ? scrubStringValue(key, value) : value;
  };
}

function serializeReplayEvent(
  event: ReplayEvent,
  resourceNodes: Map<number, ReplayResourceNode>,
): string {
  try {
    if (event.type === 2) resourceNodes.clear();
    return JSON.stringify(event, createReplayScrubReplacer(resourceNodes));
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
  flushImmediately = true,
): void {
  if (!state.options) return;
  const eventType = typeof event.type === "number" ? event.type : null;
  if (state.pendingReplayUpload || replayUploadsParked(state, Date.now())) {
    if (eventType !== RRWEB_FULL_SNAPSHOT_EVENT_TYPE) return;
    state.queue = [];
    state.queuedBytes = 0;
    state.retryBatches = [];
    state.awaitingFullSnapshot = false;
  }
  if (state.awaitingFullSnapshot) {
    if (
      eventType !== RRWEB_FULL_SNAPSHOT_EVENT_TYPE &&
      eventType !== RRWEB_META_EVENT_TYPE
    ) {
      return;
    }
    if (eventType === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      state.awaitingFullSnapshot = false;
    }
  }
  const serialized = serializeReplayEvent(event, state.resourceNodes);
  if (!serialized) return;
  const estimatedBytes = replaySerializedBytes(serialized);
  if (
    state.queue.length > 0 &&
    state.queuedBytes + estimatedBytes > state.options.maxBatchBytes
  ) {
    void flushSessionReplay("max-bytes");
  }
  state.queue.push({
    json: serialized,
    byteLength: estimatedBytes,
    timestampMs: replayEventTimestampMs(event),
    type: eventType,
  });
  state.queuedBytes += estimatedBytes;
  if (flushImmediately) flushQueuedReplayIfNeeded(state);
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
  publicKey: string;
}

interface PendingReplayUpload {
  request: Promise<void>;
  payload: ReplayUploadPayload;
  reason: string;
}

interface PendingReplayStart {
  options: NormalizedSessionReplayOptions;
  sessionId: string;
}

function buildReplayBody(
  state: SessionReplayState,
  reason: string,
  events: QueuedReplayEvent[],
): ReplayUploadPayload | null {
  const options = state.options;
  if (!options || !state.replayId) return null;
  const sessionId = getOrCreateAnalyticsSessionId();
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
    anonymousId: getOrCreateAnalyticsAnonymousId(),
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
  const envelopeJson = JSON.stringify(envelope);
  return {
    body: `${envelopeJson.slice(0, -1)},"events":[${events
      .map((event) => event.json)
      .join(",")}]}`,
    replayId: state.replayId,
    sessionId,
    sequence: state.sequence,
    publicKey: options.publicKey,
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

class ReplayUploadHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  constructor(status: number, retryAfterSeconds: number | null = null) {
    super(`Session replay upload failed with HTTP ${status}`);
    this.name = "ReplayUploadHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class ReplayUploadInFlightTimeoutError extends Error {
  readonly request: Promise<void>;
  constructor(request: Promise<void>) {
    super("Session replay upload timed out while still in flight");
    this.name = "ReplayUploadInFlightTimeoutError";
    this.request = request;
  }
}

function isDefinitiveReplayUploadClientError(status: number): boolean {
  return status === 400 || status === 409 || status === 413 || status === 422;
}

const MAX_TRANSIENT_REPLAY_CLIENT_FAILURES = 3;
const REPLAY_UPLOAD_TIMEOUT_MS = 15_000;

function startReplayUploadTimeout(): {
  signal: AbortSignal | undefined;
  promise: Promise<never>;
  didTimeout: () => boolean;
  done: () => void;
} {
  const controller =
    typeof AbortController === "undefined" ? undefined : new AbortController();
  let rejectTimeout!: (error: Error) => void;
  let timedOut = false;
  const timeoutError = new Error("Session replay upload timed out");
  const promise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
    rejectTimeout(timeoutError);
  }, REPLAY_UPLOAD_TIMEOUT_MS);
  return {
    signal: controller?.signal,
    promise,
    didTimeout: () => timedOut,
    done: () => clearTimeout(timer),
  };
}

function isTransientReplayUploadClientError(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

function readRetryAfterHeader(response: Response): string | null {
  return response.headers?.get("retry-after") ?? null;
}

function replayUploadsParked(
  state: SessionReplayState,
  nowMs: number,
): boolean {
  const pause = state.quotaPause;
  if (!pause) return false;
  if (state.options?.publicKey !== pause.publicKey) return false;
  if (nowMs < pause.untilMs) return true;
  state.quotaPause = null;
  state.awaitingFullSnapshot = true;
  const previousInternal = replayCaptureInternal;
  replayCaptureInternal = true;
  try {
    state.takeFullSnapshot?.(true);
  } catch (error) {
    console.warn(
      "[session-replay] could not re-anchor after quota pause",
      error,
    );
  } finally {
    replayCaptureInternal = previousInternal;
  }
  return false;
}

function awaitReplayUploadRequest(
  timeout: ReturnType<typeof startReplayUploadTimeout>,
  createRequest: () => Promise<Response>,
): Promise<void> {
  let request: Promise<Response>;
  try {
    request = createRequest();
  } catch (error) {
    timeout.done();
    throw error;
  }
  return awaitReplayUpload(request, timeout);
}

async function awaitReplayUpload(
  request: Promise<Response>,
  timeout: ReturnType<typeof startReplayUploadTimeout>,
): Promise<void> {
  const checkedRequest = request.then((response) => {
    if (!response.ok) {
      throw new ReplayUploadHttpError(
        response.status,
        parseRetryAfterSeconds(readRetryAfterHeader(response), Date.now()),
      );
    }
  });
  try {
    await Promise.race([checkedRequest, timeout.promise]);
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new ReplayUploadInFlightTimeoutError(checkedRequest);
    }
    throw error;
  } finally {
    timeout.done();
  }
}

async function sendReplayUpload(
  options: NormalizedSessionReplayOptions,
  body: string,
  callbacks: { beforeKeepaliveUpload?: () => void } = {},
): Promise<void> {
  if (isCrossOriginReplayEndpoint(options.endpoint)) {
    const canUseKeepalive = canUseReplayKeepalive(body);
    if (canUseKeepalive) callbacks.beforeKeepaliveUpload?.();
    const timeout = startReplayUploadTimeout();
    await awaitReplayUploadRequest(timeout, () =>
      fetch(options.endpoint, {
        method: "POST",
        body,
        keepalive: canUseKeepalive,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        signal: timeout.signal,
      }),
    );
    return;
  }

  const upload = await buildReplayUploadBody(body);
  const canUseKeepalive = canUseReplayKeepalive(upload.body);
  if (canUseKeepalive) callbacks.beforeKeepaliveUpload?.();
  const timeout = startReplayUploadTimeout();
  await awaitReplayUploadRequest(timeout, () =>
    fetch(options.endpoint, {
      method: "POST",
      body: upload.body,
      keepalive: canUseKeepalive,
      headers: {
        ...upload.headers,
        "X-Agent-Native-Analytics-Key": options.publicKey,
      },
      signal: timeout.signal,
    }),
  );
}

function isFinalFlushReason(reason: string): boolean {
  return [
    "auth-cleared",
    "manual",
    "pagehide",
    "pagehide-persisted",
    "beforeunload",
    "url-blocked",
    "max-duration",
    "max-chunks",
  ].includes(reason);
}

function isTerminalReplayFlushReason(reason: string): boolean {
  return reason === "pagehide" || reason === "beforeunload";
}

function flushReasonPriority(reason: string): number {
  if (
    reason === "pagehide" ||
    reason === "pagehide-persisted" ||
    reason === "beforeunload"
  ) {
    return 3;
  }
  if (isFinalFlushReason(reason)) return 2;
  if (reason === "visibility-hidden") return 1;
  return 0;
}

function mergePendingFlushReason(
  current: string | null,
  requested: string,
): string {
  if (!current) return requested;
  return flushReasonPriority(requested) > flushReasonPriority(current)
    ? requested
    : current;
}

function shouldReserveSequenceBeforeKeepalive(reason: string): boolean {
  return (
    reason === "pagehide" ||
    reason === "pagehide-persisted" ||
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
  if (state.pendingReplayUpload) return;
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
  return events.reduce(
    (total, event) => total + queuedReplayEventBytes(event),
    0,
  );
}

function replaySerializedBytes(value: string): number {
  if (REPLAY_TEXT_ENCODER) return REPLAY_TEXT_ENCODER.encode(value).byteLength;
  if (typeof Blob !== "undefined") return new Blob([value]).size;
  return value.length;
}

function queuedReplayEventBytes(event: QueuedReplayEvent): number {
  return Number.isFinite(event.byteLength)
    ? event.byteLength
    : replaySerializedBytes(event.json);
}

function takeQueuedReplayBatch(state: SessionReplayState): QueuedReplayEvent[] {
  const options = state.options;
  if (!options || state.queue.length === 0) return [];

  let count = 0;
  let bytes = 0;
  for (const event of state.queue) {
    if (count > 0 && event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) break;
    if (
      count > 0 &&
      (count >= options.maxEventsPerBatch ||
        bytes + queuedReplayEventBytes(event) > options.maxBatchBytes)
    ) {
      break;
    }
    count += 1;
    bytes += queuedReplayEventBytes(event);
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) break;
  }

  const events = state.queue.splice(0, Math.max(1, count));
  state.queuedBytes = queuedReplayBytes(state.queue);
  return events;
}

function splitReplayBatch(
  events: QueuedReplayEvent[],
): [QueuedReplayEvent[], QueuedReplayEvent[]] | null {
  if (events.length < 2) return null;
  const targetBytes = queuedReplayBytes(events) / 2;
  let splitAt = 1;
  let bytes = events[0] ? queuedReplayEventBytes(events[0]) : 0;
  while (splitAt < events.length - 1 && bytes < targetBytes) {
    const event = events[splitAt];
    if (event) bytes += queuedReplayEventBytes(event);
    splitAt += 1;
  }
  return [events.slice(0, splitAt), events.slice(splitAt)];
}

function replayBatchNeedsDomReset(events: QueuedReplayEvent[]): boolean {
  return events.some((event) => {
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) return true;
    if (event.type !== 3) return false;
    try {
      const parsed = JSON.parse(event.json) as { data?: { source?: unknown } };
      return parsed.data?.source === 0;
    } catch {
      return true;
    }
  });
}

function quarantinePendingReplayUntilFullSnapshot(
  state: SessionReplayState,
): void {
  const pending = [...state.retryBatches.flat(), ...state.queue];
  const resetAt = pending.findIndex(
    (event) => event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE,
  );
  state.retryBatches = [];
  state.queue = resetAt >= 0 ? pending.slice(resetAt) : [];
  state.queuedBytes = queuedReplayBytes(state.queue);
  state.awaitingFullSnapshot = resetAt < 0;
}

function restoreReplayEvents(
  state: SessionReplayState,
  events: QueuedReplayEvent[],
): void {
  state.retryBatches.unshift(events);
}

function resumeAfterPendingReplayUpload(
  state: SessionReplayState,
  pending: PendingReplayUpload,
): void {
  if (state.pendingReplayUpload !== pending && !state.pendingReplayRecovery) {
    return;
  }
  void recoverAfterPendingReplayUpload(state, pending);
}

function recoverAfterPendingReplayUpload(
  state: SessionReplayState,
  pending: PendingReplayUpload,
): Promise<void> {
  if (state.pendingReplayRecovery) return state.pendingReplayRecovery;
  if (state.pendingReplayUpload !== pending) return Promise.resolve();
  let recovery: Promise<void>;
  recovery = recoverAfterPendingReplayUploadInternal(state, pending).finally(
    () => {
      if (state.pendingReplayRecovery === recovery) {
        state.pendingReplayRecovery = null;
      }
      for (const resolve of state.pendingFlushWaiters.splice(0)) resolve();
    },
  );
  state.pendingReplayRecovery = recovery;
  return recovery;
}

async function recoverAfterPendingReplayUploadInternal(
  state: SessionReplayState,
  pending: PendingReplayUpload,
): Promise<void> {
  state.bfcacheRestored = false;
  try {
    if (state.replayId !== pending.payload.replayId) {
      state.pendingReplayUpload = null;
      state.pendingReplayStart = null;
      return;
    }

    const wasActive = state.active;
    const suppressRestart =
      isTerminalReplayFlushReason(pending.reason) ||
      isTerminalReplayFlushReason(state.pendingFlushReason ?? "");

    state.queue = [];
    state.queuedBytes = 0;
    state.retryBatches = [];
    state.awaitingFullSnapshot = false;
    removeStoredReplaySession(pending.payload.replayId);

    let stopCancelledRecovery = false;
    if (wasActive) {
      const expectedStopGeneration = state.startGeneration + 1;
      await stopSessionReplay("upload-timeout");
      stopCancelledRecovery =
        state.startGeneration !== expectedStopGeneration &&
        !state.pendingReplayStart;
    }

    const restartRequest =
      suppressRestart || stopCancelledRecovery
        ? null
        : (state.pendingReplayStart ??
          (wasActive && state.options
            ? { options: state.options, sessionId: pending.payload.sessionId }
            : null));

    state.queue = [];
    state.queuedBytes = 0;
    state.retryBatches = [];
    state.awaitingFullSnapshot = false;
    state.pendingFlushReason = null;
    state.pendingReplayUpload = null;
    state.pendingReplayStart = null;

    if (!restartRequest || state.active) return;
    await restartSessionReplayWithFreshIdentity(
      state,
      restartRequest.options,
      restartRequest.sessionId,
    );
  } finally {
    // The wrapper owns clearing state.pendingReplayRecovery after every
    // recovery caller observes the same settled promise.
  }
}

function fenceTimedOutReplayUpload(
  state: SessionReplayState,
  pending: PendingReplayUpload,
): void {
  void pending.request
    .then(
      () => undefined,
      (error) => {
        const previousInternal = replayCaptureInternal;
        replayCaptureInternal = true;
        try {
          console.warn(
            "[session-replay] timed-out upload settled without a retry; restarting the replay",
            error,
          );
        } finally {
          replayCaptureInternal = previousInternal;
        }
      },
    )
    .finally(() => resumeAfterPendingReplayUpload(state, pending));
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
    state.replayLinkBaseUrl,
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
    state.replayLinkBaseUrl,
  );
}

export async function flushSessionReplay(reason = "manual"): Promise<void> {
  if (isSyntheticBrowserTraffic()) return;
  const state = getState();
  if (!state.options) return;
  if (replayUploadsParked(state, Date.now())) return;
  if (state.pendingReplayUpload) {
    state.pendingFlushReason = mergePendingFlushReason(
      state.pendingFlushReason,
      reason,
    );
    return;
  }
  if (state.flushing) {
    state.pendingFlushReason = mergePendingFlushReason(
      state.pendingFlushReason,
      reason,
    );
    return new Promise<void>((resolve) => {
      state.pendingFlushWaiters.push(resolve);
    });
  }
  if (state.sequence >= MAX_REPLAY_CHUNKS_PER_RECORDING) {
    if (state.active) {
      await stopSessionReplay("max-chunks");
      return;
    }
    state.queue = [];
    state.queuedBytes = 0;
    state.retryBatches = [];
    state.pendingFlushReason = null;
    for (const resolve of state.pendingFlushWaiters.splice(0)) resolve();
    return;
  }
  if (state.active && state.sequence >= MAX_REPLAY_CHUNKS_PER_RECORDING - 1) {
    await stopSessionReplay("max-chunks");
    return;
  }
  if (!hasPendingReplayBatch(state)) {
    if (reason === "pagehide-persisted") state.bfcacheRestored = false;
    return;
  }
  const events = state.retryBatches.shift() ?? takeQueuedReplayBatch(state);
  const payload = buildReplayBody(state, reason, events);
  if (!payload || !state.options) {
    restoreReplayEvents(state, events);
    if (reason === "pagehide-persisted") state.bfcacheRestored = false;
    return;
  }
  state.flushing = true;
  let uploaded = false;
  let reservedSequence = false;
  let splitRejectedBatch = false;
  let droppedOversizedBatch = false;
  let fencedTimedOutUpload = false;
  let isDefinitiveClientError = false;
  let definitiveClientErrorStatus: number | null = null;
  let pausedForQuota = false;
  let quotaRetryAfterSeconds: number | null = null;
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
    state.automaticConflictRestartAttempted = false;
    state.transientClientErrorFailures = 0;
    uploaded = true;
  } catch (error) {
    if (error instanceof ReplayUploadInFlightTimeoutError) {
      const pending: PendingReplayUpload = {
        request: error.request,
        payload,
        reason,
      };
      state.pendingReplayUpload = pending;
      state.retryBatches = [];
      state.queue = [];
      state.queuedBytes = 0;
      state.awaitingFullSnapshot = true;
      fencedTimedOutUpload = true;
      fenceTimedOutReplayUpload(state, pending);
      if (state.bfcacheRestored) {
        void recoverAfterPendingReplayUpload(state, pending);
      }
    } else {
      if (reservedSequence) rollbackReplaySequenceReservation(state, payload);
      const rejectedStatus =
        error instanceof ReplayUploadHttpError ? error.status : null;
      const splitBatch =
        rejectedStatus === 413 ? splitReplayBatch(events) : null;
      const isUnsplittableOversizedBatch =
        rejectedStatus === 413 && splitBatch === null;
      const quotaDecision =
        rejectedStatus === 429 && error instanceof ReplayUploadHttpError
          ? decideReplayQuotaResponse(error.retryAfterSeconds, Date.now())
          : null;
      if (rejectedStatus === 429 && error instanceof ReplayUploadHttpError) {
        quotaRetryAfterSeconds = error.retryAfterSeconds;
      }
      if (quotaDecision) {
        state.quotaPause = {
          publicKey: payload.publicKey,
          untilMs:
            quotaDecision.kind === "pause"
              ? quotaDecision.resumeAtMs
              : Number.POSITIVE_INFINITY,
        };
      }
      const isTransientClientError =
        rejectedStatus !== null &&
        isTransientReplayUploadClientError(rejectedStatus);
      if (isTransientClientError) {
        state.transientClientErrorFailures += 1;
      } else {
        state.transientClientErrorFailures = 0;
      }
      const exhaustedTransientClientRetries =
        isTransientClientError &&
        state.transientClientErrorFailures >=
          MAX_TRANSIENT_REPLAY_CLIENT_FAILURES;
      isDefinitiveClientError =
        error instanceof ReplayUploadHttpError &&
        (isDefinitiveReplayUploadClientError(error.status) ||
          exhaustedTransientClientRetries ||
          quotaDecision?.kind === "stop") &&
        !splitBatch &&
        !isUnsplittableOversizedBatch;
      if (splitBatch) {
        state.retryBatches.unshift(...splitBatch);
        splitRejectedBatch = true;
      } else if (isUnsplittableOversizedBatch) {
        droppedOversizedBatch = true;
        if (replayBatchNeedsDomReset(events)) {
          quarantinePendingReplayUntilFullSnapshot(state);
        }
      } else if (quotaDecision?.kind === "pause") {
        pausedForQuota = true;
        state.retryBatches = [];
        state.queue = [];
        state.queuedBytes = 0;
        state.awaitingFullSnapshot = true;
      } else if (isDefinitiveClientError) {
        state.queue = [];
        state.queuedBytes = 0;
        state.retryBatches = [];
        removeStoredReplaySession(payload.replayId);
        definitiveClientErrorStatus = rejectedStatus;
      } else {
        restoreReplayEvents(state, events);
      }
    }
    const previousInternal = replayCaptureInternal;
    replayCaptureInternal = true;
    try {
      if (splitRejectedBatch) {
        console.warn(
          "[session-replay] splitting oversized upload (HTTP 413)",
          error,
        );
      } else if (droppedOversizedBatch) {
        console.warn(
          "[session-replay] dropping oversized replay event (HTTP 413)",
          error,
        );
      } else if (pausedForQuota) {
        console.warn(
          "[session-replay] ingest key over quota; pausing uploads (HTTP 429)",
        );
      } else if (isDefinitiveClientError) {
        console.warn(
          `[session-replay] dropping upload (HTTP ${(error as ReplayUploadHttpError).status})`,
          error,
        );
      } else if (fencedTimedOutUpload) {
        console.warn(
          "[session-replay] upload timed out; waiting for it to settle before restarting",
        );
      } else {
        console.warn("[session-replay] upload failed", error);
      }
    } finally {
      replayCaptureInternal = previousInternal;
    }
  } finally {
    state.flushing = false;
  }
  if (reason === "pagehide-persisted" && !fencedTimedOutUpload) {
    state.bfcacheRestored = false;
  }
  if (fencedTimedOutUpload) return;
  const coalescedReason = state.pendingFlushReason;
  const coalescedWaiters = coalescedReason
    ? state.pendingFlushWaiters.splice(0)
    : [];
  if (coalescedReason) state.pendingFlushReason = null;

  if (coalescedReason) {
    await flushSessionReplay(coalescedReason);
  } else if (splitRejectedBatch || droppedOversizedBatch) {
    await flushSessionReplay(reason);
  } else if (uploaded && hasPendingReplayBatch(state)) {
    const mustContinue =
      state.retryBatches.length > 0 ||
      isFinalFlushReason(reason) ||
      shouldFlushQueuedReplay(state);
    if (mustContinue) {
      if (isFinalFlushReason(reason)) {
        await flushSessionReplay(reason);
      } else void flushSessionReplay(reason);
    }
  }
  if (droppedOversizedBatch || pausedForQuota) {
    const details: SessionReplayUploadRejectedDetails = {
      status: droppedOversizedBatch ? 413 : 429,
      restartAttempted: false,
      restartSucceeded: false,
      failureReason: droppedOversizedBatch ? "oversized_event" : "quota_pause",
      ...(pausedForQuota ? { retryAfterSeconds: quotaRetryAfterSeconds } : {}),
    };
    try {
      state.options?.onUploadRejected?.(details);
    } catch {
      const previousInternal = replayCaptureInternal;
      replayCaptureInternal = true;
      try {
        console.warn(
          "[session-replay] upload rejection telemetry callback failed",
        );
      } finally {
        replayCaptureInternal = previousInternal;
      }
    }
    try {
      state.options?.onUploadRejectedWithAttemptId?.(details, payload.replayId);
    } catch {
      // coercion-ok: tracking-hook failure must not interrupt replay recovery.
      // Tracking must not interfere with replay recovery.
    }
  }
  if (
    definitiveClientErrorStatus !== null &&
    state.replayId === payload.replayId
  ) {
    const rejectedOptions = state.options;
    const shouldRestartAfterConflict =
      definitiveClientErrorStatus === 409 &&
      state.active &&
      !isFinalFlushReason(reason) &&
      !state.automaticConflictRestartAttempted;
    if (shouldRestartAfterConflict) {
      state.automaticConflictRestartAttempted = true;
    }

    await stopSessionReplay("upload-rejected");

    let restartResult: SessionReplayStartResult | null = null;
    if (shouldRestartAfterConflict && rejectedOptions) {
      restartResult = await restartSessionReplayWithFreshIdentity(
        state,
        rejectedOptions,
        payload.sessionId,
      );
    }

    const details: SessionReplayUploadRejectedDetails = {
      status: definitiveClientErrorStatus,
      restartAttempted: shouldRestartAfterConflict,
      restartSucceeded: restartResult?.started === true,
      ...(definitiveClientErrorStatus === 429
        ? {
            failureReason: "quota_stop",
            retryAfterSeconds: quotaRetryAfterSeconds,
          }
        : {}),
      ...(restartResult?.reason ? { restartReason: restartResult.reason } : {}),
    };
    try {
      rejectedOptions?.onUploadRejected?.(details);
    } catch {
      // best-effort telemetry must never interfere with recording recovery
    }
    try {
      rejectedOptions?.onUploadRejectedWithAttemptId?.(
        details,
        payload.replayId,
      );
    } catch {
      // coercion-ok: tracking-hook failure must not interrupt replay recovery.
      // best-effort telemetry must never interfere with recording recovery
    }
  }
  for (const resolve of coalescedWaiters) resolve();
}

async function restartSessionReplayWithFreshIdentity(
  state: SessionReplayState,
  options: NormalizedSessionReplayOptions,
  sessionId: string,
): Promise<SessionReplayStartResult> {
  if (state.startPromise) return state.startPromise;

  const startGeneration = ++state.startGeneration;
  let startPromise: Promise<SessionReplayStartResult>;
  startPromise = restartSessionReplayWithFreshIdentityInternal(
    state,
    options,
    sessionId,
    startGeneration,
  ).finally(() => {
    if (state.startPromise === startPromise) state.startPromise = null;
  });
  state.startPromise = startPromise;
  return startPromise;
}

async function restartSessionReplayWithFreshIdentityInternal(
  state: SessionReplayState,
  options: NormalizedSessionReplayOptions,
  sessionId: string,
  startGeneration: number,
): Promise<SessionReplayStartResult> {
  if (options.shouldStart && !options.shouldStart()) {
    return { started: false, reason: "disabled", sessionId, sampled: true };
  }

  const initialProperties = replayExtraProperties(options);
  if (options.requireSignedInUser && !replayUserEmail(initialProperties)) {
    return {
      started: false,
      reason: "missing-user-id",
      sessionId,
      sampled: true,
    };
  }
  if (!isUrlRecordable(window.location.href, options)) {
    return {
      started: false,
      reason: "url-blocked",
      sessionId,
      sampled: true,
    };
  }

  return startSessionReplayRecorder(
    state,
    options,
    sessionId,
    true,
    initialProperties,
    startGeneration,
  );
}

function installUrlMonitor(state: SessionReplayState): void {
  if (!state.options || state.restoreUrlMonitor) return;
  const options = state.options;
  const check = () => {
    if (!isUrlRecordable(window.location.href, options)) {
      void stopSessionReplay("url-blocked");
    }
  };
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
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
  const flushOnUnload = (event: PageTransitionEvent) => {
    state.bfcacheRestored = false;
    void flushSessionReplay(
      event.persisted ? "pagehide-persisted" : "pagehide",
    );
  };
  const resumeFromBfcache = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    state.bfcacheRestored = true;
    const pending = state.pendingReplayUpload;
    if (pending) void recoverAfterPendingReplayUpload(state, pending);
    else if (!state.flushing) state.bfcacheRestored = false;
  };
  document.addEventListener("visibilitychange", flushOnHidden);
  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("pageshow", resumeFromBfcache);
  state.removeLifecycleListeners = () => {
    document.removeEventListener("visibilitychange", flushOnHidden);
    window.removeEventListener("pagehide", flushOnUnload);
    window.removeEventListener("pageshow", resumeFromBfcache);
    state.removeLifecycleListeners = null;
  };
}

function markedSessionReplayIframes(): HTMLIFrameElement[] {
  if (typeof document.querySelectorAll !== "function") return [];
  return Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      `iframe[${SESSION_REPLAY_IFRAME_ATTRIBUTE}]`,
    ),
  );
}

function markedSessionReplayIframeForSource(
  source: MessageEventSource | null,
): HTMLIFrameElement | null {
  if (!source) return null;
  return (
    markedSessionReplayIframes().find(
      (iframe) => iframe.contentWindow === source,
    ) ?? null
  );
}

function sessionReplayIframePrivacyOptions(
  options: NormalizedSessionReplayOptions,
): SessionReplayIframePrivacyOptions {
  return {
    blockSelector: options.blockSelector,
    ignoreSelector: options.ignoreSelector,
    maskTextClass: options.maskTextClass,
    maskTextSelector: options.maskTextSelector,
    maskAllInputs: options.maskAllInputs,
    maskInputOptions: DEFAULT_MASK_INPUT_OPTIONS,
    recordCanvas: options.recordCanvas,
    collectFonts: options.collectFonts,
    inlineImages: options.inlineImages,
    sampling: options.eventSampling,
  };
}

function postSessionReplayIframeMessage(
  iframe: HTMLIFrameElement,
  message: SessionReplayIframeStartMessage | SessionReplayIframeStopMessage,
): void {
  try {
    iframe.contentWindow?.postMessage(message, "*");
  } catch {
    // The frame may have navigated or detached between discovery and send.
  }
}

function installSessionReplayIframeBridge(
  state: SessionReplayState,
  options: NormalizedSessionReplayOptions,
): void {
  if (!options.recordCrossOriginIframes || state.restoreIframeBridge) return;

  const startMessage: SessionReplayIframeStartMessage = {
    type: SESSION_REPLAY_IFRAME_START,
    options: sessionReplayIframePrivacyOptions(options),
  };
  const stopMessage: SessionReplayIframeStopMessage = {
    type: SESSION_REPLAY_IFRAME_STOP,
  };
  const sendStart = (iframe: HTMLIFrameElement) =>
    postSessionReplayIframeMessage(iframe, startMessage);
  const onMessage = (event: MessageEvent) => {
    if (!state.active) return;
    if (
      !event.data ||
      typeof event.data !== "object" ||
      event.data.type !== SESSION_REPLAY_IFRAME_PROBE
    ) {
      return;
    }
    const iframe = markedSessionReplayIframeForSource(event.source);
    if (iframe) sendStart(iframe);
  };

  window.addEventListener("message", onMessage);
  for (const iframe of markedSessionReplayIframes()) sendStart(iframe);
  state.restoreIframeBridge = () => {
    window.removeEventListener("message", onMessage);
    for (const iframe of markedSessionReplayIframes()) {
      postSessionReplayIframeMessage(iframe, stopMessage);
    }
    state.restoreIframeBridge = null;
  };
}

function truncateCaptureText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

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
  if (typeof value !== "object") return "[unserializable]";
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
    const serialized = JSON.stringify(
      toCaptureSerializable(value, 0, new WeakSet()),
    );
    return typeof serialized === "string" ? serialized : "[unserializable]";
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return "[unserializable]";
    }
  }
}

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
      const key = `${level}\u0000${source}\u0000${message}`;
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
    return true;
  }
  return false;
}

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
      const result = originalFetch.call(self, input as RequestInfo | URL, init);
      if (!result || typeof (result as Promise<Response>).then !== "function") {
        return result;
      }
      return result.then(
        (response) => {
          try {
            const durationMs = performance.now() - startedAt;
            if (errorBodyCap !== null && response.status >= 500) {
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
      if (window.fetch === (wrappedFetch as typeof window.fetch)) {
        window.fetch = originalFetch;
      }
    });
  }

  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {
    const originalOpen = Reflect.get(
      XMLHttpRequest.prototype,
      "open",
    ) as typeof XMLHttpRequest.prototype.open;
    const originalSend = Reflect.get(
      XMLHttpRequest.prototype,
      "send",
    ) as typeof XMLHttpRequest.prototype.send;
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
  if (isSyntheticBrowserTraffic()) {
    return { started: false, reason: "disabled" };
  }
  if (options.enabled === false) return { started: false, reason: "disabled" };
  if (options.shouldStart && !options.shouldStart()) {
    return { started: false, reason: "disabled" };
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { started: false, reason: "not-browser" };
  }
  const normalized = normalizeOptions(options);
  if (!normalized) return { started: false, reason: "missing-public-key" };

  const sessionId = getOrCreateAnalyticsSessionId();
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
  if (state.pendingReplayUpload) {
    state.pendingReplayStart = { options: normalized, sessionId };
    return {
      started: false,
      reason: "already-active",
      replayId: state.replayId ?? undefined,
      sessionId,
      sampled,
    };
  }
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

  state.automaticConflictRestartAttempted = false;
  state.transientClientErrorFailures = 0;
  const startGeneration = ++state.startGeneration;

  let startPromise: Promise<SessionReplayStartResult>;
  startPromise = startSessionReplayRecorder(
    state,
    normalized,
    sessionId,
    sampled,
    initialProperties,
    startGeneration,
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
  startGeneration: number,
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
  if (state.startGeneration !== startGeneration) {
    return { started: false, reason: "disabled", sessionId, sampled };
  }
  if (normalized.shouldStart && !normalized.shouldStart()) {
    return { started: false, reason: "disabled", sessionId, sampled };
  }

  let replaySession = getOrCreateReplaySession(
    sessionId,
    normalized.linkBaseUrl,
  );
  const instanceNonce = generateReplayId();
  const { channel: replayChannel, probeClaim } = createReplayClaimChannel(
    state,
    instanceNonce,
  );
  if (replaySession.resumed && replayChannel) {
    const taken = await probeClaim(replaySession.replayId);
    if (taken) {
      const freshReplayId = generateReplayId();
      const freshStartedAtMs = Date.now();
      writeStoredReplaySession({
        sessionId,
        replayId: freshReplayId,
        startedAtMs: freshStartedAtMs,
        sequence: 0,
        ...(normalized.linkBaseUrl
          ? { linkBaseUrl: normalized.linkBaseUrl }
          : {}),
      });
      replaySession = {
        replayId: freshReplayId,
        startedAtMs: freshStartedAtMs,
        sequence: 0,
        ...(normalized.linkBaseUrl
          ? { linkBaseUrl: normalized.linkBaseUrl }
          : {}),
        resumed: false,
      };
    }
  }
  if (
    state.startGeneration !== startGeneration ||
    (normalized.shouldStart && !normalized.shouldStart())
  ) {
    try {
      replayChannel?.close();
    } catch {
      // best-effort cleanup
    }
    return { started: false, reason: "disabled", sessionId, sampled };
  }
  state.options = normalized;
  state.replayId = replaySession.replayId;
  state.startedAtMs = replaySession.startedAtMs;
  state.replayLinkBaseUrl =
    replaySession.linkBaseUrl ?? normalized.linkBaseUrl ?? null;
  state.sequence = replaySession.sequence;
  state.queue = [];
  state.queuedBytes = 0;
  state.retryBatches = [];
  state.pendingReplayUpload = null;
  state.pendingReplayStart = null;
  state.pendingFlushReason = null;
  for (const resolve of state.pendingFlushWaiters.splice(0)) resolve();
  state.awaitingFullSnapshot = false;
  state.resourceNodes.clear();
  state.stopRecorder = null;
  state.broadcastChannel = replayChannel;
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
      maskInputOptions: DEFAULT_MASK_INPUT_OPTIONS,
    });
    if (typeof stopRecorder !== "function") {
      state.active = false;
      state.options = null;
      state.replayId = null;
      state.startedAtMs = null;
      state.lastAuthenticatedProperties = null;
      try {
        state.broadcastChannel?.close();
      } catch {
        // best-effort cleanup
      }
      state.broadcastChannel = null;
      return { started: false, reason: "record-failed", sessionId, sampled };
    }
    state.stopRecorder = stopRecorder;
    state.flushTimer = window.setInterval(
      () => void flushSessionReplay("interval"),
      normalized.flushIntervalMs,
    );
    if (normalized.maxDurationMs !== undefined) {
      const elapsedReplayDurationMs = Math.max(
        0,
        Date.now() - (state.startedAtMs ?? Date.now()),
      );
      state.maxDurationTimer = window.setTimeout(
        () => stopSessionReplay("max-duration"),
        Math.max(0, normalized.maxDurationMs - elapsedReplayDurationMs),
      );
    }
    installUrlMonitor(state);
    installLifecycleListeners(state);
    installSessionReplayIframeBridge(state, normalized);
    state.takeFullSnapshot =
      typeof rrweb.record.takeFullSnapshot === "function"
        ? rrweb.record.takeFullSnapshot.bind(rrweb.record)
        : null;
    state.addCustomEvent =
      typeof rrweb.record.addCustomEvent === "function"
        ? rrweb.record.addCustomEvent
        : null;
    installCaptureInterceptors(state);
    try {
      normalized.onRecordingStarted?.(replaySession.replayId);
    } catch {
      // coercion-ok: telemetry-hook failure must not turn a working recorder into a failed start.
      // A telemetry callback cannot turn a working recorder into a failed start.
    }
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
    state.restoreIframeBridge?.();
    state.addCustomEvent = null;
    state.active = false;
    state.options = null;
    state.replayId = null;
    state.startedAtMs = null;
    state.lastAuthenticatedProperties = null;
    try {
      state.broadcastChannel?.close();
    } catch {
      // best-effort cleanup
    }
    state.broadcastChannel = null;
    return { started: false, reason: "record-failed", sessionId, sampled };
  }
}

export async function stopSessionReplay(reason = "manual"): Promise<void> {
  const state = getState();
  state.startGeneration += 1;
  if (reason !== "upload-timeout") state.pendingReplayStart = null;
  if (reason !== "pagehide-persisted") {
    state.bfcacheRestored = false;
  }
  if (!state.active) return;
  const isCappedStop = reason === "max-duration" || reason === "max-chunks";
  const cappedReplayId = isCappedStop ? state.replayId : null;
  try {
    state.restoreCaptures?.();
  } catch {
    // best-effort interceptor teardown
  }
  state.restoreCaptures = null;
  state.restoreIframeBridge?.();
  state.active = false;
  state.addCustomEvent = null;
  try {
    state.stopRecorder?.();
  } catch {
    // best-effort recorder shutdown
  }
  state.stopRecorder = null;
  if (isCappedStop) {
    if (reason === "max-chunks") {
      state.queue = [];
      state.queuedBytes = 0;
      state.retryBatches = [];
    }
    const cap = reason === "max-duration" ? "max_duration" : "chunk_count";
    enqueueReplayEvent(
      state,
      {
        type: 5,
        timestamp: Date.now(),
        data: {
          tag: SESSION_REPLAY_LIFECYCLE_EVENT_TAG,
          payload: { outcome: "recording_capped", cap },
        },
      },
      false,
    );
  }
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
  try {
    state.broadcastChannel?.close();
  } catch {
    // best-effort cleanup
  }
  state.broadcastChannel = null;
  const sequenceBeforeFinalFlush = state.sequence;
  await flushSessionReplay(reason);
  if (
    cappedReplayId &&
    state.sequence > sequenceBeforeFinalFlush &&
    !state.pendingReplayUpload &&
    !hasPendingReplayBatch(state)
  ) {
    removeStoredReplaySession(cappedReplayId);
  }
}

export function maybeStartSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  return startSessionReplay(options);
}

export function isSessionReplayActive(): boolean {
  return getState().active;
}

export function getSessionReplayId(): string | null {
  const state = getState();
  if (state.active && state.replayId) return state.replayId;
  const stored = readStoredReplaySession();
  return stored?.replayId ?? null;
}

export {
  getSessionReplayContext,
  getSessionReplayUrl,
} from "./session-replay-context.js";
export type {
  SessionReplayContext,
  SessionReplayLinkOptions,
} from "./session-replay-context.js";

export function emitSessionReplayException(input: {
  type: string;
  message: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  stack?: string;
  url?: string;
}): void {
  const state = getState();
  if (!state.active || !state.addCustomEvent) return;
  const level =
    input.level === "warning"
      ? "warn"
      : input.level === "info" || input.level === "debug"
        ? input.level
        : "error";
  emitReplayCustomEvent(state, SESSION_REPLAY_CONSOLE_EVENT_TAG, {
    level,
    source: "console",
    message: `${input.type}: ${input.message}`.slice(
      0,
      MAX_CONSOLE_MESSAGE_LENGTH,
    ),
    ...(input.stack
      ? { stack: input.stack.slice(0, MAX_CONSOLE_STACK_LENGTH) }
      : {}),
    ...(input.url ? { url: input.url } : {}),
  });
}

export type SessionReplayAgentChatEvent = {
  phase: "surface-mounted" | "run-observed" | "run-stopped";
  surface: string | number;
  threadId?: string | number;
  runId?: string | number;
  tabId?: string | number;
};

export function emitSessionReplayAgentChatEvent(
  input: SessionReplayAgentChatEvent,
): void {
  const state = getState();
  if (!state.active || !state.addCustomEvent) return;
  const bounded = (value: string | number | undefined, max = 160) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value).slice(0, max) : undefined;
    }
    return value?.trim().slice(0, max) || undefined;
  };
  emitReplayCustomEvent(state, SESSION_REPLAY_AGENT_CHAT_EVENT_TAG, {
    phase: input.phase,
    surface: bounded(input.surface, 80) ?? "app",
    ...(bounded(input.threadId) ? { threadId: bounded(input.threadId) } : {}),
    ...(bounded(input.runId) ? { runId: bounded(input.runId) } : {}),
    ...(bounded(input.tabId) ? { tabId: bounded(input.tabId) } : {}),
  });
}
