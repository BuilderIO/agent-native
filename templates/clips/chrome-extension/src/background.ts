type ExtensionMessage =
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

type BrowserDiagnosticsData = {
  pageUrl: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt: string;
  consoleLogs: Array<{
    timestampMs: number;
    elapsedMs: number;
    level: "debug" | "log" | "info" | "warn" | "error";
    message: string;
    stack?: string;
  }>;
  networkRequests: Array<{
    timestampMs: number;
    elapsedMs: number;
    type: "fetch" | "xhr";
    method: string;
    url: string;
    status?: number;
    statusText?: string;
    ok?: boolean;
    durationMs: number;
    error?: string;
  }>;
  summary: {
    consoleCount: number;
    consoleErrorCount: number;
    consoleWarnCount: number;
    networkCount: number;
    networkFailureCount: number;
    capturedAt: string | null;
  };
};

type CaptureSession = {
  sessionId: string;
  recordingId: string | null;
  pageUrl: string | null;
  startedAt: string;
};

const sessions = new Map<string, CaptureSession>();

function nowIso(): string {
  return new Date().toISOString();
}

function emptyDiagnostics(session: CaptureSession): BrowserDiagnosticsData {
  const endedAt = nowIso();
  return {
    pageUrl: session.pageUrl,
    userAgent:
      typeof navigator === "undefined"
        ? "Chrome extension"
        : navigator.userAgent,
    startedAt: session.startedAt,
    endedAt,
    consoleLogs: [],
    networkRequests: [],
    summary: {
      consoleCount: 0,
      consoleErrorCount: 0,
      consoleWarnCount: 0,
      networkCount: 0,
      networkFailureCount: 0,
      capturedAt: endedAt,
    },
  };
}

function handleMessage(message: ExtensionMessage) {
  if (!message || typeof message !== "object") return { ok: false };
  if (message.type === "CLIPS_CAPTURE_START") {
    if (!message.sessionId) return { ok: false, error: "missing sessionId" };
    sessions.set(message.sessionId, {
      sessionId: message.sessionId,
      recordingId: message.recordingId ?? null,
      pageUrl: message.pageUrl ?? null,
      startedAt: nowIso(),
    });
    return { ok: true };
  }

  if (message.type === "CLIPS_CAPTURE_STOP") {
    if (!message.sessionId) return { ok: false, error: "missing sessionId" };
    const session =
      sessions.get(message.sessionId) ??
      ({
        sessionId: message.sessionId,
        recordingId: message.recordingId ?? null,
        pageUrl: null,
        startedAt: nowIso(),
      } satisfies CaptureSession);
    sessions.delete(message.sessionId);
    return { ok: true, diagnostics: emptyDiagnostics(session) };
  }

  if (message.type === "CLIPS_CAPTURE_CANCEL") {
    if (message.sessionId) sessions.delete(message.sessionId);
    return { ok: true };
  }

  return { ok: false };
}

chrome.runtime.onMessageExternal.addListener(
  (message, _sender, sendResponse) => {
    sendResponse(handleMessage(message as ExtensionMessage));
    return false;
  },
);
