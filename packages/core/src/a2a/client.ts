import { createHash, randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAppConfig } from "../app-config/index.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { resolveVercelDeploymentProtectionHeaders } from "../server/deployment-protection.js";
import { getRequestContext } from "../server/request-context.js";
import {
  SYNTHETIC_TRAFFIC_BETA_E2E,
  SYNTHETIC_TRAFFIC_HEADER,
} from "../shared/test-traffic.js";
import { canonicalA2AAudience } from "./audience.js";
import { sanitizeA2ACorrelationMetadata } from "./correlation.js";
import { RemoteAgentCredentialRejectedError } from "./remote-agent-auth.js";
import type {
  A2AApprovedAction,
  A2ACorrelationMetadata,
  A2ASourceContextReference,
  A2AReadOnlyActionResult,
  AgentCard,
  A2AProtocolVersion,
  Artifact,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Part,
  Task,
} from "./types.js";
import { workspacePrivateOrigins } from "./workspace-private-origins.js";

const DEFAULT_A2A_POLL_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_A2A_DISCOVERY_TIMEOUT_MS = 3_000;
const MAX_A2A_RPC_ATTEMPTS = 3;
const A2A_RPC_RETRY_BASE_MS = 100;
const A2A_CARD_CACHE_TTL_MS = 30_000;
export const MAX_A2A_CALLER_RESPONSE_CHARS = 32_768;

interface AgentCardCacheEntry {
  card: AgentCard;
  expiresAt: number;
}

const agentCardCache = new Map<string, AgentCardCacheEntry>();
const agentCardRequests = new Map<string, Promise<AgentCard>>();

export function clearA2ACardCache(): void {
  agentCardCache.clear();
  agentCardRequests.clear();
}

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

export type A2AProtocolErrorCode =
  | "a2a_invalid_json"
  | "a2a_missing_jsonrpc"
  | "a2a_invalid_jsonrpc"
  | "a2a_no_jsonrpc_interface"
  | "a2a_insecure_endpoint";

export class A2AProtocolError extends Error {
  readonly errorCode: A2AProtocolErrorCode;
  readonly code: A2AProtocolErrorCode;
  readonly url?: string;
  readonly responseText?: string;

  constructor(
    message: string,
    errorCode: A2AProtocolErrorCode,
    options?: { url?: string; responseText?: string },
  ) {
    super(message);
    this.name = "A2AProtocolError";
    this.errorCode = errorCode;
    this.code = errorCode;
    this.url = options?.url;
    this.responseText = options?.responseText;
  }
}

export class A2AMissingJsonRpcResponseError extends A2AProtocolError {
  constructor(url: string, responseText?: string) {
    super(
      `A2A response from ${url} is missing a JSON-RPC 2.0 envelope`,
      "a2a_missing_jsonrpc",
      { url, responseText },
    );
    this.name = "A2AMissingJsonRpcResponseError";
  }
}

export class A2AJsonRpcResponseError extends A2AProtocolError {
  constructor(
    message: string,
    options?: { url?: string; responseText?: string },
  ) {
    super(message, "a2a_invalid_jsonrpc", options);
    this.name = "A2AJsonRpcResponseError";
  }
}

export class A2ANoJsonRpcInterfaceError extends A2AProtocolError {
  readonly interfaces: string[];

  constructor(interfaces: string[]) {
    const listed = interfaces.length > 0 ? interfaces.join(", ") : "none";
    super(
      `A2A v1.0 card has no JSON-RPC interface (found: ${listed})`,
      "a2a_no_jsonrpc_interface",
    );
    this.name = "A2ANoJsonRpcInterfaceError";
    this.interfaces = interfaces;
  }
}

export class A2AInsecureEndpointError extends A2AProtocolError {
  constructor(url: string) {
    super(
      `A2A credentialed requests require HTTPS (or loopback HTTP): ${url}`,
      "a2a_insecure_endpoint",
      { url },
    );
    this.name = "A2AInsecureEndpointError";
  }
}

export type A2ATerminalTaskErrorState =
  | "failed"
  | "canceled"
  | "input-required"
  | "completed";

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

export function boundA2ACallerResponseText(value: string): string {
  if (value.length <= MAX_A2A_CALLER_RESPONSE_CHARS) return value;
  const marker =
    "\n\n...[A2A response compacted at the caller boundary; use the receiving app or returned artifact links for full details]...\n\n";
  const tailChars = 8_192;
  const headChars = MAX_A2A_CALLER_RESPONSE_CHARS - tailChars - marker.length;
  return value.slice(0, headChars) + marker + value.slice(-tailChars);
}

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

interface A2AEndpointCandidate {
  url: string;
  protocolVersion?: A2AProtocolVersion;
  streaming?: boolean;
  tenant?: string;
}

