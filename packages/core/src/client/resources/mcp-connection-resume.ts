const MCP_CONNECTION_RESUME_STORAGE_KEY = "agent-native:mcp-connection-resume";
const MCP_CONNECTION_RESUME_EVENT = "agent-native:mcp-connection-complete";
const MCP_CONNECTION_RESUME_COMPLETION_STORAGE_PREFIX =
  "agent-native:mcp-connection-completion:";
const MCP_CONNECTION_RESUME_TTL_MS = 10 * 60 * 1_000;
const MCP_CONNECTION_RESUME_MAX_MESSAGE_LENGTH = 24_000;
const completedResumeIds = new Set<string>();

export interface McpConnectionResumeRequest {
  message: string;
  returnUrl: string;
  createdAt: number;
  completionId?: string;
  agentKit?: {
    threadId: string;
    runId: string;
    requestId: string;
  };
}

function currentReturnUrl(): string {
  if (typeof window === "undefined") return "/";
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // coercion-ok: callers fail closed when local storage is unavailable.
    return null;
  }
}

function clearCompletionMarker(completionId: string): void {
  completedResumeIds.delete(completionId);
  try {
    getLocalStorage()?.removeItem(
      MCP_CONNECTION_RESUME_COMPLETION_STORAGE_PREFIX + completionId,
    );
  } catch {
    // coercion-ok: stale markers cannot complete the newer opaque attempt.
  }
}

export function saveMcpConnectionResume(
  message: string,
  agentKit?: McpConnectionResumeRequest["agentKit"],
  completionId?: string,
): boolean {
  const trimmedMessage = message.trim();
  if (
    !trimmedMessage ||
    trimmedMessage.length > MCP_CONNECTION_RESUME_MAX_MESSAGE_LENGTH
  ) {
    return false;
  }
  const storage = getSessionStorage();
  if (!storage) return false;

  const request: McpConnectionResumeRequest = {
    message: trimmedMessage,
    returnUrl: currentReturnUrl(),
    createdAt: Date.now(),
    ...(completionId ? { completionId } : {}),
    ...(agentKit ? { agentKit } : {}),
  };
  const previousCompletionId = readStoredMcpConnectionResume()?.completionId;
  try {
    storage.setItem(MCP_CONNECTION_RESUME_STORAGE_KEY, JSON.stringify(request));
  } catch {
    return false;
  }
  if (previousCompletionId) clearCompletionMarker(previousCompletionId);
  return true;
}

function removeStoredMcpConnectionResume(completionId?: string): void {
  const storage = getSessionStorage();
  if (!storage) return;
  let storedCompletionId: string | undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(MCP_CONNECTION_RESUME_STORAGE_KEY);
  } catch {
    return;
  }
  if (raw) {
    try {
      const request = JSON.parse(raw) as { completionId?: unknown };
      if (typeof request.completionId === "string") {
        storedCompletionId = request.completionId;
      }
    } catch {
      // coercion-ok: malformed records are removed below and cannot be resumed.
    }
  }
  if (completionId && storedCompletionId !== completionId) return;
  try {
    storage.removeItem(MCP_CONNECTION_RESUME_STORAGE_KEY);
  } catch {
    // Keep its completion marker so a readable request can still be retried.
    return;
  }
  const completedId = completionId ?? storedCompletionId;
  if (completedId) clearCompletionMarker(completedId);
}

