import { appendA2AArtifactLinks } from "../a2a/artifact-response.js";
import { A2AClient, signA2AToken } from "../a2a/client.js";
import type { Task } from "../a2a/types.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
} from "../agent/engine/credential-errors.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import {
  claimA2AContinuation,
  claimA2AContinuationDelivery,
  claimDueA2AContinuations,
  completeA2AContinuation,
  failA2AContinuation,
  getA2AContinuation,
  rescheduleA2AContinuation,
  type A2AContinuation,
} from "./a2a-continuations-store.js";
import { signInternalToken } from "./internal-token.js";
import type {
  OutgoingMessage,
  PlatformAdapter,
  PlatformRunProgress,
} from "./types.js";

const PROCESSOR_PATH = `${FRAMEWORK_ROUTE_PREFIX}/integrations/process-a2a-continuation`;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const MAX_ATTEMPTS = 30;
const MAX_REMOTE_WORK_MS = 20 * 60_000;
// Re-dispatch continuations after a short delay. Serverless hosts do not keep
// in-memory interval sweepers alive between requests, so delayed self-dispatch
// is the portable retry mechanism.
const RESCHEDULE_DELAY_MS = 20_000;
const MAX_PRE_CLAIM_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 2_000;
const PROCESSOR_WAIT_MS = 10_000;
const POLL_REQUEST_TIMEOUT_MS = 8_000;
const PLATFORM_SEND_TIMEOUT_MS = 12_000;
const DISPATCH_SETTLE_WAIT_MS = 2_000;
const COMPLETE_AFTER_DELIVERY_ATTEMPTS = 3;