export class A2AClient {
  private baseUrl: string;
  private apiKey?: string;
  private apiKeyAttempts: Array<string | undefined>;
  private endpointCandidates: A2AEndpointCandidate[] = [];
  private endpointResolved = false;
  private requestTimeoutMs?: number;
  private transportHeaders?: Record<string, string>;
  private cardUrl?: string;
  private protocolVersion?: A2AProtocolVersion;
  private streaming?: boolean;

  constructor(
    baseUrl: string,
    apiKey?: string,
    options?: {
      requestTimeoutMs?: number;
      fallbackApiKeys?: string[];
      transportHeaders?: Record<string, string>;
      cardUrl?: string;
      agentCardUrl?: string;
      protocolVersion?: A2AProtocolVersion;
      a2aVersion?: A2AProtocolVersion;
    },
  ) {
    const normalized = baseUrl.replace(/\/$/, "");
    const explicitEndpoint = splitExplicitA2AEndpoint(normalized);
    this.baseUrl = explicitEndpoint?.baseUrl ?? normalized;
    this.protocolVersion = options?.protocolVersion ?? options?.a2aVersion;
    if (explicitEndpoint) {
      this.endpointCandidates = [
        {
          url: explicitEndpoint.endpointUrl,
          protocolVersion: this.protocolVersion,
        },
      ];
    }
    this.apiKey = apiKey;
    this.apiKeyAttempts = uniqueAuthTokens([
      apiKey,
      ...(options?.fallbackApiKeys ?? []),
    ]);
    this.requestTimeoutMs = options?.requestTimeoutMs;
    this.transportHeaders = {
      ...(options?.transportHeaders ?? {}),
      ...(getRequestContext()?.isSyntheticTraffic === true
        ? { [SYNTHETIC_TRAFFIC_HEADER]: SYNTHETIC_TRAFFIC_BETA_E2E }
        : {}),
    };
    const configuredCardUrl = options?.cardUrl ?? options?.agentCardUrl;
    this.cardUrl = configuredCardUrl
      ? (normalizeUrl(configuredCardUrl, this.baseUrl) ?? configuredCardUrl)
      : undefined;
    this.endpointResolved = Boolean(explicitEndpoint && !this.cardUrl);
  }

