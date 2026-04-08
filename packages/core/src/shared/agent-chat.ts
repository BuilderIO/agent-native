/**
 * Isomorphic Agent Chat Utility
 *
 * Works in both browser and Node.js contexts:
 * - Browser: sends via postMessage to the parent window
 * - Node.js (scripts): sends via BUILDER_PARENT_MESSAGE stdout format,
 *   which the Electron host translates to postMessage
 */

export interface AgentChatMessage {
  /** The visible prompt text shown in the chat input */
  message: string;
  /** Hidden context appended to the prompt (not shown to user, but sent to AI) */
  context?: string;
  /** true = auto-submit, false = prefill only, omit = use project setting */
  submit?: boolean;
}

const AGENT_CHAT_MESSAGE_TYPE = "builder.submitChat";

const isBrowser =
  typeof window !== "undefined" && typeof window.postMessage === "function";

/**
 * Send a structured message to the agent chat.
 * Automatically detects environment (browser vs Node.js) and uses the right transport.
 */
function send(data: AgentChatMessage): void {
  const payload = { type: AGENT_CHAT_MESSAGE_TYPE, data };

  if (isBrowser) {
    const target = window.parent !== window ? window.parent : window;
    try {
      target.postMessage(payload, "*");
    } catch (err) {
      console.error("[agentChat] postMessage failed:", err);
    }
  } else {
    // Node.js: use BUILDER_PARENT_MESSAGE stdout format for Electron integration
    console.log(
      "BUILDER_PARENT_MESSAGE:" +
        JSON.stringify({ message: payload, targetOrigin: "*" }),
    );
  }
}

/**
 * Submit a message to the agent chat (auto-submits by default).
 */
function submit(message: string, context?: string): void {
  send({ message, context, submit: true });
}

/**
 * Prefill the agent chat input without submitting (user reviews first).
 */
function prefill(message: string, context?: string): void {
  send({ message, context, submit: false });
}

export interface AgentChatCallOptions {
  context?: string;
  timeout?: number;
  framePort?: number;
}

export interface AgentChatResponse {
  response: string;
  filesChanged: string[];
  warnings?: string[];
}

/**
 * Request/response call to the frame agent.
 * Sends a message to the frame CLI endpoint and awaits a response.
 * Node.js only — requires the frame server to be running.
 */
async function call(
  message: string,
  options?: AgentChatCallOptions,
): Promise<AgentChatResponse> {
  if (isBrowser) {
    throw new Error("agentChat.call() is only available in Node.js");
  }

  const port =
    options?.framePort ??
    (typeof process !== "undefined" && process.env.FRAME_PORT
      ? parseInt(process.env.FRAME_PORT, 10)
      : 3333);
  const timeout = options?.timeout ?? 300_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context: options?.context }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Frame chat failed (${res.status}): ${text}`);
    }

    return (await res.json()) as AgentChatResponse;
  } finally {
    clearTimeout(timer);
  }
}

export const agentChat = {
  /** Send raw AgentChatMessage — full control over all fields */
  send,
  /** Auto-submit a message to agent chat */
  submit,
  /** Prefill the chat input for user review before sending */
  prefill,
  /** Request/response call to the frame agent (Node.js only) */
  call,
};
