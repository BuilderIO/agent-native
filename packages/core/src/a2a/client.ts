import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAppConfig } from "../app-config/index.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { canonicalA2AAudience } from "./audience.js";

/**
 * A workspace serves every app from one gateway on loopback, so sibling A2A
 * targets are private addresses by construction and the SSRF guard cannot tell
 * them apart from an attack. Trust only origins this deployment configured for
 * itself — never a value that arrived on a request.
 */
function workspacePrivateOrigins(): string[] {
  const config = getAppConfig();
  // No trimming or blank-dropping here: the config layer trims string values
  // and `a2a.allowedOrigins` rejects empty entries, so the only thing left to
  // drop is an unset optional.
  const origins = [
    config.workspace.gatewayUrl,
    config.app.url,
    ...config.a2a.allowedOrigins,
  ].filter((value): value is string => value !== undefined);

  // The gateway also hands each child the sibling manifest, and siblings are
  // reached on their own loopback ports rather than through the gateway.
  const raw = process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const apps = Array.isArray(parsed?.apps)
        ? parsed.apps
        : Array.isArray(parsed)
          ? parsed
          : [];
      for (const app of apps) {
        const url = app?.url ?? app?.origin ?? app?.baseUrl;
        if (typeof url === "string" && url) origins.push(url);
        const port = app?.port;
        if (typeof port === "number" && Number.isFinite(port)) {
          origins.push(`http://127.0.0.1:${port}`);
        }
      }
    } catch {
      // A malformed manifest must not disable the SSRF guard.
    }
  }
  return origins;
}
import { sanitizeA2ACorrelationMetadata } from "./correlation.js";
import type {
  A2AApprovedAction,
  A2ACorrelationMetadata,
  A2ASourceContextReference,
  A2AReadOnlyActionResult,
  AgentCard,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Task,
} from "./types.js";

const DEFAULT_A2A_POLL_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_A2A_DISCOVERY_TIMEOUT_MS = 3_000;
const MAX_A2A_RPC_ATTEMPTS = 3;
const A2A_RPC_RETRY_BASE_MS = 100;
export const MAX_A2A_CALLER_RESPONSE_CHARS = 32_768;

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

export type A2ATerminalTaskErrorState =
  | "failed"
  | "canceled"
  | "input-required"
  | "completed";

/**
 * Preserves a receiver's terminal protocol state across the text-oriented
 * callAgent convenience boundary. Callers can distinguish a real answer from
 * failure, cancellation, approval/input, and an invalid empty completion
 * without parsing English prose.
 */
export class A2ATaskTerminalError extends Error {
  readonly taskId: string;
  readonly state: A2ATerminalTaskErrorState;
  readonly responseText: string;
  readonly errorCode: string;
  readonly task: Task;

  constructor(
    task: Task,
    state: A2ATerminalTaskErrorState,
    responseText: string,
    errorCode = `a2a_task_${state.replace(/-/g, "_")}`,
  ) {
    const detail = responseText.trim()
      ? `: ${boundA2ACallerResponseText(responseText).trim()}`
      : "";
    super(`A2A task ${task.id} ended ${state}${detail}`);
    this.name = "A2ATaskTerminalError";
    this.taskId = task.id;
    this.state = state;
    this.responseText = boundA2ACallerResponseText(responseText);
    this.errorCode = errorCode;
    this.task = task;
  }
}