  async resolveEndpoint(): Promise<void> {
    await this.ensureEndpointCandidates();
    if (this.endpointCandidates.length <= 1) return;

    for (const candidate of this.endpointCandidates) {
      const endpoint = candidate.url;
      try {
        const headers = this.transportHeadersFor(endpoint);
        const res = await ssrfSafeFetch(
          endpoint,
          {
            method: "OPTIONS",
            headers,
          },
          {
            maxRedirects: 3,
            allowedPrivateOrigins: workspacePrivateOrigins(),
            ...(headers["x-vercel-protection-bypass"]
              ? { followRedirects: false }
              : {}),
          },
        );
        if (res.status !== 404 && res.status !== 405) {
          this.endpointCandidates = [candidate];
          return;
        }
        if (res.status === 405) {
          this.endpointCandidates = [candidate];
          return;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  async resolveEndpointUrl(timeoutMs?: number): Promise<string> {
    await this.ensureEndpointCandidates(timeoutMs);
    const endpoint = this.endpointCandidates[0]?.url;
    if (!endpoint) throw new Error("No A2A endpoint candidates available");
    return endpoint;
  }

  setAuthentication(apiKey?: string, fallbackApiKeys: string[] = []): void {
    this.apiKey = apiKey;
    this.apiKeyAttempts = uniqueAuthTokens([apiKey, ...fallbackApiKeys]);
  }

  private headers(
    apiKey = this.apiKey,
    targetUrl = this.baseUrl,
    protocolVersion = this.protocolVersion,
  ): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.transportHeaders ?? {}),
      ...resolveVercelDeploymentProtectionHeaders(targetUrl),
    };
    if (apiKey) {
      h["Authorization"] = `Bearer ${apiKey}`;
    }
    if (protocolVersion) {
      h["A2A-Version"] = protocolVersion;
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
    const requestId = Date.now();

    const discoveryTimeoutMs = resolveA2ADiscoveryTimeoutMs(
      options?.requestTimeoutMs ?? this.requestTimeoutMs,
      options?.deadlineMs,
    );
    await this.ensureEndpointCandidates(discoveryTimeoutMs);
    let lastError: Error | null = null;

    for (const candidate of this.endpointCandidates) {
      const url = candidate.url;
      const body: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: requestId,
        method: a2aWireMethod(method, candidate.protocolVersion),
        params: a2aWireParams(
          method,
          params,
          candidate.protocolVersion,
          candidate.tenant,
        ),
      };
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
              candidate.protocolVersion,
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
              const parsed = parseJsonRpcResponse(text, url);
              this.endpointCandidates = [candidate];
              this.markApiKeySucceeded(this.apiKeyAttempts[i]);
              return parsed;
            } catch (error) {
              if (error instanceof A2AProtocolError) throw error;
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
          if (res.status === 401 || res.status === 403) {
            lastError = new RemoteAgentCredentialRejectedError({
              status: res.status,
            });
            if (i < this.apiKeyAttempts.length - 1) break;
            throw lastError;
          }
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
    cardUrl?: string;
  }): Promise<AgentCard> {
    const cardUrl =
      options?.cardUrl ??
      this.cardUrl ??
      `${this.baseUrl}/.well-known/agent-card.json`;
    const cacheScope = options?.token
      ? createHash("sha256")
          .update(
            `${getRequestContext()?.userEmail ?? ""}\u0000${getRequestContext()?.orgId ?? ""}\u0000${options.token}`,
          )
          .digest("hex")
      : "anonymous";
    const cacheKey = `${cardUrl}\u0000${cacheScope}`;
    const cached = agentCardCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.card;
    const inFlight = agentCardRequests.get(cacheKey);
    if (inFlight) return inFlight;
    const request = this.fetchAgentCard(cardUrl, options);
    agentCardRequests.set(cacheKey, request);
    try {
      const card = await request;
      agentCardCache.set(cacheKey, {
        card,
        expiresAt: Date.now() + A2A_CARD_CACHE_TTL_MS,
      });
      return card;
    } finally {
      agentCardRequests.delete(cacheKey);
    }
  }

  private async fetchAgentCard(
    cardUrl: string,
    options?: { timeoutMs?: number; token?: string },
  ): Promise<AgentCard> {
    assertCredentialedA2AUrl(cardUrl, Boolean(options?.token));
    const headers: Record<string, string> = {
      ...this.transportHeadersFor(cardUrl),
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(this.protocolVersion ? { "A2A-Version": this.protocolVersion } : {}),
    };
    const res = await ssrfSafeFetch(
      cardUrl,
      {
        ...(options?.timeoutMs
          ? { signal: AbortSignal.timeout(options.timeoutMs) }
          : {}),
        headers,
      },
      {
        maxRedirects: options?.token ? 0 : 3,
        allowedPrivateOrigins: workspacePrivateOrigins(),
        ...(options?.token || headers["x-vercel-protection-bypass"]
          ? { followRedirects: false }
          : {}),
      },
    );
    if ((res.status === 401 || res.status === 403) && options?.token) {
      throw new RemoteAgentCredentialRejectedError({
        status: res.status,
        tokenUrl: cardUrl,
      });
    }
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
      requestTimeoutMs?: number;
      deadlineMs?: number;
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

    return normalizeA2ATaskResult(response.result, response.id);
  }

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
    return normalizeA2ATaskResult(response.result, response.id);
  }

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

