import { redactCapturedString } from "../observability/trace-redaction.js";
import { redact, SECRET_KEY_RE } from "../tracking/redaction.js";
import {
  actionErrorCode,
  actionErrorStatus,
} from "./action-failure-circuit.js";
import { injectedAgentNativeAppId } from "./app-config.js";
import { clientBuildId } from "./build-compatibility.js";
import { normalizeCapturedError } from "./error-capture.js";

export type RecorderEventType =
  | "action"
  | "state"
  | "nav"
  | "error"
  | "toast"
  | "log";

export type RecorderReportReason = "user" | "error" | "test" | "manual";

export interface RecorderEvent {
  /** Seconds before the report was made (negative). */
  t: number;
  /** Epoch ms, the same clock as Clips diagnostics `timestampMs`. */
  at: number;
  type: RecorderEventType;
  name?: string;
  ok?: boolean;
  status?: number;
  errorCode?: string;
  ms?: number;
  requestId?: string;
  /** Redacted and bounded: strings ≤ 200 characters, the event ≤ about 2 KB. */
  data?: Record<string, unknown>;
}

export interface RecorderPendingWork {
  type: "action" | "state" | string;
  name: string;
  ageMs: number;
}

export interface RecorderReport {
  app: string;
  build: string;
  /** The route path, with every query value redacted. */
  url: string;
  at: string;
  reason: RecorderReportReason;
  windowSeconds: number;
  events: RecorderEvent[];
  watched: Record<string, unknown>;
  pending: RecorderPendingWork[];
  /** Events lost to the caps since the last clear. */
  dropped: number;
}

export interface RecorderReportOptions {
  seconds?: number;
  reason?: RecorderReportReason;
}

type StoredEvent = Omit<RecorderEvent, "t">;
type NewEvent = Omit<StoredEvent, "at">;
type Budget = { left: number };
type Work = { type: "action" | "state"; name: string; since: number };
type ExtraRedaction = { field: string } | { path: RegExp };

const MAX_STRING_LENGTH = 200;
const MAX_DATA_CHARS = 1_600;
const MAX_WATCHED_CHARS = 4_096;
// Bounds the tab's memory whatever maxEvents is set to.
const MAX_BUFFER_CHARS = 512 * 1024;
const MAX_STATE_SNAPSHOT_CHARS = 16 * 1024;
const MAX_STATE_BASELINES = 16;
const MAX_DEPTH = 6;
const ERROR_REPORT_INTERVAL_MS = 10_000;
const REQUEST_ID_HEADER = "x-agent-native-request-id";
const REDACTED = "[redacted]";
const REMOVED = "[removed]";
const SECRET_KEY = new RegExp(`${SECRET_KEY_RE.source}|session|card|cvv`, "i");
const TOAST_SELECTOR = "[data-sonner-toast]";
// Sonner mounts this list with the first toast, so other inserted DOM is never scanned.
const TOASTER_SELECTOR = "[data-sonner-toaster]";

let windowSeconds = 120;
let maxEvents = 2_000;
let sentry = true;
let enabled = true;
let started = false;
let buffer: { event: StoredEvent; chars: number }[] = [];
let bufferChars = 0;
let dropped = 0;
let recordingSince = Date.now();
// Bumped by every clear, so work that started before a sign-out records nothing.
let generation = 0;
let lastPath: string | null = null;
let lastErrorReportAt = -Infinity;
let nextWorkId = 0;
let toastObserver: MutationObserver | null = null;
const inFlight = new Map<number, Work>();
// The last value each key saved, so a write records only what it changed.
const stateBaselines = new Map<string, unknown>();
const watchers = new Map<string, () => unknown>();
const listeners = new Set<(report: RecorderReport) => void>();
const extraRedactions: ExtraRedaction[] = [];

function recording(): boolean {
  return enabled && typeof window !== "undefined";
}

function record(build: () => NewEvent): void {
  if (!recording()) return;
  try {
    push(build());
  } catch {
    // The app never sees a recorder failure; the lost event is still counted.
    dropped += 1;
  }
}

