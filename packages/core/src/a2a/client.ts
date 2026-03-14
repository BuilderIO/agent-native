import type {
  AgentCard,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Task,
} from "./types.js";

export class A2AClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const res = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`A2A request failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<JsonRpcResponse>;
  }

  async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent-card.json`);
    if (!res.ok) {
      throw new Error(`Failed to fetch agent card (${res.status})`);
    }
    return res.json() as Promise<AgentCard>;
  }

  async send(
    message: Message,
    opts?: { contextId?: string; metadata?: Record<string, unknown> },
  ): Promise<Task> {
    const response = await this.rpc("message/send", {
      message,
      contextId: opts?.contextId,
      metadata: opts?.metadata,
    });

    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }

    return response.result as Task;
  }

  async *stream(
    message: Message,
    opts?: { contextId?: string; metadata?: Record<string, unknown> },
  ): AsyncGenerator<Task> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "message/stream",
      params: {
        message,
        contextId: opts?.contextId,
        metadata: opts?.metadata,
      },
    };

    const res = await fetch(`${this.baseUrl}/a2a`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`A2A stream failed (${res.status}): ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (!json) continue;

        const response: JsonRpcResponse = JSON.parse(json);
        if (response.error) {
          throw new Error(
            `A2A error (${response.error.code}): ${response.error.message}`,
          );
        }
        if (response.result) {
          yield response.result as Task;
        }
      }
    }
  }
}

/**
 * One-shot convenience function: send a text message and get a text response.
 */
export async function callAgent(
  url: string,
  text: string,
  opts?: { apiKey?: string; contextId?: string },
): Promise<string> {
  const client = new A2AClient(url, opts?.apiKey);
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text }],
    },
    { contextId: opts?.contextId },
  );

  // Extract text from the response
  const responseMessage = task.status.message;
  if (responseMessage) {
    const textParts = responseMessage.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text);
    return textParts.join("\n");
  }

  return "";
}
