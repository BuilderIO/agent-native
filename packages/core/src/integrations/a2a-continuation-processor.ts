import { A2AClient, signA2AToken } from "../a2a/client.js";
import { appendA2AArtifactLinks } from "../a2a/artifact-response.js";
import type { Task } from "../a2a/types.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { signInternalToken } from "./internal-token.js";
import type { PlatformAdapter } from "./types.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
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

const PROCESSOR_PATH = `${FRAMEWORK_ROUTE_PREFIX}/integrations/process-a2a-continuation`;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const MAX_ATTEMPTS = 6;
const MAX_REMOTE_WORK_MS = 10 * 60_000;
// Do not chain immediate self-dispatches for long-running remote A2A tasks.
// Netlify and similar hosts can reject repeated same-site self-invocations
// with loop-protection responses. The integration retry job sweeps due rows.
const RESCHEDULE_DELAY_MS = 60_000;
const MAX_PRE_CLAIM_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;
const PROCESSOR_WAIT_MS = 20_000;
const POLL_REQUEST_TIMEOUT_MS = 25_000;
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

  const client = new A2AClient(
    continuation.agentUrl,
    await signContinuationToken(continuation),
    { requestTimeoutMs: POLL_REQUEST_TIMEOUT_MS },
  );
  const deadline = Date.now() + PROCESSOR_WAIT_MS;
  let task: Task | null = null;

  try {
    while (Date.now() < deadline) {
      task = await client.getTask(continuation.a2aTaskId);
      if (TERMINAL_STATES.has(task.status.state)) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (err) {
    if (isTransientA2APollError(err)) {
      if (isRemoteWorkExpired(continuation)) {
        await notifyAndFailA2AContinuation(
          continuation,
          adapter,
          remotePollTimeoutReason(continuation),
        );
        return;
      }
      await rescheduleA2AContinuation(continuation.id, RESCHEDULE_DELAY_MS);
      return;
    }
    if (continuation.attempts >= MAX_ATTEMPTS) {
      await notifyAndFailA2AContinuation(
        continuation,
        adapter,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    await rescheduleA2AContinuation(continuation.id, RESCHEDULE_DELAY_MS);
    return;
  }

  if (!task || !TERMINAL_STATES.has(task.status.state)) {
    const recoverableArtifactText = extractRecoverableArtifactText(task);
    if (recoverableArtifactText) {
      await deliverAndCompleteA2AContinuation(
        continuation,
        adapter,
        formatContinuationArtifactText(
          recoverableArtifactText,
          continuation.agentUrl,
        ),
      );
      return;
    }

    if (isRemoteWorkExpired(continuation)) {
      await notifyAndFailA2AContinuation(
        continuation,
        adapter,
        `Remote A2A task ${continuation.a2aTaskId} did not complete within ${Math.round(
          MAX_REMOTE_WORK_MS / 60_000,
        )} minutes`,
      );
      return;
    }
    await rescheduleA2AContinuation(continuation.id, RESCHEDULE_DELAY_MS);
    return;
  }

  if (task.status.state !== "completed") {
    const reason =
      extractTaskText(task) ||
      `Remote A2A task ${continuation.a2aTaskId} ended with state ${task.status.state}`;
    await notifyAndFailA2AContinuation(continuation, adapter, reason);
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
    );
    return;
  }

  await deliverAndCompleteA2AContinuation(continuation, adapter, text);
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
    await withTimeout(
      adapter.sendResponse(
        adapter.formatAgentResponse(message),
        deliveryContinuation.incoming,
        { placeholderRef: deliveryContinuation.placeholderRef ?? undefined },
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
): Promise<void> {
  const deliveryContinuation = await claimA2AContinuationDelivery(
    continuation.id,
  );
  if (!deliveryContinuation) return;

  try {
    await withTimeout(
      adapter.sendResponse(
        adapter.formatAgentResponse(text),
        deliveryContinuation.incoming,
        { placeholderRef: deliveryContinuation.placeholderRef ?? undefined },
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
    await rescheduleA2AContinuation(
      deliveryContinuation.id,
      RESCHEDULE_DELAY_MS,
    );
    return;
  }

  await completeAfterSuccessfulDelivery(deliveryContinuation);
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
  if (isLlmCredentialError(reason)) {
    return formatLlmCredentialErrorMessage({
      agentName: continuation.agentName,
    });
  }

  return `The ${continuation.agentName} agent could not finish this request: ${sanitizeFailureReason(
    reason,
  )}`;
}

function isRemoteWorkExpired(continuation: A2AContinuation): boolean {
  return Date.now() - continuation.createdAt >= MAX_REMOTE_WORK_MS;
}

function isTransientA2APollError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return /operation was aborted|aborted|timed out|timeout|Invalid or expired A2A token|A2A request failed \((?:401|508)\)/i.test(
    err.message,
  );
}

function remotePollTimeoutReason(continuation: A2AContinuation): string {
  return `Timed out polling the ${continuation.agentName} A2A task ${continuation.a2aTaskId} after ${Math.round(
    MAX_REMOTE_WORK_MS / 60_000,
  )} minutes. The downstream agent did not return a final result.`;
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
): Promise<string | undefined> {
  if (continuation.a2aAuthToken === "") {
    return undefined;
  }

  const storedToken = continuation.a2aAuthToken;
  if (storedToken && !isLikelyJwt(storedToken)) return storedToken;

  const freshToken = await signFreshContinuationToken(continuation);
  if (freshToken) return freshToken;
  if (!storedToken) return undefined;

  // Older continuations may have persisted the initial short-lived JWT. Avoid
  // replaying it forever after expiry; opaque legacy bearer keys can still be
  // reused because we cannot re-mint those.
  if (isLikelyJwt(storedToken)) return undefined;
  return storedToken;
}

async function signFreshContinuationToken(
  continuation: A2AContinuation,
): Promise<string | undefined> {
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
    return undefined;
  }

  try {
    return await signA2AToken(continuation.ownerEmail, orgDomain, orgSecret, {
      expiresIn: "30m",
      preferGlobalSecret: true,
    });
  } catch {
    return undefined;
  }
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

function extractRecoverableArtifactText(task: Task | null): string {
  if (!task?.status.message?.metadata?.agentNativeRecoverableArtifacts) {
    return "";
  }
  return extractTaskText(task);
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
  const base = agentUrl.replace(/\/$/, "");
  return text.replace(
    /(^|[\s(\[<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}
