const DEFAULT_CLIPS_BASE_URL = "https://clips.agent-native.com";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const MAX_CONSOLE_LOGS = 400;
const MAX_NETWORK_REQUESTS = 400;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_URL_LENGTH = 1_000;
const SECRET_KEY_FRAGMENT =
  "(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|session|credential)";
const AUTHORIZATION_SCHEME_RE =
  /\b(authorization)\b(\s*[:=]\s*)(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const DOUBLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);
const SINGLE_QUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)'(?:[^'\\\\]|\\\\.)*'`,
  "gi",
);
const UNQUOTED_SECRET_VALUE_RE = new RegExp(
  `(["']?)([A-Za-z0-9_$.-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_$.-]*)\\1(\\s*[:=]\\s*)([^"',\\s;}\\]]+)`,
  "gi",
);

type CaptureSurface = "browser" | "window" | "monitor" | "camera";
type ConsoleLevel = "debug" | "log" | "info" | "warn" | "error";
type NetworkType = "fetch" | "xhr";

type ExtensionSettings = {
  clipsBaseUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeDeveloperLogs: boolean;
};

type PopupStartMessage = {
  type: "CLIPS_POPUP_START";
  settings?: Partial<ExtensionSettings>;
};

type ExternalMessage =
  | {
      type: "CLIPS_CAPTURE_START";
      sessionId?: string;
      recordingId?: string;
      pageUrl?: string;
    }
  | {
      type: "CLIPS_CAPTURE_STOP";
      sessionId?: string;
      recordingId?: string;
    }
  | {
      type: "CLIPS_CAPTURE_CANCEL";
      sessionId?: string;
    };

type ChromeTab = {
  id?: number;
  title?: string;
  url?: string;
};

type ConsoleLog = {
  timestampMs: number;
  elapsedMs: number;
  level: ConsoleLevel;
  message: string;
  stack?: string;
};

type NetworkRequest = {
  timestampMs: number;
  elapsedMs: number;
  type: NetworkType;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs: number;
  error?: string;
};

type BrowserDiagnosticsData = {
  pageUrl: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt: string;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
  summary: {
    consoleCount: number;
    consoleErrorCount: number;
    consoleWarnCount: number;
    networkCount: number;
    networkFailureCount: number;
    capturedAt: string | null;
  };
};

type PendingNetworkRequest = {
  requestId: string;
  timestampMs: number;
  elapsedMs: number;
  startedAtMonotonicSeconds: number | null;
  type: NetworkType;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ok?: boolean;
  error?: string;
};

type CaptureSession = {
  sessionId: string;
  targetTabId: number;
  targetTitle: string | null;
  targetUrl: string | null;
  recordingId: string | null;
  startedAt: string;
  startedAtMs: number;
  includeDeveloperLogs: boolean;
  attached: boolean;
  attachError: string | null;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
  pendingNetworkRequests: Map<string, PendingNetworkRequest>;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: DEFAULT_CLIPS_BASE_URL,
  captureSurface: "browser",
  includeCamera: true,
  includeDeveloperLogs: true,
};

const sessions = new Map<string, CaptureSession>();
const tabToSession = new Map<number, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactString(value: string): string {
  return value
    .replace(AUTHORIZATION_SCHEME_RE, "$1$2<redacted>")
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi, "$1 <redacted>")
    .replace(DOUBLE_QUOTED_SECRET_VALUE_RE, '$1$2$1$3"<redacted>"')
    .replace(SINGLE_QUOTED_SECRET_VALUE_RE, "$1$2$1$3'<redacted>'")
    .replace(UNQUOTED_SECRET_VALUE_RE, "$1$2$1$3<redacted>")
    .replace(/([?&][^=\s&?#]+)=([^&\s#]+)/g, "$1=<redacted>");
}

function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const redacted = redactString(raw);
  try {
    const parsed = new URL(redacted);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const params = new URLSearchParams();
    for (const key of parsed.searchParams.keys()) {
      params.set(key, "<redacted>");
    }
    parsed.search = params.toString();
    return truncate(parsed.toString(), MAX_URL_LENGTH);
  } catch {
    return truncate(redacted, MAX_URL_LENGTH);
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_CLIPS_BASE_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_CLIPS_BASE_URL;
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_CLIPS_BASE_URL;
  }
}

function normalizeSurface(value: unknown): CaptureSurface {
  if (
    value === "browser" ||
    value === "window" ||
    value === "monitor" ||
    value === "camera"
  ) {
    return value;
  }
  return DEFAULT_SETTINGS.captureSurface;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function chromeLastError(): Error | null {
  const error = chrome.runtime.lastError;
  return error ? new Error(error.message) : null;
}

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (value) => resolve(value));
  });
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(value, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readSettings(
  overrides?: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const stored = await storageGet([
    "clipsBaseUrl",
    "captureSurface",
    "includeCamera",
    "includeDeveloperLogs",
  ]);
  return {
    clipsBaseUrl: normalizeBaseUrl(
      overrides?.clipsBaseUrl ?? stored.clipsBaseUrl,
    ),
    captureSurface: normalizeSurface(
      overrides?.captureSurface ?? stored.captureSurface,
    ),
    includeCamera: normalizeBoolean(
      overrides?.includeCamera ?? stored.includeCamera,
      DEFAULT_SETTINGS.includeCamera,
    ),
    includeDeveloperLogs: normalizeBoolean(
      overrides?.includeDeveloperLogs ?? stored.includeDeveloperLogs,
      DEFAULT_SETTINGS.includeDeveloperLogs,
    ),
  };
}

function queryActiveTab(): Promise<ChromeTab | null> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve((tabs[0] as ChromeTab | undefined) ?? null);
    });
  });
}