function push(event: NewEvent): void {
  const stored: StoredEvent = {
    at: Date.now(),
    ...event,
    ...(event.name === undefined
      ? {}
      : { name: cleanString(event.name, true) }),
    ...(event.data === undefined
      ? {}
      : {
          data: clean(
            event.data,
            redactionRoot(event.name),
            { left: MAX_DATA_CHARS },
            0,
            true,
          ) as Record<string, unknown>,
        }),
  };
  const chars = JSON.stringify(stored).length;
  buffer.push({ event: stored, chars });
  bufferChars += chars;
  trim(stored.at);
}

function trim(now: number): void {
  const oldest = now - windowSeconds * 1000;
  while (buffer.length > 0 && buffer[0]!.event.at < oldest) {
    bufferChars -= buffer.shift()!.chars;
  }
  while (buffer.length > maxEvents || bufferChars > MAX_BUFFER_CHARS) {
    bufferChars -= buffer.shift()!.chars;
    dropped += 1;
  }
}

function redactText(text: string, truncated: boolean): string {
  const masked = redactCapturedString(redact(text), { truncated });
  return masked === text
    ? text
    : masked.replace(/<redacted>|\[REDACTED\]/g, REDACTED);
}

function cleanString(
  value: string,
  redactSecrets: boolean,
  budget?: Budget,
): string {
  const cut = value.length > MAX_STRING_LENGTH;
  let text = cut ? value.slice(0, MAX_STRING_LENGTH) : value;
  if (redactSecrets) text = redactText(text, cut);
  if (cut) text += "…";
  if (budget) budget.left -= text.length + 2;
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactionRoot(name: string | undefined): string | null {
  return extraRedactions.length > 0 ? (name ?? "") : null;
}

function isRedactedField(key: string, path: string | null): boolean {
  if (SECRET_KEY.test(key)) return true;
  if (path === null) return false;
  return extraRedactions.some((rule) =>
    "field" in rule ? rule.field === key : rule.path.test(path),
  );
}

/**
 * A JSON-safe copy with secret fields redacted and strings and size capped.
 * What does not fit is replaced by a marker that says what was cut.
 */
function clean(
  value: unknown,
  path: string | null,
  budget: Budget,
  depth: number,
  redactSecrets: boolean,
): unknown {
  if (typeof value === "string") {
    return cleanString(value, redactSecrets, budget);
  }
  if (typeof value === "number") {
    budget.left -= 8;
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean" || value === null) {
    budget.left -= 5;
    return value;
  }
  if (typeof value === "bigint")
    return cleanString(String(value), false, budget);
  if (typeof value !== "object") return undefined;
  if (value instanceof Error) {
    return cleanString(
      `${value.name}: ${value.message}`,
      redactSecrets,
      budget,
    );
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return clean(
      (value as { toJSON(): unknown }).toJSON(),
      path,
      budget,
      depth + 1,
      redactSecrets,
    );
  }
  if (depth >= MAX_DEPTH) {
    budget.left -= 5;
    return "[…]";
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      if (budget.left <= 0) {
        out.push(`[+${value.length - i} more]`);
        break;
      }
      const item = clean(
        value[i],
        path === null ? null : `${path}.${i}`,
        budget,
        depth + 1,
        redactSecrets,
      );
      out.push(item === undefined ? null : item);
    }
    return out;
  }
  if (!isPlainObject(value)) {
    return cleanString(
      `[${value.constructor?.name ?? "object"}]`,
      false,
      budget,
    );
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    if (budget.left <= 0) {
      out["…"] = `+${keys.length - i} more keys`;
      break;
    }
    budget.left -= key.length + 4;
    const childPath = path === null ? null : `${path}.${key}`;
    if (isRedactedField(key, childPath)) {
      out[key] = REDACTED;
      budget.left -= REDACTED.length;
      continue;
    }
    const child = clean(
      value[key],
      childPath,
      budget,
      depth + 1,
      redactSecrets,
    );
    if (child !== undefined) out[key] = child;
  }
  return out;
}

function sameValue(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  return (
    typeof previous === "object" &&
    typeof next === "object" &&
    JSON.stringify(previous) === JSON.stringify(next)
  );
}

