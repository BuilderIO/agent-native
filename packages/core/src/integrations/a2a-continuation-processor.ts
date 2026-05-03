import { A2AClient, signA2AToken } from "../a2a/client.js";
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
const RESCHEDULE_DELAY_MS = 5_000;
const MAX_PRE_CLAIM_WAIT_MS = RESCHEDULE_DELAY_MS + 5_000;
const POLL_INTERVAL_MS = 2_000;
const PROCESSOR_WAIT_MS = 20_000;
const POLL_REQUEST_TIMEOUT_MS = 25_000;
const PLATFORM_SEND_TIMEOUT_MS = 12_000;
const DISPATCH_SETTLE_WAIT_MS = 2_000;

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
      await redispatchContinuation(continuation.id);
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
    await redispatchContinuation(continuation.id);
    return;
  }

  if (!task || !TERMINAL_STATES.has(task.status.state)) {
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
    await redispatchContinuation(continuation.id);
    return;
  }

  if (task.status.state !== "completed") {
    const reason =
      extractTaskText(task) ||
      `Remote A2A task ${continuation.a2aTaskId} ended with state ${task.status.state}`;
    await notifyAndFailA2AContinuation(continuation, adapter, reason);
    return;
  }

  const text = expandRelativeUrls(extractTaskText(task), continuation.agentUrl);
  if (!text.trim()) {
    await notifyAndFailA2AContinuation(
      continuation,
      adapter,
      `Remote A2A task ${continuation.a2aTaskId} completed without text`,
    );
    return;
  }

  try {
    await withTimeout(
      adapter.sendResponse(
        adapter.formatAgentResponse(text),
        continuation.incoming,
        { placeholderRef: continuation.placeholderRef ?? undefined },
      ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${continuation.platform} response delivery timed out`,
    );
    await completeA2AContinuation(continuation.id);
  } catch (err) {
    if (continuation.attempts >= MAX_ATTEMPTS) {
      await failA2AContinuation(
        continuation.id,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    await rescheduleA2AContinuation(continuation.id, RESCHEDULE_DELAY_MS);
    await redispatchContinuation(continuation.id);
  }
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

  await sleep(Math.min(waitMs, MAX_PRE_CLAIM_WAIT_MS));
  return true;
}

async function notifyAndFailA2AContinuation(
  continuation: A2AContinuation,
  adapter: PlatformAdapter,
  reason: string,
): Promise<void> {
  const message = formatContinuationFailureMessage(continuation, reason);
  try {
    await withTimeout(
      adapter.sendResponse(
        adapter.formatAgentResponse(message),
        continuation.incoming,
        { placeholderRef: continuation.placeholderRef ?? undefined },
      ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${continuation.platform} failure notification timed out`,
    );
  } catch (err) {
    console.error(
      `[integrations] Failed to notify ${continuation.platform} about failed A2A continuation ${continuation.id}:`,
      err,
    );
  }

  await failA2AContinuation(continuation.id, reason);
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
  return /operation was aborted|aborted|timed out|timeout|Invalid or expired A2A token|A2A request failed \(401\)/i.test(
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

async function redispatchContinuation(continuationId: string): Promise<void> {
  await dispatchA2AContinuation(continuationId).catch((err) => {
    console.error(
      `[integrations] Failed to redispatch A2A continuation ${continuationId}:`,
      err,
    );
  });
}

async function signContinuationToken(
  continuation: A2AContinuation,
): Promise<string | undefined> {
  if (continuation.a2aAuthToken !== null) {
    return continuation.a2aAuthToken || undefined;
  }

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
    });
  } catch {
    return undefined;
  }
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

function expandRelativeUrls(text: string, agentUrl: string): string {
  if (!text || !agentUrl) return text;
  const base = agentUrl.replace(/\/$/, "");
  return text.replace(
    /(^|[\s(\[<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}
