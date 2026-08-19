const MCP_CONNECTION_RESUME_STORAGE_KEY = "agent-native:mcp-connection-resume";
const MCP_CONNECTION_RESUME_EVENT = "agent-native:mcp-connection-complete";
const MCP_CONNECTION_RESUME_TTL_MS = 10 * 60 * 1_000;
const MCP_CONNECTION_RESUME_MAX_MESSAGE_LENGTH = 24_000;

export interface McpConnectionResumeRequest {
  message: string;
  returnUrl: string;
  createdAt: number;
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

export function saveMcpConnectionResume(message: string): boolean {
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
  };
  try {
    storage.setItem(MCP_CONNECTION_RESUME_STORAGE_KEY, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

export function clearMcpConnectionResume(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(MCP_CONNECTION_RESUME_STORAGE_KEY);
  } catch {
    // Ignore storage-denied browsers; the pending request is best effort.
  }
}

export function consumeMcpConnectionResume(
  returnUrl = currentReturnUrl(),
): McpConnectionResumeRequest | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  let request: McpConnectionResumeRequest;
  try {
    const raw = storage.getItem(MCP_CONNECTION_RESUME_STORAGE_KEY);
    if (!raw) return null;
    request = JSON.parse(raw) as McpConnectionResumeRequest;
  } catch {
    clearMcpConnectionResume();
    return null;
  }

  if (
    !request ||
    typeof request.message !== "string" ||
    typeof request.returnUrl !== "string" ||
    typeof request.createdAt !== "number"
  ) {
    clearMcpConnectionResume();
    return null;
  }
  if (Date.now() - request.createdAt > MCP_CONNECTION_RESUME_TTL_MS) {
    clearMcpConnectionResume();
    return null;
  }
  if (request.returnUrl !== returnUrl) return null;

  clearMcpConnectionResume();
  return request;
}

export function notifyMcpConnectionComplete(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MCP_CONNECTION_RESUME_EVENT));
}

export function addMcpConnectionCompleteListener(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MCP_CONNECTION_RESUME_EVENT, listener);
  return () =>
    window.removeEventListener(MCP_CONNECTION_RESUME_EVENT, listener);
}