/** Only the leaves that differ, or `undefined` when nothing did. */
function changes(previous: unknown, next: unknown): unknown {
  if (!isPlainObject(previous) || !isPlainObject(next)) {
    return sameValue(previous, next) ? undefined : next;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    const change = changes(previous[key], next[key]);
    if (change !== undefined) out[key] = change;
  }
  for (const key of Object.keys(previous)) {
    if (!(key in next)) out[key] = REMOVED;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function rememberBaseline(key: string, value: unknown): void {
  stateBaselines.delete(key);
  stateBaselines.set(key, value);
  if (stateBaselines.size > MAX_STATE_BASELINES) {
    stateBaselines.delete(stateBaselines.keys().next().value!);
  }
}

function stateChange(
  key: string,
  value: unknown,
  saved: boolean,
): Record<string, unknown> {
  // Secrets are kept out of the snapshot; other text is redacted when the change is recorded.
  const next = clean(
    value,
    redactionRoot(key),
    { left: MAX_STATE_SNAPSHOT_CHARS },
    0,
    false,
  );
  const hadBaseline = stateBaselines.has(key);
  const change = hadBaseline ? changes(stateBaselines.get(key), next) : next;
  if (saved) rememberBaseline(key, next);
  if (!hadBaseline) return { value: change };
  return change === undefined ? { unchanged: true } : { changed: change };
}

function errorMessage(error: unknown): string {
  return normalizeCapturedError(error).message;
}

function stringField(value: unknown, key: string): string | undefined {
  const field =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  return typeof field === "string" ? field : undefined;
}

function trackWork(type: Work["type"], name: string, since: number): number {
  const id = (nextWorkId += 1);
  inFlight.set(id, { type, name, since });
  return id;
}

/** @internal Called when an action starts; call the result when it settles. */
export function recordActionStart(
  name: string,
  method: string,
): (outcome: {
  error: unknown;
  response: Response | undefined;
  signal: AbortSignal | undefined;
}) => void {
  if (!recording()) return () => {};
  const startedAt = Date.now();
  const startedIn = generation;
  const id = trackWork("action", name, startedAt);
  return ({ error, response, signal }) => {
    inFlight.delete(id);
    if (generation !== startedIn) return;
    record(() => {
      const cancelled = Boolean(error) && signal?.aborted === true;
      const status = response?.status ?? actionErrorStatus(error);
      const errorCode = cancelled
        ? "cancelled"
        : (actionErrorCode(error) ?? stringField(error, "code"));
      const requestId =
        response?.headers.get(REQUEST_ID_HEADER) ??
        stringField(error, "requestId");
      return {
        type: "action",
        name,
        ok: !error,
        ...(status === undefined ? {} : { status }),
        ...(errorCode === undefined ? {} : { errorCode }),
        ms: Date.now() - startedAt,
        ...(requestId ? { requestId } : {}),
        data:
          error && !cancelled
            ? { method, error: errorMessage(error) }
            : { method },
      };
    });
  };
}

/** @internal An `application_state` write, or a delete when `value` is undefined. */
export function recordStateWrite(
  key: string,
  value: unknown,
  write: Promise<unknown>,
  signal: AbortSignal | undefined,
): void {
  if (!recording()) return;
  const startedAt = Date.now();
  const startedIn = generation;
  const id = trackWork("state", key, startedAt);
  const settle = (ok: boolean, error?: unknown) => {
    inFlight.delete(id);
    if (generation !== startedIn) return;
    record(() => {
      const cancelled = !ok && signal?.aborted === true;
      const status = ok ? undefined : actionErrorStatus(error);
      const data: Record<string, unknown> =
        value === undefined ? { deleted: true } : stateChange(key, value, ok);
      if (value === undefined && ok) stateBaselines.delete(key);
      if (!ok && !cancelled) data.error = errorMessage(error);
      return {
        type: "state",
        name: key,
        ok,
        ...(status === undefined ? {} : { status }),
        ...(cancelled ? { errorCode: "cancelled" } : {}),
        ms: Date.now() - startedAt,
        data,
      };
    });
  };
  write.then(
    () => settle(true),
    (error: unknown) => settle(false, error),
  );
}

/** @internal */
export function recordNav(): void {
  if (!recording()) return;
  const path = window.location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  record(() => ({ type: "nav", name: path }));
}

function topFrame(stack: string | undefined): string | undefined {
  for (const line of stack?.split("\n") ?? []) {
    const match =
      /(?:^|[\s(@])((?:[a-z][\w+.-]*:\/\/|\/)[^\s()]*):(\d+):\d+\)?\s*$/i.exec(
        line,
      );
    if (!match) continue;
    const file = match[1]!
      .replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, "")
      .replace(/[?#].*$/, "");
    return `${file}:${match[2]}`;
  }
  return undefined;
}

function recordError(error: unknown, kind: "error" | "unhandledrejection") {
  record(() => {
    const { type, message, stack } = normalizeCapturedError(error);
    const source = topFrame(stack);
    return {
      type: "error",
      name: type,
      data: { kind, message, ...(source ? { source } : {}) },
    };
  });
  const now = Date.now();
  // An error loop would otherwise build and send a full report per error.
  if (
    listeners.size > 0 &&
    now - lastErrorReportAt >= ERROR_REPORT_INTERVAL_MS
  ) {
    lastErrorReportAt = now;
    report({ reason: "error" });
  }
}

function onWindowError(event: ErrorEvent): void {
  recordError(event.error ?? event.message, "error");
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  recordError(event.reason, "unhandledrejection");
}

function observeToasts(): MutationObserver {
  const recorded = new WeakMap<Element, string>();
  const check = (toast: Element) => {
    const level = toast.getAttribute("data-type");
    if (level !== "error" && level !== "warning") return;
    const text = (toast.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || recorded.get(toast) === `${level}:${text}`) return;
    recorded.set(toast, `${level}:${text}`);
    record(() => ({ type: "toast", name: level, data: { text } }));
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target as Element;
        if (target.matches(TOAST_SELECTOR)) check(target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(TOAST_SELECTOR)) check(node);
        else if (node.matches(TOASTER_SELECTOR)) {
          node.querySelectorAll(TOAST_SELECTOR).forEach(check);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-type"],
  });
  return observer;
}

function reportUrl(): string {
  const { pathname, search } = window.location;
  const keys = [...new Set(new URLSearchParams(search).keys())];
  const query = keys
    .map((key) => `${encodeURIComponent(key)}=${REDACTED}`)
    .join("&");
  return cleanString(pathname, true) + (query ? `?${query}` : "");
}

/** @internal The report without notifying `onReport` listeners, for core's own destinations. */
export function buildRecorderReport(
  reason: RecorderReportReason,
  seconds?: number,
): RecorderReport {
  if (seconds !== undefined && !(seconds >= 0)) {
    throw new RangeError(
      "recorder.report({ seconds }) needs a number of seconds of 0 or more.",
    );
  }
  const now = Date.now();
  trim(now);
  const requested =
    seconds === undefined ? windowSeconds : Math.min(seconds, windowSeconds);
  const from = now - requested * 1000;
  const events: RecorderEvent[] = [];
  for (const { event } of buffer) {
    if (event.at >= from) {
      events.push({ t: (event.at - now) / 1000, ...event });
    }
  }
  const watched: Record<string, unknown> = {};
  if (enabled) {
    for (const [name, getValue] of watchers) {
      try {
        watched[name] = clean(
          getValue(),
          redactionRoot(name),
          { left: MAX_WATCHED_CHARS },
          0,
          true,
        );
      } catch (error) {
        watched[name] = { unreadable: cleanString(errorMessage(error), true) };
      }
    }
  }
  return {
    app: injectedAgentNativeAppId() ?? (window.location.host || "unknown"),
    build: clientBuildId() || "unknown",
    url: reportUrl(),
    at: new Date(now).toISOString(),
    reason,
    windowSeconds: Math.min(
      requested,
      Math.max(0, Math.ceil((now - recordingSince) / 1000)),
    ),
    events,
    watched,
    pending: pending(),
    dropped,
  };
}

function report(options: RecorderReportOptions = {}): RecorderReport {
  const built = buildRecorderReport(
    options.reason ?? "manual",
    options.seconds,
  );
  if (built.reason === "manual" || !enabled) return built;
  for (const listener of listeners) {
    try {
      listener(built);
    } catch (error) {
      console.error(
        "[agent-native] A recorder onReport listener failed.",
        error,
      );
    }
  }
  return built;
}

function pending(): RecorderPendingWork[] {
  const now = Date.now();
  return [...inFlight.values()].map(({ type, name, since }) => ({
    type,
    name,
    ageMs: now - since,
  }));
}

function redactPattern(path: string): ExtraRedaction {
  if (!path.includes(".")) return { field: path };
  const segments = path
    .split(".")
    .map((segment) =>
      segment === "*"
        ? "[^.]+"
        : segment.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"),
    );
  return { path: new RegExp(`^${segments.join("\\.")}$`) };
}

export const recorder = {
  /** Synchronous. Listeners hear about every report except a `"manual"` one. */
  report,

  log(name: string, data?: unknown): void {
    record(() => ({
      type: "log",
      name,
      ...(data === undefined
        ? {}
        : { data: isPlainObject(data) ? data : { value: data } }),
    }));
  },

  /** Adds `getValue()` to every report. Returns a function that stops it. */
  watch(name: string, getValue: () => unknown): () => void {
    watchers.set(name, getValue);
    return () => {
      if (watchers.get(name) === getValue) watchers.delete(name);
    };
  },

  onReport(listener: (report: RecorderReport) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Field names (`"body"`), or dotted paths that start with the event's name (`"compose.body"`, `"payment.*"`). */
  redact(...keys: string[]): void {
    for (const key of keys) extraRedactions.push(redactPattern(key));
  },

  pending,

  disable(): void {
    configureRecorder({ enabled: false });
  },
};

declare global {
  interface Window {
    __agentNativeRecorder?: { report: typeof report };
  }
}

export function configureRecorder(options: {
  windowSeconds?: number;
  maxEvents?: number;
  sentry?: boolean;
  enabled?: boolean;
}): void {
  if (options.windowSeconds !== undefined) {
    if (
      !(Number.isFinite(options.windowSeconds) && options.windowSeconds > 0)
    ) {
      throw new RangeError(
        "configureRecorder({ windowSeconds }) needs a positive number of seconds.",
      );
    }
    windowSeconds = options.windowSeconds;
  }
  if (options.maxEvents !== undefined) {
    if (!(Number.isInteger(options.maxEvents) && options.maxEvents > 0)) {
      throw new RangeError(
        "configureRecorder({ maxEvents }) needs a positive whole number.",
      );
    }
    maxEvents = options.maxEvents;
  }
  if (options.sentry !== undefined) sentry = options.sentry;
  if (options.enabled === false) stopRecorder();
  if (options.enabled === true) {
    enabled = true;
    startRecorder();
  }
  trim(Date.now());
}

/** @internal Whether `ensureSentry()` should attach recorder events. */
export function recorderSentryEnabled(): boolean {
  return enabled && sentry;
}

/** @internal Forgets everything recorded, e.g. on sign-out. */
export function clearRecorder(): void {
  buffer = [];
  bufferChars = 0;
  dropped = 0;
  recordingSince = Date.now();
  generation += 1;
  inFlight.clear();
  lastPath = null;
  stateBaselines.clear();
}

/** @internal Called once from client bootstrap. */
export function startRecorder(): void {
  if (
    started ||
    !recording() ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }
  started = true;
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("popstate", recordNav);
  if (typeof MutationObserver === "function") toastObserver = observeToasts();
  window.__agentNativeRecorder = { report };
  recordNav();
}

function stopRecorder(): void {
  enabled = false;
  clearRecorder();
  toastObserver?.disconnect();
  toastObserver = null;
  if (!started) return;
  started = false;
  window.removeEventListener("error", onWindowError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
  window.removeEventListener("popstate", recordNav);
  delete window.__agentNativeRecorder;
}

/** @internal */
export function resetRecorderForTests(): void {
  stopRecorder();
  enabled = true;
  windowSeconds = 120;
  maxEvents = 2_000;
  sentry = true;
  lastErrorReportAt = -Infinity;
  watchers.clear();
  listeners.clear();
  extraRedactions.length = 0;
}
