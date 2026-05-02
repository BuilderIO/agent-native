import { A2AClient, signA2AToken } from "../a2a/client.js";
import type { Task } from "../a2a/types.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { signInternalToken } from "./internal-token.js";
import type { PlatformAdapter } from "./types.js";
import {
  claimA2AContinuation,
  claimDueA2AContinuations,
  completeA2AContinuation,
  failA2AContinuation,
  rescheduleA2AContinuation,
  type A2AContinuation,
} from "./a2a-continuations-store.js";

const PROCESSOR_PATH = `${FRAMEWORK_ROUTE_PREFIX}/integrations/process-a2a-continuation`;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2_000;
const PROCESSOR_WAIT_MS = 20_000;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ continuationId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function processA2AContinuationById(
  continuationId: string,
  options: { adapters: Map<string, PlatformAdapter> },
): Promise<void> {
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
    { requestTimeoutMs: 10_000 },
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
    if (continuation.attempts >= MAX_ATTEMPTS) {
      await failA2AContinuation(
        continuation.id,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    await rescheduleA2AContinuation(continuation.id, 30_000);
    await redispatchContinuation(continuation.id);
    return;
  }

  if (!task || !TERMINAL_STATES.has(task.status.state)) {
    if (continuation.attempts >= MAX_ATTEMPTS) {
      await failA2AContinuation(
        continuation.id,
        `Remote A2A task ${continuation.a2aTaskId} did not complete after ${MAX_ATTEMPTS} attempts`,
      );
      return;
    }
    await rescheduleA2AContinuation(continuation.id, 30_000);
    await redispatchContinuation(continuation.id);
    return;
  }

  if (task.status.state !== "completed") {
    await failA2AContinuation(
      continuation.id,
      `Remote A2A task ${continuation.a2aTaskId} ended with state ${task.status.state}`,
    );
    return;
  }

  const text = expandRelativeUrls(extractTaskText(task), continuation.agentUrl);
  if (!text.trim()) {
    await failA2AContinuation(
      continuation.id,
      `Remote A2A task ${continuation.a2aTaskId} completed without text`,
    );
    return;
  }

  try {
    await adapter.sendResponse(
      adapter.formatAgentResponse(text),
      continuation.incoming,
      { placeholderRef: continuation.placeholderRef ?? undefined },
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
    await rescheduleA2AContinuation(continuation.id, 30_000);
    await redispatchContinuation(continuation.id);
  }
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
    return await signA2AToken(continuation.ownerEmail, orgDomain, orgSecret);
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
