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
  orgSecret?: string,
): Promise<string> {
  const secret = orgSecret || process.env.A2A_SECRET;
  if (!secret) {
    throw new Error(
      "No A2A secret available. Set an org-level A2A secret in Team settings, " +
        "or set A2A_SECRET as an environment variable on all apps that need to verify identity.",
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
    opts?: {
      contextId?: string;
      metadata?: Record<string, unknown>;
      /**
       * If true, ask the server to return the task immediately in `working`
       * state and process the handler in the background. The caller should
       * then poll `getTask(taskId)` until `completed` / `failed` / `canceled`.
       *
       * Use this when you expect the handler may exceed the gateway timeout
       * (e.g. Netlify's ~26s per-function / 30s gateway limit on Pro).
       */
      async?: boolean;
    },
  ): Promise<Task> {
    const response = await this.rpc("message/send", {
      message,
      contextId: opts?.contextId,
      metadata: opts?.metadata,
      ...(opts?.async ? { async: true } : {}),
    });

    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }

    return response.result as Task;
  }

  /**
   * Poll for a task by id. Used in async mode after `send({ async: true })`.
   */
  async getTask(taskId: string): Promise<Task> {
    const response = await this.rpc("tasks/get", { id: taskId });
    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }
    return response.result as Task;
  }

  /**
   * Send a message in async mode and poll until the task reaches a terminal
   * state. This is the recommended path on serverless hosts with short
   * function timeouts (Netlify, Vercel) where a synchronous LLM-driven A2A
   * call can exceed the gateway limit.
   *
   * Each individual fetch returns quickly; long-running work happens on the
   * receiving side and is checked via `tasks/get`.
   */
  async sendAndWait(
    message: Message,
    opts?: {
      contextId?: string;
      metadata?: Record<string, unknown>;
      /** Total time to wait for completion. Default 5 min. */
      timeoutMs?: number;
      /** Poll interval. Default 2s. */
      pollIntervalMs?: number;
      /** Called with each polled task — useful for surfacing progress. */
      onUpdate?: (task: Task) => void;
    },
  ): Promise<Task> {
    const submitted = await this.send(message, {
      contextId: opts?.contextId,
      metadata: opts?.metadata,
      async: true,
    });

    const terminalStates = new Set(["completed", "failed", "canceled"]);
    if (terminalStates.has(submitted.status.state)) return submitted;

    const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
    const pollMs = opts?.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;

    let current = submitted;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        current = await this.getTask(submitted.id);
        opts?.onUpdate?.(current);
      } catch (err) {
        // Transient fetch failure — keep polling until the deadline.
        continue;
      }
      if (terminalStates.has(current.status.state)) return current;
    }
    throw new Error(
      `A2A task ${submitted.id} did not complete within ${timeoutMs}ms (last state: ${current.status.state})`,
    );
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
    orgSecret?: string;
    /**
     * Use async/poll instead of a single blocking POST. Recommended for
     * cross-app calls that may exceed serverless gateway timeouts (Netlify
     * caps a single function at ~26s; the gateway times out at ~30s).
     * Defaults to true so callers get safe behavior out of the box.
     */
    async?: boolean;
    /** Total time to wait for the polled task (default 5 min). */
    timeoutMs?: number;
  },
): Promise<string> {
  let apiKey = opts?.apiKey;

  // Auto-sign with JWT when an A2A secret (org or global) is available and we have a user email
  if (
    !apiKey &&
    opts?.userEmail &&
    (opts?.orgSecret || process.env.A2A_SECRET)
  ) {
    try {
      apiKey = await signA2AToken(
        opts.userEmail,
        opts.orgDomain,
        opts.orgSecret,
      );
    } catch {
      // Fall back to unsigned call
    }
  }

  const client = new A2AClient(url, apiKey);
  const metadata: Record<string, unknown> = {};
  if (opts?.userEmail) metadata.userEmail = opts.userEmail;
  if (opts?.orgDomain) metadata.orgDomain = opts.orgDomain;

  // Default to synchronous mode — async mode requires the receiving server to
  // run detached promises after sending the response, which doesn't work
  // reliably on Netlify Functions (the runtime kills the function once the
  // response is flushed). Callers that want async polling can opt in.
  const useAsync = opts?.async ?? false;
  const message: Message = {
    role: "user",
    parts: [{ type: "text", text }],
  };

  let task: Task;
  if (useAsync) {
    task = await client.sendAndWait(message, {
      contextId: opts?.contextId,
      metadata,
      timeoutMs: opts?.timeoutMs,
    });
  } else {
    task = await client.send(message, {
      contextId: opts?.contextId,
      metadata,
    });
  }

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