/** Keep both the answer lead and artifact/source tail within caller context. */
export function boundA2ACallerResponseText(value: string): string {
  if (value.length <= MAX_A2A_CALLER_RESPONSE_CHARS) return value;
  const marker =
    "\n\n...[A2A response compacted at the caller boundary; use the receiving app or returned artifact links for full details]...\n\n";
  const tailChars = 8_192;
  const headChars = MAX_A2A_CALLER_RESPONSE_CHARS - tailChars - marker.length;
  return value.slice(0, headChars) + marker + value.slice(-tailChars);
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
  options?: {
    expiresIn?: string | number;
    preferGlobalSecret?: boolean;
    audience?: string | string[];
    /**
     * Extra JWT claims to merge alongside `sub` / `org_domain`. Used by the
     * MCP connect flow to add a revocable `jti` and a `scope: "mcp-connect"`
     * marker. Reserved claims (`sub`, `org_domain`) cannot be overridden —
     * they are spread last so a caller can never spoof identity via this map.
     */
    extraClaims?: Record<string, unknown>;
  },
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

  const appUrl = getAppConfig().app.url ?? "http://localhost:3000";

  const jwt = new jose.SignJWT({
    ...(options?.extraClaims ?? {}),
    // `sub` / `org_domain` are spread AFTER extraClaims so a caller-supplied
    // map can never override the verified identity claims.
    sub: email,
    ...(orgDomain ? { org_domain: orgDomain } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(appUrl)
    .setIssuedAt()
    .setExpirationTime(options?.expiresIn ?? "15m");

  if (options?.audience) jwt.setAudience(options.audience);

  return jwt.sign(new TextEncoder().encode(secret));
}

export function shouldPreferGlobalA2ASecret(orgSecret?: string): boolean {
  return !!process.env.A2A_SECRET?.trim() || !orgSecret;
}

export class A2AClient {
  private baseUrl: string;
  private apiKey?: string;
  private apiKeyAttempts: Array<string | undefined>;
  private endpointCandidates: string[] = [];
  private endpointResolved = false;
  private requestTimeoutMs?: number;

  constructor(
    baseUrl: string,
    apiKey?: string,
    options?: { requestTimeoutMs?: number; fallbackApiKeys?: string[] },
  ) {
    const normalized = baseUrl.replace(/\/$/, "");
    const explicitEndpoint = splitExplicitA2AEndpoint(normalized);
    this.baseUrl = explicitEndpoint?.baseUrl ?? normalized;
    if (explicitEndpoint) {
      this.endpointCandidates = [explicitEndpoint.endpointUrl];
      this.endpointResolved = true;
    }
    this.apiKey = apiKey;
    this.apiKeyAttempts = uniqueAuthTokens([
      apiKey,
      ...(options?.fallbackApiKeys ?? []),
    ]);
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
        const res = await ssrfSafeFetch(
          endpoint,
          { method: "OPTIONS" },
          { maxRedirects: 3, allowedPrivateOrigins: workspacePrivateOrigins() },
        );
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

  /** Resolve the card-advertised endpoint without sending an RPC request. */
  async resolveEndpointUrl(timeoutMs?: number): Promise<string> {
    await this.ensureEndpointCandidates(timeoutMs);
    const endpoint = this.endpointCandidates[0];
    if (!endpoint) throw new Error("No A2A endpoint candidates available");
    return endpoint;
  }

  /** Replace caller credentials without discarding resolved endpoint fallbacks. */
  setAuthentication(apiKey?: string, fallbackApiKeys: string[] = []): void {
    this.apiKey = apiKey;
    this.apiKeyAttempts = uniqueAuthTokens([apiKey, ...fallbackApiKeys]);
  }

  private headers(apiKey = this.apiKey): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      h["Authorization"] = `Bearer ${apiKey}`;
    }
    return h;
  }

  private markApiKeySucceeded(apiKey: string | undefined) {
    this.apiKey = apiKey;
    this.apiKeyAttempts = uniqueAuthTokens([
      apiKey,
      ...this.apiKeyAttempts.filter((token) => token !== apiKey),
    ]);
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options?: { requestTimeoutMs?: number; deadlineMs?: number },
  ): Promise<JsonRpcResponse> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const discoveryTimeoutMs = resolveA2ADiscoveryTimeoutMs(
      options?.requestTimeoutMs ?? this.requestTimeoutMs,
      options?.deadlineMs,
    );
    await this.ensureEndpointCandidates(discoveryTimeoutMs);
    let lastError: Error | null = null;

    for (const url of this.endpointCandidates) {
      for (let i = 0; i < this.apiKeyAttempts.length; i++) {
        const maxAttempts = isRetrySafeA2ARpc(
          method,
          params,
          this.apiKeyAttempts[i],
        )
          ? MAX_A2A_RPC_ATTEMPTS
          : 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const requestTimeoutMs = resolveA2ARequestTimeoutMs(
            options?.requestTimeoutMs ?? this.requestTimeoutMs,
            options?.deadlineMs,
          );
          if (requestTimeoutMs !== undefined && requestTimeoutMs <= 0) {
            throw new Error("A2A request deadline exceeded");
          }
          console.log(
            `[A2A Client] POST ${url} method=${method} attempt=${attempt}/${maxAttempts}`,
          );
          const startTime = Date.now();
          let res: Response;
          try {
            res = await this.postJson(
              url,
              body,
              this.apiKeyAttempts[i],
              requestTimeoutMs,
            );
          } catch (error) {
            lastError =
              error instanceof Error ? error : new Error(String(error));
            if (attempt < maxAttempts) {
              await waitForA2ARetry(
                attempt,
                null,
                remainingA2ADeadlineMs(options?.deadlineMs),
              );
              continue;
            }
            break;
          }
          console.log(
            `[A2A Client] Response: ${res.status} in ${Date.now() - startTime}ms`,
          );

          if (res.ok) {
            const text = await res.text();
            if (
              i < this.apiKeyAttempts.length - 1 &&
              isA2AAuthRejectionResponse(res.status, text)
            ) {
              lastError = new Error(
                `A2A request failed (${res.status}): ${text}`,
              );
              break;
            }
            try {
              const parsed = JSON.parse(text) as JsonRpcResponse;
              this.endpointCandidates = [url];
              this.markApiKeySucceeded(this.apiKeyAttempts[i]);
              return parsed;
            } catch (error) {
              lastError = new Error(
                `A2A response was not valid JSON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              if (attempt < maxAttempts) {
                await waitForA2ARetry(
                  attempt,
                  null,
                  remainingA2ADeadlineMs(options?.deadlineMs),
                );
                continue;
              }
              break;
            }
          }

          const text = await res.text();
          lastError = new Error(`A2A request failed (${res.status}): ${text}`);
          if (
            i < this.apiKeyAttempts.length - 1 &&
            isA2AAuthRejectionResponse(res.status, text)
          ) {
            break;
          }
          if (isRetryableA2AStatus(res.status) && attempt < maxAttempts) {
            await waitForA2ARetry(
              attempt,
              res.headers.get("retry-after"),
              remainingA2ADeadlineMs(options?.deadlineMs),
            );
            continue;
          }
          if (!shouldTryNextEndpoint(res.status)) {
            throw lastError;
          }
          break;
        }
      }
    }

    throw lastError ?? new Error("No A2A endpoint candidates available");
  }

  async getAgentCard(options?: {
    timeoutMs?: number;
    /**
     * Identity token for the card fetch. The anonymous card can only advertise
     * publicly-safe actions, which is a disjoint set from what `actions/invoke`
     * runs — so a sibling that discovers anonymously is told there is nothing
     * callable. Pass a token to see the invocable set.
     */
    token?: string;
  }): Promise<AgentCard> {
    const res = await ssrfSafeFetch(
      `${this.baseUrl}/.well-known/agent-card.json`,
      {
        ...(options?.timeoutMs
          ? { signal: AbortSignal.timeout(options.timeoutMs) }
          : {}),
        ...(options?.token
          ? { headers: { Authorization: `Bearer ${options.token}` } }
          : {}),
      },
      { maxRedirects: 3, allowedPrivateOrigins: workspacePrivateOrigins() },
    );
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
      idempotencyKey?: string;
      approvedActions?: A2AApprovedAction[];
      /** Per-request transport cap, bounded by deadlineMs when both exist. */
      requestTimeoutMs?: number;
      /** Absolute end-to-end deadline shared with async polling. */
      deadlineMs?: number;
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
    const response = await this.rpc(
      "message/send",
      {
        message,
        contextId: opts?.contextId,
        metadata: opts?.metadata,
        ...(opts?.idempotencyKey
          ? { idempotencyKey: opts.idempotencyKey }
          : {}),
        ...(opts?.approvedActions?.length
          ? { approvedActions: opts.approvedActions }
          : {}),
        ...(opts?.async ? { async: true } : {}),
      },
      {
        requestTimeoutMs: opts?.requestTimeoutMs,
        deadlineMs: opts?.deadlineMs,
      },
    );

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
  async getTask(
    taskId: string,
    opts?: { requestTimeoutMs?: number; deadlineMs?: number },
  ): Promise<Task> {
    const response = await this.rpc(
      "tasks/get",
      { id: taskId },
      {
        requestTimeoutMs: opts?.requestTimeoutMs,
        deadlineMs: opts?.deadlineMs,
      },
    );
    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }
    return response.result as Task;
  }

  /**
   * Execute one receiver-approved read-only action without starting the
   * receiver's agent loop. The receiver still owns validation, credentials,
   * request scoping, and the explicit action exposure decision.
   */
  async invokeAction(
    action: string,
    input: Record<string, unknown> = {},
    opts?: { metadata?: A2ACorrelationMetadata },
  ): Promise<A2AReadOnlyActionResult> {
    const metadata = sanitizeA2ACorrelationMetadata(opts?.metadata);
    const response = await this.rpc("actions/invoke", {
      action,
      input,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }
    return response.result as A2AReadOnlyActionResult;
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
      idempotencyKey?: string;
      approvedActions?: A2AApprovedAction[];
      /** Time to wait after submission for completion. Default 5 min. */
      timeoutMs?: number;
      /**
       * Optional separate budget for agent-card discovery and the initial
       * async message submission. When omitted, timeoutMs remains the shared
       * end-to-end deadline for backwards compatibility.
       */
      submissionTimeoutMs?: number;
      /** Poll interval. Default 2s. */
      pollIntervalMs?: number;
      /** Called with each polled task — useful for surfacing progress. */
      onUpdate?: (task: Task) => void;
    },
  ): Promise<Task> {
    const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
    const submissionDeadlineMs =
      Date.now() + (opts?.submissionTimeoutMs ?? timeoutMs);
    const submitted = await this.send(message, {
      contextId: opts?.contextId,
      metadata: opts?.metadata,
      idempotencyKey: opts?.idempotencyKey,
      ...(opts?.approvedActions?.length
        ? { approvedActions: opts.approvedActions }
        : {}),
      async: true,
      requestTimeoutMs: Math.min(
        this.requestTimeoutMs ?? DEFAULT_A2A_POLL_REQUEST_TIMEOUT_MS,
        Math.max(1, submissionDeadlineMs - Date.now()),
      ),
      deadlineMs: submissionDeadlineMs,
    });

    const pollingDeadlineMs = opts?.submissionTimeoutMs
      ? Date.now() + timeoutMs
      : submissionDeadlineMs;
    return this.pollTask(submitted, {
      ...opts,
      timeoutMs,
      deadlineMs: pollingDeadlineMs,
    });
  }

  /**
   * Continue waiting for an existing async task without submitting a second
   * message. Use this after a bounded caller-side wait expires but the remote
   * task is still working.
   */
  async waitForTask(
    taskId: string,
    opts?: {
      /** Total time to wait for completion. Default 5 min. */
      timeoutMs?: number;
      /** Poll interval. Default 2s. */
      pollIntervalMs?: number;
      /** Called with each successfully polled task. */
      onUpdate?: (task: Task) => void;
    },
  ): Promise<Task> {
    const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
    const deadlineMs = Date.now() + timeoutMs;
    const current = await this.getTask(taskId, {
      requestTimeoutMs: Math.min(
        this.requestTimeoutMs ?? DEFAULT_A2A_POLL_REQUEST_TIMEOUT_MS,
        Math.max(1, deadlineMs - Date.now()),
      ),
      deadlineMs,
    });
    safelyNotifyA2AUpdate(opts?.onUpdate, current);
    return this.pollTask(current, { ...opts, timeoutMs, deadlineMs });
  }

  private async pollTask(
    submitted: Task,
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      onUpdate?: (task: Task) => void;
      deadlineMs?: number;
    },
  ): Promise<Task> {
    const terminalStates = new Set([
      "completed",
      "failed",
      "canceled",
      "input-required",
    ]);
    if (terminalStates.has(submitted.status.state)) return submitted;

    const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
    const pollMs = opts?.pollIntervalMs ?? 2_000;
    const deadline = opts?.deadlineMs ?? Date.now() + timeoutMs;

    let current = submitted;
    while (Date.now() < deadline) {
      const sleepMs = Math.min(pollMs, Math.max(0, deadline - Date.now()));
      await new Promise((r) => setTimeout(r, sleepMs));
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        current = await this.getTask(submitted.id, {
          requestTimeoutMs: Math.min(
            this.requestTimeoutMs ?? DEFAULT_A2A_POLL_REQUEST_TIMEOUT_MS,
            remainingMs,
          ),
          deadlineMs: deadline,
        });
        safelyNotifyA2AUpdate(opts?.onUpdate, current);
      } catch (error) {
        // Retry only transport/gateway interruptions. Authentication,
        // task-not-found, invalid params, and other protocol failures are
        // permanent for this poll and must surface immediately.
        if (isRetryableA2APollError(error)) continue;
        throw error;
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
      for (let i = 0; i < this.apiKeyAttempts.length; i++) {
        res = await this.postJson(candidate, body, this.apiKeyAttempts[i]);
        if (res.ok) {
          this.endpointCandidates = [candidate];
          this.markApiKeySucceeded(this.apiKeyAttempts[i]);
          break;
        }
        const text = await res.text();
        lastError = new Error(`A2A stream failed (${res.status}): ${text}`);
        if (
          i < this.apiKeyAttempts.length - 1 &&
          isA2AAuthRejectionResponse(res.status, text)
        ) {
          continue;
        }
        if (!shouldTryNextEndpoint(res.status)) throw lastError;
        break;
      }
      if (res?.ok) break;
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

  private async ensureEndpointCandidates(timeoutMs?: number): Promise<void> {
    if (this.endpointResolved) return;
    this.endpointResolved = true;

    const candidates: string[] = [];
    addDefaultEndpointCandidates(candidates, this.baseUrl);

    try {
      const card = await this.getAgentCard({ timeoutMs });
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

  private async postJson(
    url: string,
    body: JsonRpcRequest,
    apiKey = this.apiKey,
    requestTimeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const controller = requestTimeoutMs ? new AbortController() : undefined;
    const timer =
      controller && requestTimeoutMs
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : undefined;
    try {
      return await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers: this.headers(apiKey),
          body: JSON.stringify(body),
          signal: controller?.signal,
        },
        { maxRedirects: 3, allowedPrivateOrigins: workspacePrivateOrigins() },
      );
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

function isRetrySafeA2ARpc(
  method: string,
  params: Record<string, unknown>,
  apiKey: string | undefined,
): boolean {
  if (method === "message/send") {
    return (
      params.async === true &&
      typeof params.idempotencyKey === "string" &&
      params.idempotencyKey.trim().length > 0 &&
      hasJwtSubject(apiKey)
    );
  }
  return method === "tasks/get" || method === "actions/invoke";
}

function isRetryableA2AStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function waitForA2ARetry(
  attempt: number,
  retryAfter: string | null = null,
  maxWaitMs?: number,
): Promise<void> {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, Math.min(2_000, retryAfterSeconds * 1_000))
    : 0;
  const backoffMs = Math.max(
    retryAfterMs,
    Math.min(1_000, A2A_RPC_RETRY_BASE_MS * 2 ** (attempt - 1)),
  );
  const boundedWaitMs =
    maxWaitMs === undefined ? backoffMs : Math.min(backoffMs, maxWaitMs);
  if (boundedWaitMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, boundedWaitMs));
}

function remainingA2ADeadlineMs(
  deadlineMs: number | undefined,
): number | undefined {
  return deadlineMs === undefined
    ? undefined
    : Math.max(0, deadlineMs - Date.now());
}

function resolveA2ARequestTimeoutMs(
  configuredMs: number | undefined,
  deadlineMs: number | undefined,
): number | undefined {
  const remainingMs = remainingA2ADeadlineMs(deadlineMs);
  if (remainingMs === undefined) return configuredMs;
  return configuredMs === undefined
    ? remainingMs
    : Math.min(configuredMs, remainingMs);
}

/**
 * Agent-card discovery is only a hint because first-party endpoints have
 * conventional paths. Preserve most of a bounded call's deadline for the
 * actual message instead of letting a cold or unavailable card consume it.
 */
function resolveA2ADiscoveryTimeoutMs(
  configuredMs: number | undefined,
  deadlineMs: number | undefined,
): number {
  const transportBudgetMs = resolveA2ARequestTimeoutMs(
    configuredMs,
    deadlineMs,
  );
  const remainingMs = remainingA2ADeadlineMs(deadlineMs);
  const deadlineShareMs =
    remainingMs === undefined
      ? DEFAULT_A2A_DISCOVERY_TIMEOUT_MS
      : Math.max(1, Math.floor(remainingMs / 4));
  return Math.min(
    DEFAULT_A2A_DISCOVERY_TIMEOUT_MS,
    transportBudgetMs ?? DEFAULT_A2A_DISCOVERY_TIMEOUT_MS,
    deadlineShareMs,
  );
}

function hasJwtSubject(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const segments = apiKey.split(".");
  if (segments.length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return typeof payload.sub === "string" && payload.sub.trim().length > 0;
  } catch {
    return false;
  }
}

function isRetryableA2APollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isA2AAuthRejection(error)) return false;
  if (
    /A2A error \(-32\d+\)|A2A request failed \((?:400|403|404|405|409|422)\)/i.test(
      message,
    )
  ) {
    return false;
  }
  return /(?:A2A request failed \((?:408|425|429|5\d\d)\)|fetch failed|network|socket|ECONN|ETIMEDOUT|timeout|deadline|aborted|invalid JSON)/i.test(
    message,
  );
}

function safelyNotifyA2AUpdate(
  callback: ((task: Task) => void) | undefined,
  task: Task,
): void {
  try {
    callback?.(task);
  } catch {
    // Presentation/progress callbacks cannot alter task polling.
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueAuthTokens(
  values: Array<string | undefined>,
): Array<string | undefined> {
  const result: Array<string | undefined> = [];
  for (const value of values) {
    if (result.includes(value)) continue;
    result.push(value);
  }
  if (result.length === 0) result.push(undefined);
  return result;
}

function isA2AAuthRejectionResponse(status: number, text: string): boolean {
  return (
    status === 401 ||
    /verified, audience-bound user identity/i.test(text) ||
    /A2A error \(-32001\): (?:Invalid or expired A2A token|Invalid API key|Authentication required)|Invalid or expired A2A token|Invalid API key|Authentication required/i.test(
      text,
    )
  );
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
    /** Additional bearer tokens to try in order after apiKey during rotation. */
    apiKeyFallbacks?: string[];
    /** Additional transport metadata. Receivers must not use it as identity. */
    metadata?: Record<string, unknown>;
    contextId?: string;
    userEmail?: string;
    orgDomain?: string;
    orgSecret?: string;
    /** Origin used to build links back to the receiving app. */
    requestOrigin?: string;
    /** Exact downstream actions explicitly authorized in the caller's chat. */
    approvedActions?: A2AApprovedAction[];
    /** Opaque provenance reference resolved by the receiver through Dispatch. */
    sourceContext?: A2ASourceContextReference;
    /** Bounded telemetry-only lineage forwarded to the receiving app. */
    correlation?: A2ACorrelationMetadata;
    /** Stable caller-generated key for one message submission. */
    idempotencyKey?: string;
    /**
     * Use async/poll instead of a single blocking POST. Recommended for
     * cross-app calls that may exceed a synchronous serverless request budget.
     * Defaults to true so callers get safe behavior out of the box.
     */
    async?: boolean;
    /** Total time to wait for the polled task (default 5 min). */
    timeoutMs?: number;
    /** Separate budget for discovery and initial async submission. */
    submissionTimeoutMs?: number;
    /**
     * Existing async task to keep polling. When set, no new message is sent.
     * This prevents a caller-side timeout from duplicating downstream work.
     */
    taskId?: string;
    /** Poll interval for async calls. Primarily useful for tests/retries. */
    pollIntervalMs?: number;
    /**
     * Return receiver-verified artifact text from the last polled task when
     * the call times out. Defaults to true for backwards compatibility.
     * Callers that can continue polling the remote task separately should set
     * this to false so the A2ATaskTimeoutError (and its taskId) is preserved.
     */
    returnRecoverableArtifactsOnTimeout?: boolean;
    /**
     * Called with each successfully polled task while an async call is still
     * in flight (see `A2AClient.sendAndWait`). Fires once per real poll
     * round-trip that returns a task — including the terminal poll — so
     * callers can surface genuine remote liveness/progress. Not called when a
     * poll fetch throws (remote unresponsive) or when the task completes
     * synchronously on submit. Only threaded through for async calls.
     */
    onUpdate?: (task: Task) => void;
  },
): Promise<string> {
  const metadata: Record<string, unknown> = { ...opts?.metadata };
  if (opts?.userEmail) metadata.userEmail = opts.userEmail;
  if (opts?.orgDomain) metadata.orgDomain = opts.orgDomain;
  if (opts?.requestOrigin) metadata.requestOrigin = opts.requestOrigin;
  if (opts?.sourceContext) metadata.sourceContext = opts.sourceContext;
  Object.assign(metadata, sanitizeA2ACorrelationMetadata(opts?.correlation));

  // Default to async + poll. The receiving A2A server's `_process-task` route
  // runs the handler in a fresh function execution (cross-platform queue
  // pattern), so async mode now works on every host instead of relying on
  // detached promises that get killed on Netlify/Vercel. Callers that
  // explicitly want a single-shot blocking POST can pass `async: false`.
  const useAsync = opts?.async ?? true;
  // A stable per-call key makes retrying a submission safe even when this
  // invocation has no durable parent turn id. If the receiver committed the
  // task but the response was lost, the retry reuses the task.
  const effectiveIdempotencyKey =
    opts?.idempotencyKey ?? (opts?.taskId ? undefined : `auto:${randomUUID()}`);
  const message: Message = {
    role: "user",
    parts: [{ type: "text", text }],
  };

  const apiKeyAttempts = await buildA2AApiKeyAttempts(opts);
  let lastAuthError: unknown;

  for (let i = 0; i < apiKeyAttempts.length; i++) {
    try {
      const fallbackApiKeys = apiKeyAttempts
        .slice(i + 1)
        .filter((token): token is string => token !== undefined);
      const client = new A2AClient(url, apiKeyAttempts[i], {
        fallbackApiKeys,
      });
      let task: Task;
      if (useAsync) {
        task = opts?.taskId
          ? await client.waitForTask(opts.taskId, {
              timeoutMs: opts.timeoutMs,
              pollIntervalMs: opts.pollIntervalMs,
              onUpdate: opts.onUpdate,
            })
          : await client.sendAndWait(message, {
              contextId: opts?.contextId,
              metadata,
              idempotencyKey: effectiveIdempotencyKey,
              ...(opts?.approvedActions?.length
                ? { approvedActions: opts.approvedActions }
                : {}),
              timeoutMs: opts?.timeoutMs,
              submissionTimeoutMs: opts?.submissionTimeoutMs,
              pollIntervalMs: opts?.pollIntervalMs,
              onUpdate: opts?.onUpdate,
            });
      } else {
        if (opts?.taskId) {
          throw new Error("Polling an existing A2A task requires async mode");
        }
        task = await client.send(message, {
          contextId: opts?.contextId,
          metadata,
          idempotencyKey: effectiveIdempotencyKey,
          ...(opts?.approvedActions?.length
            ? { approvedActions: opts.approvedActions }
            : {}),
        });
      }

      // Preserve the receiver's typed terminal state. Failed, canceled, and
      // input-required tasks are not successful text answers, even when the
      // receiver attached a friendly explanatory message.
      const responseMessage = task.status.message;
      const responseText = responseMessage
        ? extractMessageText(responseMessage)
        : "";
      const state = task.status.state;
      if (
        state === "failed" ||
        state === "canceled" ||
        state === "input-required"
      ) {
        throw new A2ATaskTerminalError(task, state, responseText);
      }
      if (state !== "completed") {
        throw new A2ATaskTerminalError(
          task,
          "failed",
          responseText || `Unexpected terminal state: ${state}`,
          "a2a_invalid_terminal_state",
        );
      }
      if (responseText.trim()) {
        if (responseText.length > MAX_A2A_CALLER_RESPONSE_CHARS) {
          throw new A2ATaskTerminalError(
            task,
            "completed",
            responseText,
            "a2a_response_too_large",
          );
        }
        return responseText;
      }
      const artifactSummary = verifiedArtifactSummary(task);
      if (artifactSummary) return artifactSummary;
      throw new A2ATaskTerminalError(
        task,
        "completed",
        "Agent completed without a response or verified artifact.",
        "empty_agent_response",
      );
    } catch (err) {
      if (
        opts?.returnRecoverableArtifactsOnTimeout !== false &&
        err instanceof A2ATaskTimeoutError
      ) {
        const recoverableText = extractRecoverableArtifactText(err.lastTask);
        if (
          recoverableText &&
          recoverableText.length <= MAX_A2A_CALLER_RESPONSE_CHARS
        ) {
          return recoverableText;
        }
      }
      if (i < apiKeyAttempts.length - 1 && isA2AAuthRejection(err)) {
        lastAuthError = err;
        continue;
      }
      throw err;
    }
  }

  if (lastAuthError) throw lastAuthError;
  return "";
}

/**
 * Invoke one receiver-approved read-only action with an audience-bound user
 * token. Unlike conversational delegation, this never starts the receiver's
 * model loop.
 */
export async function callAction(
  url: string,
  action: string,
  input: Record<string, unknown> = {},
  opts?: {
    apiKey?: string;
    userEmail?: string;
    orgDomain?: string;
    orgSecret?: string;
    requestTimeoutMs?: number;
    correlation?: A2ACorrelationMetadata;
  },
): Promise<A2AReadOnlyActionResult> {
  const actionName = action.trim();
  if (!actionName) throw new Error("A2A action name is required");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("A2A action input must be an object");
  }

  const discoveryAudience = normalizeA2AAudience(url);
  const discoveryApiKeyAttempts = await buildA2AApiKeyAttempts(
    opts,
    discoveryAudience,
  );
  const discoveryFallbackApiKeys = discoveryApiKeyAttempts
    .slice(1)
    .filter((token): token is string => token !== undefined);
  const client = new A2AClient(url, discoveryApiKeyAttempts[0], {
    fallbackApiKeys: discoveryFallbackApiKeys,
    requestTimeoutMs: opts?.requestTimeoutMs,
  });
  const endpointUrl = await client.resolveEndpointUrl(opts?.requestTimeoutMs);
  const invocationAudience = normalizeA2AAudience(endpointUrl);
  if (invocationAudience !== discoveryAudience) {
    const invocationApiKeyAttempts = await buildA2AApiKeyAttempts(
      opts,
      invocationAudience,
    );
    const combinedApiKeyAttempts = uniqueAuthTokens([
      ...invocationApiKeyAttempts,
      ...discoveryApiKeyAttempts,
    ]);
    client.setAuthentication(
      combinedApiKeyAttempts[0],
      combinedApiKeyAttempts
        .slice(1)
        .filter((token): token is string => token !== undefined),
    );
  }
  return client.invokeAction(actionName, input, {
    metadata: sanitizeA2ACorrelationMetadata(opts?.correlation),
  });
}

async function buildA2AApiKeyAttempts(
  opts?: {
    apiKey?: string;
    apiKeyFallbacks?: string[];
    userEmail?: string;
    orgDomain?: string;
    orgSecret?: string;
  },
  audience?: string,
): Promise<Array<string | undefined>> {
  const attempts: Array<string | undefined> = [];
  const add = (token: string | undefined) => {
    if (token === undefined || attempts.includes(token)) return;
    attempts.push(token);
  };

  add(opts?.apiKey);
  for (const fallback of opts?.apiKeyFallbacks ?? []) add(fallback);

  if (opts?.userEmail && (opts.orgSecret || process.env.A2A_SECRET)) {
    if (process.env.A2A_SECRET?.trim()) {
      try {
        add(
          await signA2AToken(opts.userEmail, opts.orgDomain, opts.orgSecret, {
            preferGlobalSecret: true,
            audience,
          }),
        );
      } catch {
        // Keep any explicit token attempt, then fall back below.
      }
    }

    if (opts.orgSecret) {
      try {
        add(
          await signA2AToken(opts.userEmail, opts.orgDomain, opts.orgSecret, {
            preferGlobalSecret: false,
            audience,
          }),
        );
      } catch {
        // Fall through to the attempts we already have.
      }
    }
  }

  if (attempts.length === 0) attempts.push(undefined);
  return attempts;
}

function normalizeA2AAudience(url: string): string {
  const explicit = splitExplicitA2AEndpoint(url.replace(/\/$/, ""));
  const base = (explicit?.baseUrl ?? url).replace(/\/$/, "");
  return canonicalA2AAudience(base);
}

function isA2AAuthRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /A2A request failed \(401\)|A2A error \(-32001\): (?:Invalid or expired A2A token|Invalid API key|Authentication required)|Invalid or expired A2A token|Invalid API key|Authentication required/i.test(
    message,
  );
}

function extractRecoverableArtifactText(task: Task): string {
  if (!task.status.message?.metadata?.agentNativeRecoverableArtifacts) {
    return "";
  }
  return extractMessageText(task.status.message);
}

function extractMessageText(message: Message): string {
  return (Array.isArray(message.parts) ? message.parts : [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function verifiedArtifactSummary(task: Task): string {
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  if (artifacts.length === 0) return "";
  const summaries = artifacts
    .map((artifact, artifactIndex) => {
      const parts = Array.isArray(artifact?.parts) ? artifact.parts : [];
      const usableParts = parts
        .map((part) => summarizeVerifiedArtifactPart(part))
        .filter((value): value is string => !!value)
        .slice(0, 5);
      if (usableParts.length === 0) return null;
      const fallbackFileName = parts.find(
        (part) => part.type === "file" && part.file.name?.trim(),
      );
      const label =
        artifact?.name?.trim() ||
        (fallbackFileName?.type === "file"
          ? fallbackFileName.file.name?.trim()
          : "") ||
        `Artifact ${artifactIndex + 1}`;
      return `- ${label}\n${usableParts.map((part) => `  - ${part}`).join("\n")}`;
    })
    .filter((value): value is string => !!value)
    .slice(0, 20);
  if (summaries.length === 0) return "";
  return boundA2ACallerResponseText(
    `The agent completed with ${summaries.length} verified artifact(s):\n` +
      summaries.join("\n"),
  );
}

function summarizeVerifiedArtifactPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as Record<string, unknown>;
  if (candidate.type === "text" && typeof candidate.text === "string") {
    const text = candidate.text.trim();
    return text ? boundA2ACallerResponseText(text).slice(0, 2_000) : null;
  }
  if (candidate.type === "file") {
    const file = candidate.file as Record<string, unknown> | undefined;
    if (!file) return null;
    const uri = typeof file.uri === "string" ? file.uri.trim() : "";
    const name = typeof file.name === "string" ? file.name.trim() : "";
    const bytes = typeof file.bytes === "string" ? file.bytes : "";
    if (uri) return name ? `${name}: ${uri}` : uri;
    if (bytes) return name ? `${name} (inline file)` : "Inline file artifact";
    return null;
  }
  if (candidate.type === "data") {
    const data = candidate.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const serialized = JSON.stringify(data);
    return serialized !== "{}" ? serialized.slice(0, 2_000) : null;
  }
  return null;
}