export async function dispatchA2AContinuation(
  continuationId: string,
  webhookBaseUrl?: string,
): Promise<void> {
  const baseUrl =
    webhookBaseUrl ||
    process.env.WEBHOOK_BASE_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  const url = `${withConfiguredAppBasePath(baseUrl)}${PROCESSOR_PATH}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(continuationId)}`;
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[integrations] Refusing to dispatch A2A continuation ${continuationId} — A2A_SECRET not configured.`,
      );
      return;
    }
    if (err instanceof Error && !/A2A_SECRET/i.test(err.message)) {
      console.error(
        `[integrations] signInternalToken failed unexpectedly for ${continuationId}:`,
        err,
      );
    }
  }

  const dispatchPromise = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ continuationId }),
  })
    .then(async (response) => {
      if (!response.ok) {
        await logFailedDispatchResponse(continuationId, response);
      }
    })
    .catch((err) => {
      console.error(
        `[integrations] Failed to dispatch A2A continuation ${continuationId}:`,
        err,
      );
    });

  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) =>
      setTimeout(resolve, DISPATCH_SETTLE_WAIT_MS),
    ),
  ]);
}

async function logFailedDispatchResponse(
  continuationId: string,
  response: Response,
): Promise<void> {
  let body = "";
  try {
    body = await response.text();
  } catch {}

  const trimmedBody = body.trim();
  console.error(
    `[integrations] A2A continuation ${continuationId} processor dispatch returned HTTP ` +
      `${response.status}${response.statusText ? ` ${response.statusText}` : ""}` +
      `${trimmedBody ? `: ${trimmedBody.slice(0, 500)}` : ""}`,
  );
}

export async function processA2AContinuationById(
  continuationId: string,
  options: { adapters: Map<string, PlatformAdapter> },
): Promise<void> {
  const shouldClaim = await waitForContinuationDue(continuationId);
  if (!shouldClaim) return;
  const continuation = await claimA2AContinuation(continuationId);
  if (!continuation) return;
  await processClaimedContinuation(continuation, options);
}

export async function processDueA2AContinuations(options: {
  adapters: Map<string, PlatformAdapter>;
  limit?: number;
}): Promise<void> {
  const continuations = await claimDueA2AContinuations(options.limit ?? 5);
  for (const continuation of continuations) {
    await processClaimedContinuation(continuation, options).catch((err) =>
      console.error(
        `[integrations] A2A continuation ${continuation.id} failed:`,
        err,
      ),
    );
  }
}

async function processClaimedContinuation(
  continuation: A2AContinuation,
  options: { adapters: Map<string, PlatformAdapter> },
): Promise<void> {
  const adapter = options.adapters.get(continuation.platform);
  if (!adapter) {
    await failA2AContinuation(
      continuation.id,
      `Unknown platform: ${continuation.platform}`,
    );
    return;
  }

  const progress = await resumeA2AContinuationProgress(continuation, adapter);

  const auth = await signContinuationToken(continuation);
  const client = new A2AClient(continuation.agentUrl, auth.apiKey, {
    requestTimeoutMs: POLL_REQUEST_TIMEOUT_MS,
    ...(auth.apiKeyFallbacks ? { fallbackApiKeys: auth.apiKeyFallbacks } : {}),
  });
  const deadline = Date.now() + PROCESSOR_WAIT_MS;
  let task: Task | null = null;

  try {
    while (Date.now() < deadline) {
      task = await client.getTask(continuation.a2aTaskId);
      if (TERMINAL_STATES.has(task.status.state)) break;
      await reportA2AContinuationProgress(continuation, progress, task);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (err) {
    if (isTransientA2APollError(err)) {
      if (shouldStopPollingRemoteTask(continuation)) {
        await notifyAndFailA2AContinuation(
          continuation,
          adapter,
          remotePollFailureReason(continuation),
          progress,
        );
        return;
      }
      await rescheduleAndRedispatchA2AContinuation(continuation.id);
      return;
    }
    if (continuation.attempts >= MAX_ATTEMPTS) {
      await notifyAndFailA2AContinuation(
        continuation,
        adapter,
        err instanceof Error ? err.message : String(err),
        progress,
      );
      return;
    }
    await rescheduleAndRedispatchA2AContinuation(continuation.id);
    return;
  }

  if (!task || !TERMINAL_STATES.has(task.status.state)) {
    if (shouldStopPollingRemoteTask(continuation)) {
      await notifyAndFailA2AContinuation(
        continuation,
        adapter,
        remotePollFailureReason(continuation),
        progress,
      );
      return;
    }
    await rescheduleAndRedispatchA2AContinuation(continuation.id);
    return;
  }

  if (task.status.state !== "completed") {
    const reason =
      extractTaskText(task) ||
      `Remote A2A task ${continuation.a2aTaskId} ended with state ${task.status.state}`;
    await notifyAndFailA2AContinuation(continuation, adapter, reason, progress);
    return;
  }

  const text = formatContinuationArtifactText(
    extractTaskText(task),
    continuation.agentUrl,
  );
  if (!text.trim()) {
    await notifyAndFailA2AContinuation(
      continuation,
      adapter,
      `Remote A2A task ${continuation.a2aTaskId} completed without text`,
      progress,
    );
    return;
  }

  await deliverAndCompleteA2AContinuation(
    continuation,
    adapter,
    text,
    progress,
  );
}

async function resumeA2AContinuationProgress(
  continuation: A2AContinuation,
  adapter: PlatformAdapter,
): Promise<PlatformRunProgress | null> {
  if (!continuation.progressRef || !adapter.resumeRunProgress) return null;
  try {
    const progress = await adapter.resumeRunProgress(
      continuation.incoming,
      continuation.progressRef,
    );
    if (!progress) return null;
    await progress.onEvent({
      type: "agent_call_progress",
      agent: continuation.agentName,
      state: "working",
      elapsedSeconds: Math.max(
        0,
        Math.round((Date.now() - continuation.createdAt) / 1_000),
      ),
      detail: "Continuing in the background",
    });
    return progress;
  } catch {
    // A continuation still has a normal reply fallback. Do not log the
    // opaque provider reference or the inbound message payload.
    return null;
  }
}

async function reportA2AContinuationProgress(
  continuation: A2AContinuation,
  progress: PlatformRunProgress | null,
  task: Task,
): Promise<void> {
  if (!progress) return;
  await progress.onEvent({
    type: "agent_call_progress",
    agent: continuation.agentName,
    state: task.status.state,
    elapsedSeconds: Math.max(
      0,
      Math.round((Date.now() - continuation.createdAt) / 1_000),
    ),
    detail: "Still working on the delegated request",
  });
}

async function waitForContinuationDue(
  continuationId: string,
): Promise<boolean> {
  const continuation = await getA2AContinuation(continuationId);
  if (!continuation) return false;
  if (continuation.status === "completed" || continuation.status === "failed") {
    return false;
  }
  if (continuation.status !== "pending") return true;

  const waitMs = continuation.nextCheckAt - Date.now();
  if (waitMs <= 0) return true;

  if (waitMs > MAX_PRE_CLAIM_WAIT_MS) return false;

  await sleep(waitMs);
  return true;
}

async function notifyAndFailA2AContinuation(
  continuation: A2AContinuation,
  adapter: PlatformAdapter,
  reason: string,
  progress: PlatformRunProgress | null = null,
): Promise<void> {
  const deliveryContinuation = await claimA2AContinuationDelivery(
    continuation.id,
  );
  if (!deliveryContinuation) return;

  const message = formatContinuationFailureMessage(
    deliveryContinuation,
    reason,
  );
  try {
    const outgoing = adapter.formatAgentResponse(message);
    await withTimeout(
      deliverA2AContinuationResponse(
        adapter,
        deliveryContinuation,
        outgoing,
        progress,
        "error",
      ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${deliveryContinuation.platform} failure notification timed out`,
    );
  } catch (err) {
    console.error(
      `[integrations] Failed to notify ${deliveryContinuation.platform} about failed A2A continuation ${deliveryContinuation.id}:`,
      err,
    );
  }

  await failA2AContinuation(deliveryContinuation.id, reason);
}

