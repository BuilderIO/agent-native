import {
  A2AClient,
  callAgent,
  type Message,
  type Task,
} from "@agent-native/core/a2a";

export interface AgentEndpointOptions {
  /**
   * Optional URL base used when resolving relative app URLs.
   */
  base?: string;
}

export interface SendMessageOptions {
  apiKey?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
  requestTimeoutMs?: number;
  /**
   * If the target does not support streaming, fall back to async send + poll.
   * Defaults to true.
   */
  fallbackToPolling?: boolean;
  timeoutMs?: number;
  userEmail?: string;
  orgDomain?: string;
  orgSecret?: string;
}

function appUrl(url: string, options: AgentEndpointOptions = {}): URL {
  const base =
    options.base ??
    (typeof window !== "undefined"
      ? window.location.href
      : "http://agent-native.local");
  return new URL(url, base);
}

function trimEndpointPath(pathname: string, suffix: string): string | null {
  const normalized = pathname.replace(/\/$/, "");
  if (!normalized.endsWith(suffix)) return null;
  return normalized.slice(0, -suffix.length) || "/";
}

export function getMcpUrl(
  url: string,
  options: AgentEndpointOptions = {},
): string {
  const parsed = appUrl(url, options);
  const trimmed = trimEndpointPath(parsed.pathname, "/_agent-native/mcp");
  if (trimmed !== null) {
    parsed.pathname = `${trimmed.replace(/\/$/, "")}/_agent-native/mcp`;
  } else {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/_agent-native/mcp`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function getA2AUrl(
  url: string,
  options: AgentEndpointOptions = {},
): string {
  const parsed = appUrl(url, options);
  const agentNativeTrimmed = trimEndpointPath(
    parsed.pathname,
    "/_agent-native/a2a",
  );
  const legacyTrimmed = trimEndpointPath(parsed.pathname, "/a2a");
  if (agentNativeTrimmed !== null) {
    parsed.pathname = `${agentNativeTrimmed.replace(/\/$/, "")}/_agent-native/a2a`;
  } else if (legacyTrimmed !== null) {
    parsed.pathname = `${legacyTrimmed.replace(/\/$/, "")}/_agent-native/a2a`;
  } else {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/_agent-native/a2a`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function getAgentCardUrl(
  url: string,
  options: AgentEndpointOptions = {},
): string {
  const parsed = appUrl(url, options);
  parsed.pathname = "/.well-known/agent-card.json";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function textMessage(text: string): Message {
  return {
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function extractTaskText(task: Task): string {
  return (
    task.status.message?.parts
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text" && typeof part.text === "string";
      })
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

/**
 * Send a text prompt to an Agent-Native A2A endpoint and yield text deltas.
 */
export async function* sendMessage(
  url: string,
  text: string,
  options: SendMessageOptions = {},
): AsyncGenerator<string> {
  const client = new A2AClient(url, options.apiKey, {
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const message = textMessage(text);
  let previous = "";
  let yielded = false;

  try {
    for await (const task of client.stream(message, {
      contextId: options.contextId,
      metadata: options.metadata,
    })) {
      const next = extractTaskText(task);
      const chunk = next.startsWith(previous)
        ? next.slice(previous.length)
        : next;
      previous = next;
      if (chunk) {
        yielded = true;
        yield chunk;
      }
    }
    return;
  } catch (error) {
    if (yielded || options.fallbackToPolling === false) throw error;
  }

  const answer = await callAgent(url, text, {
    apiKey: options.apiKey,
    contextId: options.contextId,
    timeoutMs: options.timeoutMs,
    userEmail: options.userEmail,
    orgDomain: options.orgDomain,
    orgSecret: options.orgSecret,
    async: true,
  });
  if (answer) yield answer;
}

export { A2AClient };
export type { Message, Task };
