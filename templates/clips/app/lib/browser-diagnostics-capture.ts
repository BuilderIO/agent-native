import {
  MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS,
  MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS,
  MAX_BROWSER_DIAGNOSTIC_URL_LENGTH,
  redactBrowserDiagnosticString,
  summarizeBrowserDiagnostics,
  type BrowserDiagnosticConsoleLevel,
  type BrowserDiagnosticConsoleLog,
  type BrowserDiagnosticNetworkRequest,
  type BrowserDiagnosticsData,
} from "@shared/browser-diagnostics";

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

export interface BrowserDiagnosticsCapture {
  stop: () => BrowserDiagnosticsData;
  dispose: () => void;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactString(value: string): string {
  return redactBrowserDiagnosticString(value);
}

function redactUrlString(value: string): string {
  return redactBrowserDiagnosticString(value, { redactQueryValues: true });
}

function sanitizeUrl(raw: string): string {
  const redacted = redactUrlString(raw);
  try {
    const parsed = new URL(redacted, window.location.href);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const params = new URLSearchParams();
    for (const key of parsed.searchParams.keys()) {
      params.set(key, "<redacted>");
    }
    parsed.search = params.toString();
    return truncate(parsed.toString(), MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  } catch {
    return truncate(redacted, MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  }
}

function stringifyArg(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ??
    (typeof input === "object" && "method" in input ? input.method : "") ??
    "GET"
  ).toUpperCase();
}

export function createBrowserDiagnosticsCapture(): BrowserDiagnosticsCapture {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const startedAtPerf = performance.now();
  const consoleLogs: BrowserDiagnosticConsoleLog[] = [];
  const networkRequests: BrowserDiagnosticNetworkRequest[] = [];
  const originalConsole = {
    debug: console.debug,
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const xhrState = new WeakMap<
    XMLHttpRequest,
    {
      method: string;
      url: string;
      startedAtPerf: number;
      startedAtMs: number;
    }
  >();
  let active = true;
  let stoppedSnapshot: BrowserDiagnosticsData | null = null;

  const elapsed = () =>
    Math.max(0, Math.round(performance.now() - startedAtPerf));
  const timestamp = () => startedAtMs + elapsed();

  const pushConsole = (
    level: BrowserDiagnosticConsoleLevel,
    args: unknown[],
  ) => {
    if (!active) return;
    const message = truncate(
      redactString(args.map(stringifyArg).join(" ")),
      MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
    );
    const errorArg = args.find((arg): arg is Error => arg instanceof Error);
    const stack = errorArg?.stack
      ? truncate(
          redactString(errorArg.stack),
          MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
        )
      : undefined;
    if (consoleLogs.length >= MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS) {
      consoleLogs.shift();
    }
    consoleLogs.push({
      timestampMs: timestamp(),
      elapsedMs: elapsed(),
      level,
      message,
      ...(stack ? { stack } : {}),
    });
  };

  const pushNetwork = (
    entry: Omit<
      BrowserDiagnosticNetworkRequest,
      "timestampMs" | "elapsedMs" | "url" | "method"
    > & {
      startedAtPerf: number;
      startedAtMs: number;
      url: string;
      method: string;
    },
  ) => {
    if (!active) return;
    if (networkRequests.length >= MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS) {
      networkRequests.shift();
    }
    networkRequests.push({
      timestampMs: entry.startedAtMs,
      elapsedMs: Math.max(0, Math.round(entry.startedAtPerf - startedAtPerf)),
      type: entry.type,
      method: truncate(entry.method.toUpperCase(), 24),
      url: sanitizeUrl(entry.url),
      ...(typeof entry.status === "number" ? { status: entry.status } : {}),
      ...(entry.statusText
        ? { statusText: truncate(redactString(entry.statusText), 120) }
        : {}),
      ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      ...(entry.error
        ? {
            error: truncate(
              redactString(entry.error),
              MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
            ),
          }
        : {}),
    });
  };

  const wrapConsole = (level: ConsoleMethod) => {
    console[level] = (...args: unknown[]) => {
      pushConsole(level, args);
      originalConsole[level].apply(console, args);
    };
  };

  for (const level of ["debug", "log", "info", "warn", "error"] as const) {
    wrapConsole(level);
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAtPerfForRequest = performance.now();
    const startedAtMsForRequest = Date.now();
    const method = requestMethod(input, init);
    const url = requestUrl(input);
    try {
      const response = await originalFetch.call(window, input, init);
      pushNetwork({
        startedAtPerf: startedAtPerfForRequest,
        startedAtMs: startedAtMsForRequest,
        type: "fetch",
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        durationMs: performance.now() - startedAtPerfForRequest,
      });
      return response;
    } catch (err) {
      pushNetwork({
        startedAtPerf: startedAtPerfForRequest,
        startedAtMs: startedAtMsForRequest,
        type: "fetch",
        method,
        url,
        durationMs: performance.now() - startedAtPerfForRequest,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    xhrState.set(this, {
      method,
      url: String(url),
      startedAtPerf: 0,
      startedAtMs: 0,
    });
    return originalXhrOpen.call(
      this,
      method,
      String(url),
      async ?? true,
      username,
      password,
    );
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const existing = xhrState.get(this);
    if (existing) {
      existing.startedAtPerf = performance.now();
      existing.startedAtMs = Date.now();
      const finish = (error?: string) => {
        const state = xhrState.get(this);
        if (!state) return;
        pushNetwork({
          startedAtPerf: state.startedAtPerf,
          startedAtMs: state.startedAtMs,
          type: "xhr",
          method: state.method,
          url: state.url,
          status: this.status || undefined,
          statusText: this.statusText || undefined,
          ok: this.status >= 200 && this.status < 400,
          durationMs: performance.now() - state.startedAtPerf,
          error,
        });
        xhrState.delete(this);
      };
      this.addEventListener("loadend", () => finish(), { once: true });
      this.addEventListener("error", () => finish("XMLHttpRequest failed"), {
        once: true,
      });
      this.addEventListener("abort", () => finish("XMLHttpRequest aborted"), {
        once: true,
      });
      this.addEventListener(
        "timeout",
        () => finish("XMLHttpRequest timed out"),
        {
          once: true,
        },
      );
    }
    return originalXhrSend.call(this, body ?? null);
  };

  const onError = (event: ErrorEvent) => {
    pushConsole("error", [
      event.error instanceof Error ? event.error : event.message,
    ]);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    pushConsole("error", [
      event.reason instanceof Error ? event.reason : String(event.reason),
    ]);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  const restore = () => {
    window.fetch = originalFetch;
    for (const level of ["debug", "log", "info", "warn", "error"] as const) {
      console[level] = originalConsole[level];
    }
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.send = originalXhrSend;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };

  const stop = () => {
    if (stoppedSnapshot) return stoppedSnapshot;
    active = false;
    restore();
    const endedAt = new Date().toISOString();
    const snapshot = {
      pageUrl: sanitizeUrl(window.location.href),
      userAgent: truncate(
        redactString(navigator.userAgent),
        MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
      ),
      startedAt,
      endedAt,
      consoleLogs: [...consoleLogs],
      networkRequests: [...networkRequests],
    };
    stoppedSnapshot = {
      ...snapshot,
      summary: summarizeBrowserDiagnostics(snapshot),
    };
    return stoppedSnapshot;
  };

  return {
    stop,
    dispose: () => {
      active = false;
      restore();
      stoppedSnapshot = null;
    },
  };
}