function readStoredMcpConnectionResume(): McpConnectionResumeRequest | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  let request: McpConnectionResumeRequest;
  try {
    const raw = storage.getItem(MCP_CONNECTION_RESUME_STORAGE_KEY);
    if (!raw) return null;
    request = JSON.parse(raw) as McpConnectionResumeRequest;
  } catch {
    removeStoredMcpConnectionResume();
    return null;
  }

  if (
    !request ||
    typeof request.message !== "string" ||
    typeof request.returnUrl !== "string" ||
    typeof request.createdAt !== "number" ||
    (request.completionId !== undefined &&
      (typeof request.completionId !== "string" || !request.completionId))
  ) {
    removeStoredMcpConnectionResume();
    return null;
  }
  if (
    request.agentKit !== undefined &&
    (!request.agentKit ||
      typeof request.agentKit.threadId !== "string" ||
      !request.agentKit.threadId.trim() ||
      typeof request.agentKit.runId !== "string" ||
      !request.agentKit.runId.trim() ||
      typeof request.agentKit.requestId !== "string" ||
      !request.agentKit.requestId.trim())
  ) {
    removeStoredMcpConnectionResume();
    return null;
  }
  if (Date.now() - request.createdAt > MCP_CONNECTION_RESUME_TTL_MS) {
    removeStoredMcpConnectionResume();
    return null;
  }
  return request;
}

function isCompletionRecorded(completionId: string): boolean {
  if (completedResumeIds.has(completionId)) return true;
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    return (
      storage.getItem(
        MCP_CONNECTION_RESUME_COMPLETION_STORAGE_PREFIX + completionId,
      ) === "1"
    );
  } catch {
    // coercion-ok: unreadable completion state fails closed and keeps the request pending.
    return false;
  }
}

export function getPendingMcpConnectionResume(
  returnUrl = currentReturnUrl(),
): McpConnectionResumeRequest | null {
  const request = readStoredMcpConnectionResume();
  if (!request) return null;
  if (request.returnUrl !== returnUrl) return null;
  if (request.completionId && !isCompletionRecorded(request.completionId)) {
    return null;
  }
  return request;
}

export function clearMcpConnectionResume(
  expected?: McpConnectionResumeRequest | string,
): void {
  const current = readStoredMcpConnectionResume();
  if (typeof expected === "string" && current?.completionId !== expected) {
    return;
  }
  if (
    expected &&
    typeof expected !== "string" &&
    (!current ||
      current.createdAt !== expected.createdAt ||
      current.returnUrl !== expected.returnUrl ||
      current.message !== expected.message ||
      current.completionId !== expected.completionId ||
      current.agentKit?.threadId !== expected.agentKit?.threadId ||
      current.agentKit?.runId !== expected.agentKit?.runId ||
      current.agentKit?.requestId !== expected.agentKit?.requestId)
  ) {
    return;
  }
  removeStoredMcpConnectionResume(
    typeof expected === "string" ? expected : current?.completionId,
  );
}

export function consumeMcpConnectionResume(
  returnUrl = currentReturnUrl(),
): McpConnectionResumeRequest | null {
  const request = getPendingMcpConnectionResume(returnUrl);
  if (request) clearMcpConnectionResume(request);
  return request;
}

export function notifyMcpConnectionComplete(completionId?: string): void {
  if (typeof window === "undefined") return;
  if (completionId) {
    const request = readStoredMcpConnectionResume();
    if (request?.completionId !== completionId) return;
    completedResumeIds.add(completionId);
    try {
      getLocalStorage()?.setItem(
        MCP_CONNECTION_RESUME_COMPLETION_STORAGE_PREFIX + completionId,
        "1",
      );
    } catch {
      // coercion-ok: the active page can use this signal; reloads fail closed.
    }
  }
  window.dispatchEvent(new Event(MCP_CONNECTION_RESUME_EVENT));
}

export function addMcpConnectionCompleteListener(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key?.startsWith(MCP_CONNECTION_RESUME_COMPLETION_STORAGE_PREFIX) &&
      event.newValue !== null
    ) {
      listener();
    }
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      event.origin !== window.location.origin ||
      typeof event.data !== "object" ||
      event.data === null ||
      !("type" in event.data) ||
      event.data.type !== "agent-native:workspace-connection-complete" ||
      !("completionId" in event.data) ||
      typeof event.data.completionId !== "string" ||
      !event.source
    ) {
      return;
    }
    notifyMcpConnectionComplete(event.data.completionId);
  };
  window.addEventListener(MCP_CONNECTION_RESUME_EVENT, listener);
  window.addEventListener("storage", onStorage);
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(MCP_CONNECTION_RESUME_EVENT, listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("message", onMessage);
  };
}