function createTab(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function debuggerAttach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function debuggerDetach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function debuggerSendCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      const error = chromeLastError();
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function buildRecordUrl(
  settings: ExtensionSettings,
  sessionId: string,
  tab: ChromeTab,
): string {
  const recordUrl = new URL(`${settings.clipsBaseUrl}/record`);
  const mode =
    settings.captureSurface === "camera"
      ? "camera"
      : settings.includeCamera
        ? "screen+camera"
        : "screen";
  const surface =
    settings.captureSurface === "camera" ? "browser" : settings.captureSurface;

  recordUrl.searchParams.set("mode", mode);
  recordUrl.searchParams.set("surface", surface);
  recordUrl.searchParams.set("clipsExtensionId", chrome.runtime.id);
  recordUrl.searchParams.set("clipsCaptureSessionId", sessionId);
  recordUrl.searchParams.set(
    "developerLogs",
    settings.includeDeveloperLogs ? "1" : "0",
  );
  if (tab.title) recordUrl.searchParams.set("sourceTitle", tab.title);
  if (tab.url) recordUrl.searchParams.set("sourceUrl", tab.url);
  return recordUrl.toString();
}

function createSession(
  sessionId: string,
  tab: ChromeTab,
  settings: ExtensionSettings,
): CaptureSession {
  if (typeof tab.id === "number") {
    const existing = tabToSession.get(tab.id);
    if (existing) {
      void deleteSession(existing);
    }
  }

  const startedAtMs = nowMs();
  const session: CaptureSession = {
    sessionId,
    targetTabId: tab.id as number,
    targetTitle: tab.title?.trim() || null,
    targetUrl: tab.url?.trim() || null,
    recordingId: null,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    includeDeveloperLogs: settings.includeDeveloperLogs,
    attached: false,
    attachError: null,
    consoleLogs: [],
    networkRequests: [],
    pendingNetworkRequests: new Map(),
  };
  sessions.set(sessionId, session);
  tabToSession.set(session.targetTabId, sessionId);
  return session;
}

async function handlePopupStart(message: PopupStartMessage) {
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "No active tab is available to record." };
  }

  const settings = await readSettings(message.settings);
  await storageSet(settings);

  const sessionId = crypto.randomUUID();
  createSession(sessionId, tab, settings);
  await createTab(buildRecordUrl(settings, sessionId, tab));

  return { ok: true, sessionId };
}

function summarize(snapshot: {
  endedAt: string;
  consoleLogs: ConsoleLog[];
  networkRequests: NetworkRequest[];
}): BrowserDiagnosticsData["summary"] {
  return {
    consoleCount: snapshot.consoleLogs.length,
    consoleErrorCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "error",
    ).length,
    consoleWarnCount: snapshot.consoleLogs.filter(
      (entry) => entry.level === "warn",
    ).length,
    networkCount: snapshot.networkRequests.length,
    networkFailureCount: snapshot.networkRequests.filter(
      (entry) =>
        Boolean(entry.error) ||
        (typeof entry.status === "number" && entry.status >= 400),
    ).length,
    capturedAt: snapshot.endedAt || null,
  };
}

