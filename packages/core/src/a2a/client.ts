import * as jose from "jose";
import type {
  AgentCard,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Task,
} from "./types.js";

export class A2ATaskTimeoutError extends Error {
  readonly taskId: string;
  readonly lastTask: Task;
  readonly lastState: string;
  readonly timeoutMs: number;

  constructor(taskId: string, lastTask: Task, timeoutMs: number) {
    const lastState = lastTask.status.state;
    super(
      `A2A task ${taskId} did not complete within ${timeoutMs}ms (last state: ${lastState})`,
    );
    this.name = "A2ATaskTimeoutError";
    this.taskId = taskId;
    this.lastTask = lastTask;
    this.lastState = lastState;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Sign a JWT for A2A cross-app identity verification.
 *
 * Uses an org-level secret by default for direct org-secret workflows. Callers
 * that are doing ordinary hosted cross-app delegation can set
 * `preferGlobalSecret` so deployments with a shared A2A_SECRET don't depend on
 * every app database having an identical org row. The token contains the
 * caller's email as `sub`, so the receiving app can verify who's calling.
 */
export async function signA2AToken(
  email: string,
  orgDomain?: string,
  orgSecret?: string,
  options?: { expiresIn?: string | number; preferGlobalSecret?: boolean },
): Promise<string> {
  const secret = options?.preferGlobalSecret
    ? process.env.A2A_SECRET || orgSecret
    : orgSecret || process.env.A2A_SECRET;
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
    .setExpirationTime(options?.expiresIn ?? "15m")
    .sign(new TextEncoder().encode(secret));
}

export class A2AClient {
  private baseUrl: string;
  private apiKey?: string;
  private endpointCandidates: string[] = [];
  private endpointResolved = false;
  private requestTimeoutMs?: number;

  constructor(
    baseUrl: string,
    apiKey?: string,
    options?: { requestTimeoutMs?: number },
  ) {
    const normalized = baseUrl.replace(/\/$/, "");
    const explicitEndpoint = splitExplicitA2AEndpoint(normalized);
    this.baseUrl = explicitEndpoint?.baseUrl ?? normalized;
    if (explicitEndpoint) {
      this.endpointCandidates = [explicitEndpoint.endpointUrl];
      this.endpointResolved = true;
    }
    this.apiKey = apiKey;
    this.requestTimeoutMs = options?.requestTimeoutMs;
  }

  /**
   * Detect which A2A path the target agent uses.
   * Agent-native apps use /_agent-native/a2a, external agents may use /a2a.
   */
  async resolveEndpoint(): Promise<void> {
    await this.ensureEndpointCandidates();
    if (this.endpointCandidates.length <= 1) return;

    for (const endpoint of this.endpointCandidates) {
      try {
        const res = await fetch(endpoint, { method: "OPTIONS" });
        if (res.status !== 404 && res.status !== 405) {
          this.endpointCandidates = [endpoint];
          return;
        }
        if (res.status === 405) {
          this.endpointCandidates = [endpoint];
          return;
        }
      } catch {
        // Try the next candidate.
      }
    }
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

    await this.ensureEndpointCandidates();
    let lastError: Error | null = null;

    for (const url of this.endpointCandidates) {
      console.log(`[A2A Client] POST ${url} method=${method}`);
      const startTime = Date.now();
      const res = await this.postJson(url, body);
      console.log(
        `[A2A Client] Response: ${res.status} in ${Date.now() - startTime}ms`,
      );

      if (res.ok) {
        this.endpointCandidates = [url];
        return res.json() as Promise<JsonRpcResponse>;
      }

      const text = await res.text();
      lastError = new Error(`A2A request failed (${res.status}): ${text}`);
      if (!shouldTryNextEndpoint(res.status)) {
        throw lastError;
      }
    }

    throw lastError ?? new Error("No A2A endpoint candidates available");
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
       * Use this when you expect the handler may exceed a synchronous
       * serverless request budget.
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
    throw new A2ATaskTimeoutError(submitted.id, current, timeoutMs);
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

    await this.ensureEndpointCandidates();
    let res: Response | null = null;
    let lastError: Error | null = null;
    for (const candidate of this.endpointCandidates) {
      res = await this.postJson(candidate, body);
      if (res.ok) {
        this.endpointCandidates = [candidate];
        break;
      }
      const text = await res.text();
      lastError = new Error(`A2A stream failed (${res.status}): ${text}`);
      if (!shouldTryNextEndpoint(res.status)) throw lastError;
    }
    if (!res?.ok) {
      throw lastError ?? new Error("No A2A endpoint candidates available");
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

  private async ensureEndpointCandidates(): Promise<void> {
    if (this.endpointResolved) return;
    this.endpointResolved = true;

    const candidates: string[] = [];
    addDefaultEndpointCandidates(candidates, this.baseUrl);

    try {
      const card = await this.getAgentCard();
      const cardUrl = normalizeUrl(card.url, this.baseUrl);
      if (cardUrl) {
        const explicitEndpoint = splitExplicitA2AEndpoint(cardUrl);
        if (explicitEndpoint) {
          candidates.unshift(explicitEndpoint.endpointUrl);
        } else {
          addDefaultEndpointCandidates(candidates, cardUrl);
        }
      }
    } catch {
      // Agent cards are discovery hints. Fall back to conventional endpoints.
    }

    this.endpointCandidates = unique(candidates);
  }

  private async postJson(url: string, body: JsonRpcRequest): Promise<Response> {
    const controller = this.requestTimeoutMs
      ? new AbortController()
      : undefined;
    const timer =
      controller && this.requestTimeoutMs
        ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
        : undefined;
    try {
      return await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function splitExplicitA2AEndpoint(
  url: string,
): { baseUrl: string; endpointUrl: string } | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/$/, "");
    if (pathname.endsWith("/_agent-native/a2a")) {
      parsed.pathname = pathname.slice(0, -"/_agent-native/a2a".length) || "/";
      parsed.search = "";
      parsed.hash = "";
      return {
        baseUrl: parsed.toString().replace(/\/$/, ""),
        endpointUrl: url,
      };
    }
    if (pathname.endsWith("/a2a")) {
      parsed.pathname = pathname.slice(0, -"/a2a".length) || "/";
      parsed.search = "";
      parsed.hash = "";
      return {
        baseUrl: parsed.toString().replace(/\/$/, ""),
        endpointUrl: url,
      };
    }
  } catch {
    // Relative or invalid URLs are handled by the caller's normal fetch path.
  }
  return null;
}

function addDefaultEndpointCandidates(candidates: string[], baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  candidates.push(`${base}/_agent-native/a2a`, `${base}/a2a`);
}

function normalizeUrl(
  value: string | undefined,
  baseUrl: string,
): string | null {
  if (!value) return null;
  try {
    return new URL(value, `${baseUrl.replace(/\/$/, "")}/`)
      .toString()
      .replace(/\/$/, "");
  } catch {
    return null;
  }
}

function shouldTryNextEndpoint(status: number): boolean {
  return status === 404 || status === 405;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
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
     * cross-app calls that may exceed a synchronous serverless request budget.
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
        { preferGlobalSecret: !opts.orgSecret },
      );
    } catch {
      // Fall back to unsigned call
    }
  }

  const client = new A2AClient(url, apiKey);
  const metadata: Record<string, unknown> = {};
  if (opts?.userEmail) metadata.userEmail = opts.userEmail;
  if (opts?.orgDomain) metadata.orgDomain = opts.orgDomain;

  // Default to async + poll. The receiving A2A server's `_process-task` route
  // runs the handler in a fresh function execution (cross-platform queue
  // pattern), so async mode now works on every host instead of relying on
  // detached promises that get killed on Netlify/Vercel. Callers that
  // explicitly want a single-shot blocking POST can pass `async: false`.
  const useAsync = opts?.async ?? true;
  const message: Message = {
    role: "user",
    parts: [{ type: "text", text }],
  };

  let task: Task;
  if (useAsync) {
    try {
      task = await client.sendAndWait(message, {
        contextId: opts?.contextId,
        metadata,
        timeoutMs: opts?.timeoutMs,
      });
    } catch (err) {
      if (err instanceof A2ATaskTimeoutError) {
        const recoverableText = extractRecoverableArtifactText(err.lastTask);
        if (recoverableText) return recoverableText;
      }
      throw err;
    }
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

function extractRecoverableArtifactText(task: Task): string {
  if (!task.status.message?.metadata?.agentNativeRecoverableArtifacts) {
    return "";
  }
  return extractMessageText(task.status.message);
}

function extractMessageText(message: Message): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