  async sendAndWait(
    message: Message,
    opts?: {
      contextId?: string;
      metadata?: Record<string, unknown>;
      idempotencyKey?: string;
      approvedActions?: A2AApprovedAction[];
      timeoutMs?: number;
      submissionTimeoutMs?: number;
      pollIntervalMs?: number;
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

  async waitForTask(
    taskId: string,
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
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
    await this.ensureEndpointCandidates();
    const params = {
      message,
      contextId: opts?.contextId,
      metadata: opts?.metadata,
    };
    const preferredCandidate = this.endpointCandidates[0];
    if (this.streaming === false || preferredCandidate?.streaming === false) {
      yield await this.send(message, {
        contextId: opts?.contextId,
        metadata: opts?.metadata,
      });
      return;
    }

    const requestId = Date.now();
    let res: Response | null = null;
    let lastError: Error | null = null;
    let selectedCandidate: A2AEndpointCandidate | undefined;
    for (const candidate of this.endpointCandidates) {
      const body: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: requestId,
        method: a2aWireMethod("message/stream", candidate.protocolVersion),
        params: a2aWireParams(
          "message/stream",
          params,
          candidate.protocolVersion,
          candidate.tenant,
        ),
      };
      for (let i = 0; i < this.apiKeyAttempts.length; i++) {
        try {
          res = await this.postJson(
            candidate.url,
            body,
            this.apiKeyAttempts[i],
            this.requestTimeoutMs,
            candidate.protocolVersion,
          );
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          throw lastError;
        }
        if (res.ok) {
          this.endpointCandidates = [candidate];
          selectedCandidate = candidate;
          this.markApiKeySucceeded(this.apiKeyAttempts[i]);
          break;
        }
        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
          lastError = new RemoteAgentCredentialRejectedError({
            status: res.status,
          });
          if (i < this.apiKeyAttempts.length - 1) continue;
          throw lastError;
        }
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

    const candidate = selectedCandidate ?? this.endpointCandidates[0];
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const text = await res.text();
      let response: JsonRpcResponse;
      try {
        response = parseJsonRpcResponse(text, candidate?.url ?? "A2A endpoint");
      } catch (error) {
        if (isA2AStreamingUnsupportedError(error)) {
          yield await this.send(message, {
            contextId: opts?.contextId,
            metadata: opts?.metadata,
          });
          return;
        }
        throw error;
      }
      if (response.error) {
        if (isA2AStreamingUnsupportedError(response.error)) {
          yield await this.send(message, {
            contextId: opts?.contextId,
            metadata: opts?.metadata,
          });
          return;
        }
        throw new Error(
          `A2A error (${response.error.code}): ${response.error.message}`,
        );
      }
      yield normalizeA2ATaskResult(response.result, response.id);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("A2A stream response did not include a readable body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let sawEvent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const finalLine = buffer.replace(/\r$/, "");
        if (finalLine.startsWith("data: ")) {
          const json = finalLine.slice(6).trim();
          if (json) {
            const response = parseJsonRpcResponse(
              json,
              candidate?.url ?? "A2A endpoint",
            );
            if (response.error) {
              throw new Error(
                `A2A error (${response.error.code}): ${response.error.message}`,
              );
            }
            sawEvent = true;
            yield normalizeA2ATaskResult(response.result, response.id);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const normalizedLine = line.replace(/\r$/, "");
        if (!normalizedLine.startsWith("data: ")) continue;
        const json = normalizedLine.slice(6).trim();
        if (!json) continue;

        const response = parseJsonRpcResponse(
          json,
          candidate?.url ?? "A2A endpoint",
        );
        if (response.error) {
          if (!sawEvent && isA2AStreamingUnsupportedError(response.error)) {
            yield await this.send(message, {
              contextId: opts?.contextId,
              metadata: opts?.metadata,
            });
            return;
          }
          throw new Error(
            `A2A error (${response.error.code}): ${response.error.message}`,
          );
        }
        sawEvent = true;
        yield normalizeA2ATaskResult(response.result, response.id);
      }
    }
  }

  private async ensureEndpointCandidates(timeoutMs?: number): Promise<void> {
    if (this.endpointResolved) return;
    this.endpointResolved = true;

    const candidates: A2AEndpointCandidate[] = this.endpointCandidates.length
      ? [...this.endpointCandidates]
      : [];
    if (candidates.length === 0)
      addDefaultEndpointCandidates(candidates, this.baseUrl);

    try {
      const card = await this.getAgentCard({
        timeoutMs,
        ...(this.apiKey ? { token: this.apiKey } : {}),
      });
      this.streaming = card.capabilities?.streaming;
      const interfaceHint = selectJsonRpcInterface(
        card,
        this.baseUrl,
        this.protocolVersion,
      );
      const advertisedV1Interfaces = Array.isArray(card.supportedInterfaces)
        ? card.supportedInterfaces
        : [];
      const isV1Card =
        card.protocolVersion?.startsWith("1.") ||
        this.protocolVersion?.startsWith("1.") ||
        advertisedV1Interfaces.some((entry) =>
          entry.protocolVersion?.startsWith("1."),
        );
      if (isV1Card && !interfaceHint) {
        throw new A2ANoJsonRpcInterfaceError(
          advertisedV1Interfaces.map((entry) => {
            const binding =
              typeof entry.protocolBinding === "string"
                ? entry.protocolBinding
                : "unknown";
            const version =
              typeof entry.protocolVersion === "string"
                ? entry.protocolVersion
                : "unknown";
            return `${binding} ${version}`;
          }),
        );
      }
      if (interfaceHint) {
        assertCredentialedA2AUrl(
          interfaceHint.url,
          hasA2ACredentials(this.apiKeyAttempts, this.transportHeaders),
        );
        this.protocolVersion ??= interfaceHint.protocolVersion;
        candidates.unshift({
          url: interfaceHint.url,
          protocolVersion: interfaceHint.protocolVersion,
          streaming: this.streaming,
          tenant: interfaceHint.tenant,
        });
      } else {
        const cardUrl = normalizeUrl(card.url, this.baseUrl);
        if (cardUrl) {
          const explicitEndpoint = splitExplicitA2AEndpoint(cardUrl);
          if (explicitEndpoint) {
            candidates.unshift({
              url: explicitEndpoint.endpointUrl,
              protocolVersion: card.protocolVersion ?? this.protocolVersion,
              streaming: this.streaming,
            });
          } else {
            addDefaultEndpointCandidates(
              candidates,
              cardUrl,
              card.protocolVersion ?? this.protocolVersion,
              this.streaming,
            );
          }
        }
      }
    } catch (error) {
      if (
        error instanceof A2AProtocolError ||
        error instanceof RemoteAgentCredentialRejectedError
      ) {
        throw error;
      }
      // Agent cards are discovery hints. Fall back to conventional endpoints.
    }

    this.endpointCandidates = uniqueEndpointCandidates(candidates);
  }

  private async postJson(
    url: string,
    body: JsonRpcRequest,
    apiKey = this.apiKey,
    requestTimeoutMs = this.requestTimeoutMs,
    protocolVersion = this.protocolVersion,
  ): Promise<Response> {
    const controller = requestTimeoutMs ? new AbortController() : undefined;
    const timer =
      controller && requestTimeoutMs
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : undefined;
    try {
      const headers = this.headers(apiKey, url, protocolVersion);
      const credentialed = hasA2ACredentials(apiKey ? [apiKey] : [], headers);
      assertCredentialedA2AUrl(url, credentialed);
      return await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller?.signal,
        },
        {
          maxRedirects: credentialed ? 0 : 3,
          allowedPrivateOrigins: workspacePrivateOrigins(),
          ...(credentialed || headers["x-vercel-protection-bypass"]
            ? { followRedirects: false }
            : {}),
        },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private transportHeadersFor(targetUrl: string): Record<string, string> {
    return {
      ...(this.transportHeaders ?? {}),
      ...resolveVercelDeploymentProtectionHeaders(targetUrl),
    };
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

function addDefaultEndpointCandidates(
  candidates: A2AEndpointCandidate[],
  baseUrl: string,
  protocolVersion?: A2AProtocolVersion,
  streaming?: boolean,
) {
  const base = baseUrl.replace(/\/$/, "");
  candidates.push(
    {
      url: `${base}/_agent-native/a2a`,
      protocolVersion,
      streaming,
    },
    { url: `${base}/a2a`, protocolVersion, streaming },
  );
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

function hasA2ACredentials(
  apiKeys: Array<string | undefined>,
  headers?: Record<string, string>,
): boolean {
  if (apiKeys.some((value) => typeof value === "string" && value.length > 0)) {
    return true;
  }
  return Object.keys(headers ?? {}).some((name) =>
    /^(authorization|api[-_]key|x-api[-_]key|x-api[-_]token)$/i.test(name),
  );
}

function assertCredentialedA2AUrl(url: string, credentialed: boolean): void {
  if (!credentialed) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return;
  }
  throw new A2AInsecureEndpointError(url);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function selectJsonRpcInterface(
  card: AgentCard,
  baseUrl: string,
  configuredProtocolVersion?: A2AProtocolVersion,
): {
  url: string;
  protocolVersion: A2AProtocolVersion;
  tenant?: string;
} | null {
  const supportedInterfaces = Array.isArray(card.supportedInterfaces)
    ? card.supportedInterfaces
    : [];
  const cardIsV1 =
    card.protocolVersion?.startsWith("1.") ||
    configuredProtocolVersion?.startsWith("1.") ||
    supportedInterfaces.some((entry) =>
      entry.protocolVersion?.startsWith("1."),
    );
  for (const candidate of supportedInterfaces) {
    const entry = candidate as unknown as Record<string, unknown>;
    const binding = String(
      entry.protocolBinding ?? entry.protocol_binding ?? "",
    ).toUpperCase();
    if (binding !== "JSONRPC") continue;
    const url = normalizeUrl(
      typeof entry.url === "string" ? entry.url : undefined,
      baseUrl,
    );
    if (!url) continue;
    const protocolVersion =
      typeof entry.protocolVersion === "string"
        ? entry.protocolVersion
        : typeof entry.protocol_version === "string"
          ? entry.protocol_version
          : (card.protocolVersion ?? configuredProtocolVersion);
    if (!protocolVersion) continue;
    return {
      url,
      protocolVersion,
      ...(typeof entry.tenant === "string" ? { tenant: entry.tenant } : {}),
    };
  }

  const additionalInterfaces = cardIsV1
    ? []
    : Array.isArray(card.additionalInterfaces)
      ? card.additionalInterfaces
      : [];
  for (const candidate of additionalInterfaces) {
    const entry = candidate as unknown as Record<string, unknown>;
    const binding = String(
      entry.protocolBinding ?? entry.protocol_binding ?? entry.transport ?? "",
    ).toUpperCase();
    if (binding && binding !== "JSONRPC") continue;
    const url = normalizeUrl(
      typeof entry.url === "string" ? entry.url : undefined,
      baseUrl,
    );
    if (!url) continue;
    const protocolVersion =
      typeof entry.protocolVersion === "string"
        ? entry.protocolVersion
        : typeof entry.protocol_version === "string"
          ? entry.protocol_version
          : (card.protocolVersion ?? configuredProtocolVersion ?? "0.3");
    return {
      url,
      protocolVersion,
      ...(typeof entry.tenant === "string" ? { tenant: entry.tenant } : {}),
    };
  }

  const preferredTransport = card.preferredTransport?.toUpperCase();
  if (
    !cardIsV1 &&
    card.url &&
    (!preferredTransport || preferredTransport === "JSONRPC")
  ) {
    const url = normalizeUrl(card.url, baseUrl);
    if (url) {
      return {
        url,
        protocolVersion:
          card.protocolVersion ?? configuredProtocolVersion ?? "0.3",
      };
    }
  }
  return null;
}

function a2aWireMethod(
  method: string,
  protocolVersion?: A2AProtocolVersion,
): string {
  if (!protocolVersion?.startsWith("1.")) return method;
  return (
    (
      {
        "message/send": "SendMessage",
        "message/stream": "SendStreamingMessage",
        "tasks/get": "GetTask",
        "tasks/cancel": "CancelTask",
      } as Record<string, string>
    )[method] ?? method
  );
}

function a2aWireParams(
  method: string,
  params: Record<string, unknown>,
  protocolVersion?: A2AProtocolVersion,
  tenant?: string,
): Record<string, unknown> {
  if (!protocolVersion?.startsWith("1.")) {
    return params;
  }
  const { async: _async, contextId, message, ...rest } = params;
  const wireParams: Record<string, unknown> = {
    ...rest,
    ...(tenant ? { tenant } : {}),
  };
  if (message !== undefined) {
    wireParams.message = toV1Message(message, contextId);
  } else if (contextId !== undefined) {
    wireParams.contextId = contextId;
  }
  if (method === "message/send" && params.async === true) {
    const configuration = isRecord(wireParams.configuration)
      ? wireParams.configuration
      : {};
    wireParams.configuration = { ...configuration, returnImmediately: true };
  }
  return wireParams;
}

function toV1Message(
  value: unknown,
  contextId?: unknown,
): Record<string, unknown> {
  const message = isRecord(value) ? value : {};
  const parts = Array.isArray(message.parts) ? message.parts.map(toV1Part) : [];
  return {
    ...message,
    messageId:
      typeof message.messageId === "string" && message.messageId
        ? message.messageId
        : randomUUID(),
    ...(contextId !== undefined && message.contextId === undefined
      ? { contextId }
      : {}),
    role:
      message.role === "user"
        ? "ROLE_USER"
        : message.role === "agent"
          ? "ROLE_AGENT"
          : message.role,
    parts,
  };
}

function toV1Part(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const { type, file, ...rest } = value;
  if (type === "text") return rest;
  if (type === "file" && isRecord(file)) {
    const { bytes, uri, name, mimeType } = file;
    return {
      ...(bytes ? { raw: bytes } : uri ? { url: uri } : {}),
      ...(name ? { filename: name } : {}),
      ...(mimeType ? { mediaType: mimeType } : {}),
    };
  }
  if (type === "data") return { data: value.data };
  return rest;
}

function parseJsonRpcResponse(text: string, url: string): JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new A2AProtocolError(
      `A2A response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "a2a_invalid_json",
      { url, responseText: boundProtocolResponseText(text) },
    );
  }

  if (!isRecord(parsed) || !("jsonrpc" in parsed)) {
    throw new A2AMissingJsonRpcResponseError(
      url,
      boundProtocolResponseText(text),
    );
  }
  if (parsed.jsonrpc !== "2.0") {
    throw new A2AJsonRpcResponseError(
      `A2A response from ${url} does not use JSON-RPC 2.0`,
      { url, responseText: boundProtocolResponseText(text) },
    );
  }
  if (!("id" in parsed)) {
    throw new A2AJsonRpcResponseError(
      `A2A response from ${url} is missing a JSON-RPC id`,
      { url, responseText: boundProtocolResponseText(text) },
    );
  }
  if (!("result" in parsed) && !("error" in parsed)) {
    throw new A2AJsonRpcResponseError(
      `A2A response from ${url} has neither a result nor an error`,
      { url, responseText: boundProtocolResponseText(text) },
    );
  }
  if (
    "error" in parsed &&
    (!isRecord(parsed.error) ||
      typeof parsed.error.code !== "number" ||
      typeof parsed.error.message !== "string")
  ) {
    throw new A2AJsonRpcResponseError(
      `A2A response from ${url} has an invalid JSON-RPC error`,
      { url, responseText: boundProtocolResponseText(text) },
    );
  }
  return parsed as unknown as JsonRpcResponse;
}

function boundProtocolResponseText(text: string): string {
  return text.length <= 4_096 ? text : `${text.slice(0, 4_096)}…`;
}

function isA2AStreamingUnsupportedError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  return (
    code === -32601 ||
    code === -32004 ||
    /stream(?:ing)?[^a-z]*(?:not supported|unsupported|unavailable)/i.test(
      message,
    )
  );
}

function normalizeA2ATaskResult(
  value: unknown,
  responseId: string | number | null,
): Task {
  if (isRecord(value) && isA2ATaskLike(value)) {
    return normalizeA2ATask(value);
  }
  if (isRecord(value) && isRecord(value.task) && isA2ATaskLike(value.task)) {
    return normalizeA2ATask(value.task);
  }
  if (isRecord(value) && isRecord(value.message)) {
    const id =
      typeof responseId === "string" || typeof responseId === "number"
        ? String(responseId)
        : `a2a-${Date.now()}`;
    return {
      id,
      status: {
        state: "completed",
        message: normalizeA2AMessage(value.message),
        timestamp: new Date().toISOString(),
      },
    };
  }
  if (isRecord(value) && value.kind === "status-update") {
    if (typeof value.taskId !== "string" || !isRecord(value.status)) {
      throw new A2AJsonRpcResponseError(
        "A2A status update is missing a task id or status",
      );
    }
    return normalizeA2ATask({
      id: value.taskId,
      ...(typeof value.contextId === "string"
        ? { contextId: value.contextId }
        : {}),
      status: value.status,
    });
  }
  if (isRecord(value) && isRecord(value.statusUpdate)) {
    const update = value.statusUpdate;
    if (typeof update.taskId !== "string" || !isRecord(update.status)) {
      throw new A2AJsonRpcResponseError(
        "A2A status update is missing a task id or status",
      );
    }
    return normalizeA2ATask({
      id: update.taskId,
      ...(typeof update.contextId === "string"
        ? { contextId: update.contextId }
        : {}),
      status: update.status,
    });
  }
  if (isRecord(value) && isRecord(value.artifactUpdate)) {
    const update = value.artifactUpdate;
    if (
      typeof update.taskId !== "string" ||
      !isRecord(update.artifact) ||
      !Array.isArray(update.artifact.parts)
    ) {
      throw new A2AJsonRpcResponseError(
        "A2A artifact update is missing a task id or artifact",
      );
    }
    return {
      id: update.taskId,
      ...(typeof update.contextId === "string"
        ? { contextId: update.contextId }
        : {}),
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
      artifacts: [normalizeA2AArtifact(update.artifact)],
    };
  }
  if (isRecord(value) && value.kind === "artifact-update") {
    if (
      typeof value.taskId !== "string" ||
      !isRecord(value.artifact) ||
      !Array.isArray(value.artifact.parts)
    ) {
      throw new A2AJsonRpcResponseError(
        "A2A artifact update is missing a task id or artifact",
      );
    }
    return {
      id: value.taskId,
      ...(typeof value.contextId === "string"
        ? { contextId: value.contextId }
        : {}),
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
      artifacts: [normalizeA2AArtifact(value.artifact)],
    };
  }
  throw new A2AJsonRpcResponseError(
    "A2A JSON-RPC result is not a task or message",
  );
}

function normalizeA2ATask(value: Record<string, unknown>): Task {
  const status = value.status as Record<string, unknown>;
  const state = normalizeA2ATaskState(status.state);
  return {
    ...(value as unknown as Task),
    ...(Array.isArray(value.history)
      ? { history: value.history.map(normalizeA2AMessage) }
      : {}),
    ...(Array.isArray(value.artifacts)
      ? { artifacts: value.artifacts.map(normalizeA2AArtifact) }
      : {}),
    status: {
      ...(status as unknown as Task["status"]),
      state,
      ...(isRecord(status.message)
        ? { message: normalizeA2AMessage(status.message) }
        : {}),
    },
  };
}

function normalizeA2AMessage(value: Record<string, unknown>): Message {
  const role = value.role;
  return {
    ...(value as unknown as Message),
    role:
      role === "ROLE_USER" || role === "user"
        ? "user"
        : role === "ROLE_AGENT" || role === "agent"
          ? "agent"
          : "agent",
    parts: Array.isArray(value.parts)
      ? value.parts.map(normalizeA2APart)
      : Array.isArray(value.content)
        ? value.content.map(normalizeA2APart)
        : [],
  };
}

function normalizeA2AArtifact(value: Record<string, unknown>): Artifact {
  return {
    ...(value as Record<string, unknown>),
    parts: Array.isArray(value.parts) ? value.parts.map(normalizeA2APart) : [],
  };
}

function normalizeA2APart(value: unknown): Part {
  if (!isRecord(value)) return { type: "text" as const, text: "" };
  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: value.text };
  }
  if (value.type === "file" && isRecord(value.file)) {
    return {
      type: "file",
      file: {
        ...(typeof value.file.name === "string"
          ? { name: value.file.name }
          : {}),
        ...(typeof value.file.mimeType === "string"
          ? { mimeType: value.file.mimeType }
          : {}),
        ...(typeof value.file.bytes === "string"
          ? { bytes: value.file.bytes }
          : {}),
        ...(typeof value.file.uri === "string" ? { uri: value.file.uri } : {}),
      },
    };
  }
  if (value.type === "data" && isRecord(value.data)) {
    return { type: "data", data: value.data };
  }
  if (value.kind === "text" || typeof value.text === "string") {
    return { type: "text" as const, text: String(value.text ?? "") };
  }
  if (value.kind === "file" || "raw" in value || "url" in value) {
    return {
      type: "file" as const,
      file: {
        ...(typeof value.filename === "string" ? { name: value.filename } : {}),
        ...(typeof value.mediaType === "string"
          ? { mimeType: value.mediaType }
          : {}),
        ...(typeof value.raw === "string" ? { bytes: value.raw } : {}),
        ...(typeof value.url === "string" ? { uri: value.url } : {}),
      },
    };
  }
  if (value.kind === "data" || "data" in value) {
    return {
      type: "data" as const,
      data: (value.data ?? {}) as Record<string, unknown>,
    };
  }
  return { type: "text" as const, text: "" };
}

function normalizeA2ATaskState(value: unknown): Task["status"]["state"] {
  if (typeof value !== "string") {
    throw new A2AJsonRpcResponseError("A2A task status has no valid state");
  }
  const normalized = value
    .replace(/^TASK_STATE_/i, "")
    .toLowerCase()
    .replace(/_/g, "-");
  if (
    normalized === "submitted" ||
    normalized === "working" ||
    normalized === "processing" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "canceled" ||
    normalized === "input-required" ||
    normalized === "auth-required"
  ) {
    return normalized === "auth-required" ? "input-required" : normalized;
  }
  if (normalized === "rejected") return "failed";
  throw new A2AJsonRpcResponseError(
    `A2A task status has unsupported state: ${value}`,
  );
}

function isA2ATaskLike(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    isRecord(value.status) &&
    typeof value.status.state === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function uniqueEndpointCandidates(
  candidates: A2AEndpointCandidate[],
): A2AEndpointCandidate[] {
  const byUrl = new Map<string, A2AEndpointCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    byUrl.set(
      candidate.url,
      existing
        ? {
            url: existing.url,
            protocolVersion:
              existing.protocolVersion ?? candidate.protocolVersion,
            streaming: existing.streaming ?? candidate.streaming,
            tenant: existing.tenant ?? candidate.tenant,
          }
        : candidate,
    );
  }
  return [...byUrl.values()];
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

export async function callAgent(
  url: string,
  text: string,
  opts?: {
    apiKey?: string;
    apiKeyFallbacks?: string[];
    metadata?: Record<string, unknown>;
    transportHeaders?: Record<string, string>;
    cardUrl?: string;
    agentCardUrl?: string;
    protocolVersion?: A2AProtocolVersion;
    a2aVersion?: A2AProtocolVersion;
    contextId?: string;
    userEmail?: string;
    orgDomain?: string;
    orgSecret?: string;
    requestOrigin?: string;
    approvedActions?: A2AApprovedAction[];
    sourceContext?: A2ASourceContextReference;
    correlation?: A2ACorrelationMetadata;
    idempotencyKey?: string;
    async?: boolean;
    timeoutMs?: number;
    submissionTimeoutMs?: number;
    taskId?: string;
    pollIntervalMs?: number;
    returnRecoverableArtifactsOnTimeout?: boolean;
    onUpdate?: (task: Task) => void;
  },
): Promise<string> {
  const metadata: Record<string, unknown> = { ...opts?.metadata };
  if (opts?.userEmail) metadata.userEmail = opts.userEmail;
  if (opts?.orgDomain) metadata.orgDomain = opts.orgDomain;
  if (opts?.requestOrigin) metadata.requestOrigin = opts.requestOrigin;
  if (opts?.sourceContext) metadata.sourceContext = opts.sourceContext;
  Object.assign(metadata, sanitizeA2ACorrelationMetadata(opts?.correlation));

  const useAsync = opts?.async ?? true;
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
        transportHeaders: opts?.transportHeaders,
        cardUrl: opts?.cardUrl ?? opts?.agentCardUrl,
        protocolVersion: opts?.protocolVersion ?? opts?.a2aVersion,
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
    cardUrl?: string;
    agentCardUrl?: string;
    protocolVersion?: A2AProtocolVersion;
    a2aVersion?: A2AProtocolVersion;
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
    cardUrl: opts?.cardUrl ?? opts?.agentCardUrl,
    protocolVersion: opts?.protocolVersion ?? opts?.a2aVersion,
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
  if (
    err instanceof RemoteAgentCredentialRejectedError ||
    (isRecord(err) && err.code === "credential_rejected")
  ) {
    return true;
  }
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