function pendingNetworkSnapshot(session: CaptureSession): NetworkRequest[] {
  const endedAtMs = nowMs();
  return Array.from(session.pendingNetworkRequests.values()).map((entry) => ({
    timestampMs: entry.timestampMs,
    elapsedMs: entry.elapsedMs,
    type: entry.type,
    method: entry.method,
    url: entry.url,
    ...(typeof entry.status === "number" ? { status: entry.status } : {}),
    ...(entry.statusText ? { statusText: entry.statusText } : {}),
    ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
    durationMs: Math.max(0, endedAtMs - entry.timestampMs),
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

function snapshotSession(session: CaptureSession): BrowserDiagnosticsData {
  const endedAt = nowIso();
  const consoleLogs = session.consoleLogs.slice(-MAX_CONSOLE_LOGS);
  const networkRequests = [
    ...session.networkRequests,
    ...pendingNetworkSnapshot(session),
  ].slice(-MAX_NETWORK_REQUESTS);
  return {
    pageUrl: sanitizeUrl(session.targetUrl),
    userAgent:
      typeof navigator === "undefined"
        ? "Chrome extension"
        : navigator.userAgent,
    startedAt: session.startedAt,
    endedAt,
    consoleLogs,
    networkRequests,
    summary: summarize({ endedAt, consoleLogs, networkRequests }),
  };
}

async function attachSession(session: CaptureSession): Promise<void> {
  if (!session.includeDeveloperLogs || session.attached) return;
  try {
    await debuggerAttach(session.targetTabId);
    session.attached = true;
    tabToSession.set(session.targetTabId, session.sessionId);
    await Promise.allSettled([
      debuggerSendCommand(session.targetTabId, "Runtime.enable"),
      debuggerSendCommand(session.targetTabId, "Log.enable"),
      debuggerSendCommand(session.targetTabId, "Network.enable", {
        maxTotalBufferSize: 0,
        maxResourceBufferSize: 0,
        maxPostDataSize: 0,
      }),
    ]);
  } catch (err) {
    session.attachError =
      err instanceof Error ? err.message : "Could not attach to the tab.";
    pushConsole(session, {
      level: "warn",
      message: `Clips could not attach browser diagnostics: ${session.attachError}`,
    });
  }
}

async function detachSession(session: CaptureSession): Promise<void> {
  if (session.attached) {
    await debuggerDetach(session.targetTabId);
  }
  session.attached = false;
  tabToSession.delete(session.targetTabId);
}

async function deleteSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  await detachSession(session);
  sessions.delete(sessionId);
}

function pushConsole(
  session: CaptureSession,
  entry: {
    level: ConsoleLevel;
    message: string;
    stack?: string | null;
    timestampMs?: number | null;
  },
): void {
  const timestampMs = Number.isFinite(entry.timestampMs)
    ? (entry.timestampMs as number)
    : nowMs();
  const message = truncate(redactString(entry.message), MAX_MESSAGE_LENGTH);
  const stack = entry.stack
    ? truncate(redactString(entry.stack), MAX_MESSAGE_LENGTH)
    : "";
  session.consoleLogs.push({
    timestampMs,
    elapsedMs: Math.max(0, timestampMs - session.startedAtMs),
    level: entry.level,
    message,
    ...(stack ? { stack } : {}),
  });
  if (session.consoleLogs.length > MAX_CONSOLE_LOGS) {
    session.consoleLogs.splice(
      0,
      session.consoleLogs.length - MAX_CONSOLE_LOGS,
    );
  }
}

function pushNetwork(session: CaptureSession, entry: NetworkRequest): void {
  session.networkRequests.push(entry);
  if (session.networkRequests.length > MAX_NETWORK_REQUESTS) {
    session.networkRequests.splice(
      0,
      session.networkRequests.length - MAX_NETWORK_REQUESTS,
    );
  }
}

function consoleLevel(value: unknown): ConsoleLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "log";
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function remoteObjectText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const object = value as Record<string, unknown>;
  if ("value" in object) {
    const primitive = object.value;
    return typeof primitive === "string"
      ? primitive
      : (safeJson(primitive) ?? String(primitive));
  }
  if (typeof object.unserializableValue === "string") {
    return object.unserializableValue;
  }
  if (typeof object.description === "string") {
    return object.description;
  }
  if (typeof object.type === "string") {
    return `<${object.type}>`;
  }
  return "<value>";
}

function stackTraceText(stackTrace: unknown): string | null {
  if (!stackTrace || typeof stackTrace !== "object") return null;
  const frames = (stackTrace as { callFrames?: unknown }).callFrames;
  if (!Array.isArray(frames)) return null;
  const lines = frames
    .map((frame) => {
      if (!frame || typeof frame !== "object") return null;
      const item = frame as Record<string, unknown>;
      const fn =
        typeof item.functionName === "string" && item.functionName.trim()
          ? item.functionName
          : "(anonymous)";
      const url = typeof item.url === "string" ? item.url : "";
      const line =
        typeof item.lineNumber === "number" ? item.lineNumber + 1 : null;
      const column =
        typeof item.columnNumber === "number" ? item.columnNumber + 1 : null;
      return `${fn} (${url}${line !== null ? `:${line}` : ""}${
        column !== null ? `:${column}` : ""
      })`;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length ? lines.join("\n") : null;
}

function handleConsoleEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const args = Array.isArray(event.args) ? event.args : [];
  const message = args.map(remoteObjectText).join(" ");
  if (!message) return;
  pushConsole(session, {
    level: consoleLevel(event.type),
    message,
    stack: stackTraceText(event.stackTrace),
    timestampMs:
      typeof event.timestamp === "number" ? event.timestamp : undefined,
  });
}

function handleExceptionEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const details = (params as { exceptionDetails?: unknown }).exceptionDetails;
  if (!details || typeof details !== "object") return;
  const item = details as Record<string, unknown>;
  const exception = item.exception as Record<string, unknown> | undefined;
  const description =
    (typeof exception?.description === "string" && exception.description) ||
    (typeof exception?.value === "string" && exception.value) ||
    (typeof item.text === "string" && item.text) ||
    "Unhandled exception";
  pushConsole(session, {
    level: "error",
    message: description,
    stack: stackTraceText(item.stackTrace),
  });
}

function handleLogEntryEvent(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const entry = (params as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") return;
  const item = entry as Record<string, unknown>;
  const text = typeof item.text === "string" ? item.text : "";
  if (!text) return;
  const source = typeof item.source === "string" ? `${item.source}: ` : "";
  pushConsole(session, {
    level: consoleLevel(item.level),
    message: `${source}${text}`,
    timestampMs:
      typeof item.timestamp === "number" ? item.timestamp : undefined,
  });
}

function trackedNetworkType(value: unknown): NetworkType | null {
  if (value === "XHR") return "xhr";
  if (value === "Fetch") return "fetch";
  return null;
}

function requestTimestampMs(params: Record<string, unknown>): number {
  return typeof params.wallTime === "number"
    ? Math.round(params.wallTime * 1000)
    : nowMs();
}

function handleRequestWillBeSent(
  session: CaptureSession,
  params: unknown,
): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const type = trackedNetworkType(event.type);
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  const request =
    event.request && typeof event.request === "object"
      ? (event.request as Record<string, unknown>)
      : null;
  if (!type || !requestId || !request) return;
  const timestampMs = requestTimestampMs(event);
  const url = sanitizeUrl(typeof request.url === "string" ? request.url : "");
  if (!url) return;
  session.pendingNetworkRequests.set(requestId, {
    requestId,
    timestampMs,
    elapsedMs: Math.max(0, timestampMs - session.startedAtMs),
    startedAtMonotonicSeconds:
      typeof event.timestamp === "number" ? event.timestamp : null,
    type,
    method:
      typeof request.method === "string"
        ? truncate(request.method.toUpperCase(), 24)
        : "GET",
    url,
  });
}

function handleResponseReceived(
  session: CaptureSession,
  params: unknown,
): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  if (!requestId) return;
  const pending = session.pendingNetworkRequests.get(requestId);
  if (!pending) return;
  const response =
    event.response && typeof event.response === "object"
      ? (event.response as Record<string, unknown>)
      : null;
  if (!response) return;
  if (typeof response.status === "number") {
    pending.status = Math.round(response.status);
    pending.ok = response.status >= 200 && response.status < 400;
  }
  if (typeof response.statusText === "string") {
    pending.statusText = truncate(redactString(response.statusText), 120);
  }
}

function finalizeNetworkRequest(
  session: CaptureSession,
  requestId: string,
  params: Record<string, unknown>,
  error?: string,
): void {
  const pending = session.pendingNetworkRequests.get(requestId);
  if (!pending) return;
  session.pendingNetworkRequests.delete(requestId);
  const monotonicEnd =
    typeof params.timestamp === "number" ? params.timestamp : null;
  const durationMs =
    monotonicEnd !== null && pending.startedAtMonotonicSeconds !== null
      ? Math.max(0, (monotonicEnd - pending.startedAtMonotonicSeconds) * 1000)
      : Math.max(0, nowMs() - pending.timestampMs);
  pushNetwork(session, {
    timestampMs: pending.timestampMs,
    elapsedMs: pending.elapsedMs,
    type: pending.type,
    method: pending.method,
    url: pending.url,
    ...(typeof pending.status === "number" ? { status: pending.status } : {}),
    ...(pending.statusText ? { statusText: pending.statusText } : {}),
    ...(typeof pending.ok === "boolean" ? { ok: pending.ok } : {}),
    durationMs: Math.round(durationMs),
    ...(error
      ? { error: truncate(redactString(error), MAX_MESSAGE_LENGTH) }
      : {}),
  });
}

function handleLoadingFinished(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  if (requestId) finalizeNetworkRequest(session, requestId, event);
}

function handleLoadingFailed(session: CaptureSession, params: unknown): void {
  if (!params || typeof params !== "object") return;
  const event = params as Record<string, unknown>;
  const requestId =
    typeof event.requestId === "string" ? event.requestId : null;
  const errorText =
    typeof event.errorText === "string" ? event.errorText : "Request failed";
  if (requestId) finalizeNetworkRequest(session, requestId, event, errorText);
}

async function handleExternalMessage(message: ExternalMessage) {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "Invalid message." };
  }

  if (message.type === "CLIPS_CAPTURE_START") {
    if (!message.sessionId) return { ok: false, error: "Missing sessionId." };
    const session = sessions.get(message.sessionId);
    if (!session) return { ok: false, error: "Capture session not found." };
    session.recordingId = message.recordingId ?? null;
    session.startedAtMs = nowMs();
    session.startedAt = new Date(session.startedAtMs).toISOString();
    session.consoleLogs = [];
    session.networkRequests = [];
    session.pendingNetworkRequests.clear();
    await attachSession(session);
    return {
      ok: true,
      attached: session.attached,
      developerLogs: session.includeDeveloperLogs,
      attachError: session.attachError,
    };
  }

  if (message.type === "CLIPS_CAPTURE_STOP") {
    if (!message.sessionId) return { ok: false, error: "Missing sessionId." };
    const session = sessions.get(message.sessionId);
    if (!session) return { ok: false, error: "Capture session not found." };
    session.recordingId = message.recordingId ?? session.recordingId;
    const diagnostics = snapshotSession(session);
    await deleteSession(message.sessionId);
    return { ok: true, diagnostics };
  }

  if (message.type === "CLIPS_CAPTURE_CANCEL") {
    if (message.sessionId) await deleteSession(message.sessionId);
    return { ok: true };
  }

  return { ok: false, error: "Unknown message." };
}

