
export interface AgentChatMessage {
  message: string;
  context?: string;
  submit?: boolean;
}

const AGENT_CHAT_MESSAGE_TYPE = "agentNative.submitChat";

const isBrowser =
  typeof window !== "undefined" && typeof window.postMessage === "function";

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
    console.log(
      "BUILDER_PARENT_MESSAGE:" +
        JSON.stringify({ message: payload, targetOrigin: "*" }),
    );
  }
}

function submit(message: string, context?: string): void {
  send({ message, context, submit: true });
}

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
  send,
  submit,
  prefill,
  call,
};
