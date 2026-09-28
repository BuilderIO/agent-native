import type { BrowserDiagnosticsData } from "@shared/browser-diagnostics";

export const VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS = 10_331;

const capturedAt = "2026-09-01T17:53:04.148Z";

const publicFixture = {
  summary: {
    consoleCount: 32,
    consoleErrorCount: 7,
    consoleWarnCount: 0,
    networkCount: 6,
    networkFailureCount: 2,
    capturedAt,
  },
  consoleLogs: [
    {
      timestampMs: 0,
      level: "debug",
      message: "[vite] connecting...", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "debug",
      message: "[vite] connected.", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "info",
      message: // i18n-ignore captured diagnostic fixture
        "%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "info",
      message: // i18n-ignore captured diagnostic fixture
        "[DevTools Capture Demo] Starting preview synchronization Object", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "log",
      message:
        "%c[DevTools Capture Demo] Preview synchronization failed color: #ef4444; font-weight: 700", // guard:allow-raw-color — captured console payload, not app theme styling
    },
    {
      timestampMs: 0,
      level: "error",
      message:
        "Error: PREVIEW_RENDERER_SCHEMA_MISMATCH: The preview renderer requires schema 2026-08, but the browser submitted 2026-07.\n    at triggerDevtoolsErrorDemo (http://localhost:8080/app/lib/devtools-error-demo.ts?t=<redacted>",
    },
    { timestampMs: 0, level: "log", message: "Object" },
    {
      timestampMs: 0,
      level: "log",
      message: "Server response Object", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "log",
      message: // i18n-ignore captured diagnostic fixture
        "Recovery hint: Regenerate the preview payload with the current design-token schema.", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "log",
      message: "console.groupEnd", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 0,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 0,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 0,
      level: "error",
      message:
        "network: Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    },
    {
      timestampMs: 0,
      level: "error",
      message:
        "network: Failed to load resource: the server responded with a status of 502 (Preview Renderer Schema Mismatch)",
    },
    {
      timestampMs: 1483,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 6517,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 6527,
      level: "debug",
      message: "[vite] connecting...", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 6655,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 6656,
      level: "debug",
      message: "[vite] connected.", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 6658,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
    {
      timestampMs: 6689,
      level: "info",
      message: // i18n-ignore captured diagnostic fixture
        "%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 6704,
      level: "error",
      message:
        "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.",
    },
    {
      timestampMs: 6818,
      level: "error",
      message:
        "network: Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    },
    {
      timestampMs: 7763,
      level: "info",
      message: // i18n-ignore captured diagnostic fixture
        "[DevTools Capture Demo] Starting preview synchronization Object", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 8113,
      level: "error",
      message:
        "network: Failed to load resource: the server responded with a status of 502 (Preview Renderer Schema Mismatch)",
    },
    {
      timestampMs: 8114,
      level: "log",
      message:
        "%c[DevTools Capture Demo] Preview synchronization failed color: #ef4444; font-weight: 700", // guard:allow-raw-color — captured console payload, not app theme styling
    },
    {
      timestampMs: 8114,
      level: "error",
      message:
        "Error: PREVIEW_RENDERER_SCHEMA_MISMATCH: The preview renderer requires schema 2026-08, but the browser submitted 2026-07.\n    at triggerDevtoolsErrorDemo (http://localhost:8080/app/lib/devtools-error-demo.ts?t=<redacted>",
    },
    { timestampMs: 8114, level: "log", message: "Object" },
    {
      timestampMs: 8114,
      level: "log",
      message: "Server response Object", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 8114,
      level: "log",
      message: // i18n-ignore captured diagnostic fixture
        "Recovery hint: Regenerate the preview payload with the current design-token schema.", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 8114,
      level: "log",
      message: "console.groupEnd", // i18n-ignore captured diagnostic fixture
    },
    {
      timestampMs: 11_779,
      level: "log",
      message: "[clips-cs] reconcile parts: Array(1) on http://localhost:8080/",
    },
  ],
  networkRequests: [
    {
      timestampMs: 6643,
      type: "fetch",
      method: "GET",
      url: "http://localhost:8080/_agent-native/agent-engine/status",
      status: 200,
      error: null,
      durationMs: 28,
    },
    {
      timestampMs: 6761,
      type: "fetch",
      method: "GET",
      url: "http://localhost:8080/_agent-native/builder/status",
      status: 200,
      error: null,
      durationMs: 24,
    },
    {
      timestampMs: 6762,
      type: "fetch",
      method: "GET",
      url: "http://localhost:8080/api/me/credits",
      status: 401,
      error: null,
      durationMs: 34,
    },
    {
      timestampMs: 7764,
      type: "fetch",
      method: "POST",
      url: "http://localhost:8080/api/demo/preview-sync",
      status: 502,
      error: null,
      durationMs: 348,
    },
    {
      timestampMs: 11_810,
      type: "fetch",
      method: "GET",
      url: "http://localhost:8080/_agent-native/agent-engine/status",
      status: 200,
      error: null,
      durationMs: 22,
    },
    {
      timestampMs: 11_810,
      type: "fetch",
      method: "GET",
      url: "http://localhost:8080/_agent-native/builder/status",
      status: 200,
      error: null,
      durationMs: 26,
    },
  ],
} as const;

function fixtureEpochMs(): number {
  const latestElapsedMs = Math.max(
    ...publicFixture.consoleLogs.map((entry) => entry.timestampMs),
    ...publicFixture.networkRequests.map((entry) => entry.timestampMs),
  );
  return Date.parse(capturedAt) - latestElapsedMs;
}

export function createViewerPreviewBrowserDiagnostics(): BrowserDiagnosticsData {
  const startedAtMs = fixtureEpochMs();
  return {
    pageUrl: null,
    userAgent: null,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: capturedAt,
    summary: { ...publicFixture.summary },
    consoleLogs: publicFixture.consoleLogs.map((entry) => ({
      ...entry,
      timestampMs: startedAtMs + entry.timestampMs,
      elapsedMs: entry.timestampMs,
    })),
    networkRequests: publicFixture.networkRequests.map((entry) => ({
      timestampMs: startedAtMs + entry.timestampMs,
      elapsedMs: entry.timestampMs,
      type: entry.type,
      method: entry.method,
      url: entry.url,
      status: entry.status,
      ok: entry.status < 400,
      durationMs: entry.durationMs,
      ...(entry.error ? { error: entry.error } : {}),
    })),
  };
}

export const VIEWER_PREVIEW_BROWSER_DIAGNOSTICS =
  createViewerPreviewBrowserDiagnostics();