chrome.runtime.onInstalled.addListener(() => {
  void readSettings().then((settings) => storageSet(settings));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "CLIPS_POPUP_START") return false;
  void handlePopupStart(message as PopupStartMessage)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : "Could not open Clips.",
      });
    });
  return true;
});

chrome.runtime.onMessageExternal.addListener(
  (message, _sender, sendResponse) => {
    void handleExternalMessage(message as ExternalMessage)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Could not collect diagnostics.",
        });
      });
    return true;
  },
);

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  const sessionId = tabToSession.get(tabId);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return;
  try {
    if (method === "Runtime.consoleAPICalled") {
      handleConsoleEvent(session, params);
    } else if (method === "Runtime.exceptionThrown") {
      handleExceptionEvent(session, params);
    } else if (method === "Log.entryAdded") {
      handleLogEntryEvent(session, params);
    } else if (method === "Network.requestWillBeSent") {
      handleRequestWillBeSent(session, params);
    } else if (method === "Network.responseReceived") {
      handleResponseReceived(session, params);
    } else if (method === "Network.loadingFinished") {
      handleLoadingFinished(session, params);
    } else if (method === "Network.loadingFailed") {
      handleLoadingFailed(session, params);
    }
  } catch (err) {
    pushConsole(session, {
      level: "warn",
      message: `Clips skipped a diagnostics event: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    });
  }
});

chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  const sessionId = tabToSession.get(tabId);
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (session) session.attached = false;
  tabToSession.delete(tabId);
});
