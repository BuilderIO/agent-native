import * as jose from "jose";
import type {
  AgentCard,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Task,
} from "./types.js";

/**
 * Sign a JWT for A2A cross-app identity verification.
 *
 * Uses A2A_SECRET as an HMAC key. The token contains the caller's email
 * as `sub`, so the receiving app can verify who's calling.
 */
export async function signA2AToken(
  email: string,
  orgDomain?: string,
): Promise<string> {
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    throw new Error(
      "A2A_SECRET is required for authenticated cross-app calls. " +
        "Set the same A2A_SECRET on all apps that need to verify identity.",
    );
  }

  const appUrl =
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";

  return new jose.SignJWT({
    sub: email,
    ...(orgDomain ? { org_domain: orgDomain } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(appUrl)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

export class A2AClient {
  private baseUrl: string;
  private apiKey?: string;
  private a2aPath = "/_agent-native/a2a";

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Detect which A2A path the target agent uses.
   * Agent-native apps use /_agent-native/a2a, external agents may use /a2a.
   */
  async resolveEndpoint(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/_agent-native/a2a`, {
        method: "OPTIONS",
      });
      if (res.status !== 404) return; // /_agent-native/a2a exists
    } catch {}
    this.a2aPath = "/a2a"; // Fallback for external A2A servers
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

    const url = `${this.baseUrl}${this.a2aPath}`;
    console.log(`[A2A Client] POST ${url} method=${method}`);
    const startTime = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    console.log(
      `[A2A Client] Response: ${res.status} in ${Date.now() - startTime}ms`,
    );

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

    const res = await fetch(`${this.baseUrl}${this.a2aPath}`, {
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
 *
 * When A2A_SECRET is set and userEmail is provided, outbound calls are signed
 * with a JWT so the receiving app can cryptographically verify the caller's
 * identity (instead of blindly trusting metadata).
 */
export async function callAgent(
  url: string,
  text: string,
  opts?: {
    apiKey?: string;
    contextId?: string;
    userEmail?: string;
    orgDomain?: string;
  },
): Promise<string> {
  let apiKey = opts?.apiKey;

  // Auto-sign with JWT when A2A_SECRET is available and we have a user email
  if (!apiKey && opts?.userEmail && process.env.A2A_SECRET) {
    try {
      apiKey = await signA2AToken(opts.userEmail, opts.orgDomain);
    } catch {
      // Fall back to unsigned call
    }
  }

  const client = new A2AClient(url, apiKey);
  const metadata: Record<string, unknown> = {};
  if (opts?.userEmail) metadata.userEmail = opts.userEmail;
  if (opts?.orgDomain) metadata.orgDomain = opts.orgDomain;
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text }],
    },
    { contextId: opts?.contextId, metadata },
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