async function deliverAndCompleteA2AContinuation(
  continuation: A2AContinuation,
  adapter: PlatformAdapter,
  text: string,
  progress: PlatformRunProgress | null = null,
): Promise<void> {
  const deliveryContinuation = await claimA2AContinuationDelivery(
    continuation.id,
  );
  if (!deliveryContinuation) return;

  try {
    const outgoing = adapter.formatAgentResponse(text);
    await withTimeout(
      deliverA2AContinuationResponse(
        adapter,
        deliveryContinuation,
        outgoing,
        progress,
        "done",
      ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${deliveryContinuation.platform} response delivery timed out`,
    );
  } catch (err) {
    if (deliveryContinuation.attempts >= MAX_ATTEMPTS) {
      await failA2AContinuation(
        deliveryContinuation.id,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    await rescheduleAndRedispatchA2AContinuation(deliveryContinuation.id);
    return;
  }

  await completeAfterSuccessfulDelivery(deliveryContinuation);
}

async function deliverA2AContinuationResponse(
  adapter: PlatformAdapter,
  continuation: A2AContinuation,
  message: OutgoingMessage,
  progress: PlatformRunProgress | null,
  status: "done" | "error",
): Promise<void> {
  if (progress) {
    try {
      await progress.onEvent({
        type: "agent_call",
        agent: continuation.agentName,
        status,
      });
      await progress.complete(message);
      return;
    } catch {
      // A resumed Slack stream can no longer be finalized (for example when
      // chat.stopStream rejects). Preserve the final answer with the same
      // thread reply fallback used by the initial webhook run. Also ask the
      // adapter to terminate the native stream: otherwise Slack can keep the
      // task card in its working state after the thread fallback succeeds.
      try {
        await progress.fail?.(
          "I couldn't update the live response, but I posted the final result in this thread.",
        );
      } catch {
        // The thread reply below is still the authoritative final answer.
      }
    }
  }
  await adapter.sendResponse(message, continuation.incoming, {
    placeholderRef: continuation.placeholderRef ?? undefined,
  });
}

async function rescheduleAndRedispatchA2AContinuation(
  continuationId: string,
): Promise<void> {
  await rescheduleA2AContinuation(continuationId, RESCHEDULE_DELAY_MS);
  await dispatchA2AContinuation(continuationId).catch((err) => {
    console.error(
      `[integrations] Failed to redispatch A2A continuation ${continuationId}:`,
      err,
    );
  });
}

async function completeAfterSuccessfulDelivery(
  continuation: A2AContinuation,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < COMPLETE_AFTER_DELIVERY_ATTEMPTS; attempt++) {
    try {
      await completeA2AContinuation(continuation.id);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  console.error(
    `[integrations] ${continuation.platform} accepted A2A continuation ${continuation.id}, ` +
      "but marking it completed failed. Leaving it in delivering for stale-delivery recovery.",
    lastError,
  );
}

function formatContinuationFailureMessage(
  continuation: A2AContinuation,
  reason: string,
): string {
  const explicitCode = extractFailureCode(reason);
  const diagnostics = formatContinuationFailureDiagnostics(
    continuation,
    reason,
  );
  if (isLlmCredentialError(reason, explicitCode)) {
    return (
      formatLlmCredentialErrorMessage({
        agentName: continuation.agentName,
      }) + diagnostics
    );
  }

  return `The ${continuation.agentName} agent could not finish this request: ${sanitizeFailureReason(
    reason,
  )}${diagnostics}`;
}

function formatContinuationFailureDiagnostics(
  continuation: A2AContinuation,
  reason: string,
): string {
  return `\n\nError code: \`${continuationFailureCode(reason)}\`\nRequest ID: \`${continuation.integrationTaskId}\`\nContinuation ID: \`${continuation.id}\`\nDownstream task ID: \`${continuation.a2aTaskId}\``;
}

function continuationFailureCode(reason: string): string {
  const explicitCode = extractFailureCode(reason);
  if (explicitCode) return explicitCode;
  if (isLlmCredentialError(reason, explicitCode)) {
    return LLM_MISSING_CREDENTIALS_ERROR_CODE;
  }
  if (/\btimed out polling\b/i.test(reason)) return "a2a_remote_timeout";
  return "a2a_downstream_error";
}

function extractFailureCode(reason: string): string | null {
  const match = /\bcode\s*[:=]\s*[`"']?([a-z][a-z0-9_]{0,79})\b/i.exec(reason);
  return match?.[1]?.toLowerCase() ?? null;
}

function isRemoteWorkExpired(continuation: A2AContinuation): boolean {
  return Date.now() - continuation.createdAt >= MAX_REMOTE_WORK_MS;
}

function shouldStopPollingRemoteTask(continuation: A2AContinuation): boolean {
  return (
    continuation.attempts >= MAX_ATTEMPTS || isRemoteWorkExpired(continuation)
  );
}

function isTransientA2APollError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return /operation was aborted|aborted|timed out|timeout|Invalid or expired A2A token|A2A request failed \((?:401|508)\)/i.test(
    err.message,
  );
}

function remotePollFailureReason(continuation: A2AContinuation): string {
  if (isRemoteWorkExpired(continuation)) {
    return `Timed out polling the ${continuation.agentName} A2A task ${continuation.a2aTaskId} after ${Math.round(
      MAX_REMOTE_WORK_MS / 60_000,
    )} minutes. The downstream agent did not return a final result.`;
  }

  return `Timed out polling the ${continuation.agentName} A2A task ${continuation.a2aTaskId} after ${MAX_ATTEMPTS} attempts. The downstream agent did not return a final result.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizeFailureReason(reason: string): string {
  const oneLine = reason.replace(/\s+/g, " ").trim();
  const withoutEnvNames = oneLine.replace(
    /\b[A-Z][A-Z0-9_]*(?:API_KEY|PRIVATE_KEY|SECRET|TOKEN)\b/g,
    "a required credential",
  );
  return (
    withoutEnvNames.slice(0, 500) ||
    "the downstream agent returned an empty error"
  );
}

async function signContinuationToken(
  continuation: A2AContinuation,
): Promise<{ apiKey?: string; apiKeyFallbacks?: string[] }> {
  if (continuation.a2aAuthToken === "") {
    return {};
  }

  const storedToken = continuation.a2aAuthToken;
  if (storedToken && !isLikelyJwt(storedToken)) return { apiKey: storedToken };

  const freshTokens = await signFreshContinuationTokens(continuation);
  if (freshTokens.length > 0) {
    return {
      apiKey: freshTokens[0],
      ...(freshTokens.length > 1
        ? { apiKeyFallbacks: freshTokens.slice(1) }
        : {}),
    };
  }
  if (!storedToken) return {};

  // Older continuations may have persisted the initial short-lived JWT. Avoid
  // replaying it forever after expiry; opaque legacy bearer keys can still be
  // reused because we cannot re-mint those.
  if (isLikelyJwt(storedToken)) return {};
  return { apiKey: storedToken };
}

async function signFreshContinuationTokens(
  continuation: A2AContinuation,
): Promise<string[]> {
  let orgDomain: string | undefined;
  let orgSecret: string | undefined;
  if (continuation.orgId) {
    try {
      const { getOrgDomain, getOrgA2ASecret } =
        await import("../org/context.js");
      orgDomain = (await getOrgDomain(continuation.orgId)) ?? undefined;
      orgSecret = (await getOrgA2ASecret(continuation.orgId)) ?? undefined;
    } catch {}
  }

  if (!continuation.ownerEmail || !(orgSecret || process.env.A2A_SECRET)) {
    return [];
  }

  const tokens: string[] = [];
  const add = (token: string | undefined) => {
    if (token && !tokens.includes(token)) tokens.push(token);
  };

  if (process.env.A2A_SECRET?.trim()) {
    try {
      add(
        await signA2AToken(continuation.ownerEmail, orgDomain, orgSecret, {
          expiresIn: "30m",
          preferGlobalSecret: true,
        }),
      );
    } catch {}
  }
  if (orgSecret) {
    try {
      add(
        await signA2AToken(continuation.ownerEmail, orgDomain, orgSecret, {
          expiresIn: "30m",
          preferGlobalSecret: false,
        }),
      );
    } catch {}
  }
  return tokens;
}

function isLikelyJwt(token: string): boolean {
  return token.split(".").length === 3;
}

function extractTaskText(task: Task): string {
  const parts = task.status.message?.parts ?? [];
  return parts
    .filter((part): part is { type: "text"; text: string } => {
      return part.type === "text" && typeof part.text === "string";
    })
    .map((part) => part.text)
    .join("\n");
}

function formatContinuationArtifactText(
  text: string,
  agentUrl: string,
): string {
  const expandedText = expandRelativeUrls(text, agentUrl);
  return appendA2AArtifactLinks(
    expandedText,
    [{ tool: "call-agent", result: expandedText }],
    { baseUrl: resolveArtifactBaseUrl() },
  );
}

function resolveArtifactBaseUrl(): string | undefined {
  const baseUrl =
    process.env.APP_URL || process.env.URL || process.env.DEPLOY_URL;
  return baseUrl ? withConfiguredAppBasePath(baseUrl) : undefined;
}

function expandRelativeUrls(text: string, agentUrl: string): string {
  if (!text || !agentUrl) return text;
  const base = publicAgentBaseUrl(agentUrl);
  return text.replace(
    /(^|[\s([<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}

function publicAgentBaseUrl(agentUrl: string): string {
  try {
    const url = new URL(agentUrl);
    const routeIndex = url.pathname.indexOf(FRAMEWORK_ROUTE_PREFIX);
    url.pathname =
      routeIndex >= 0
        ? url.pathname.slice(0, routeIndex) || "/"
        : url.pathname.replace(/\/+$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return agentUrl.replace(/\/$/, "");
  }
}
