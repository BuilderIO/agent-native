import {
  appendA2AArtifactLinks,
  extractA2AArtifactIdentities,
  stripA2APersistedArtifactMarkers,
  type A2AArtifactIdentity,
} from "../a2a/artifact-response.js";
import { A2AClient, signA2AToken } from "../a2a/client.js";
import type { Task } from "../a2a/types.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
} from "../agent/engine/credential-errors.js";
import { extractThreadMeta } from "../agent/thread-data-builder.js";
import { getThread, updateThreadData } from "../chat-threads/store.js";
import { resolveArtifactBaseUrl } from "../server/agent-chat/action-filters-a2a.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { resolveSelfDispatchBaseUrl } from "../server/self-dispatch.js";
import {
  claimA2AContinuation,
  claimA2AContinuationDelivery,
  claimDueA2AContinuations,
  failA2AContinuationsForIntegrationTask,
  failA2AContinuation,
  finalizeA2ATerminalHistory,
  getA2AContinuation,
  getA2AContinuationTaskOutcome,
  hasOnlyLegacyFailedA2AContinuationsForIntegrationTask,
  hasPendingConfirmedA2ADeliveryForIntegrationTask,
  listRecoverableA2AIntegrationTasks,
  recoverDueA2AContinuationIds,
  recordA2ATerminalDeliveryReceipt,
  retainA2AUnconfirmedDeliveryClaim,
  rescheduleA2AContinuation,
  saveA2AVerifiedArtifactCheckpoint,
  type A2AContinuation,
  type A2ATerminalDeliveryKind,
  type A2ATerminalHistoryPayload,
  type RecoverableA2AIntegrationTask,
} from "./a2a-continuations-store.js";
import {
  completeIntegrationCampaignTaskAfterA2A,
  failDisabledIntegrationCampaignTask,
  failIntegrationCampaignTaskDeliveryContainment,
  getIntegrationCampaignForTask,
} from "./integration-campaigns-store.js";
import {
  dispatchPendingIntegrationTask,
  isIntegrationDurableDispatchEnabledForTask,
} from "./integration-durable-dispatch.js";
import { signInternalToken } from "./internal-token.js";
import {
  getNextPendingTaskForThread,
  getPendingTask,
} from "./pending-tasks-store.js";
import { getThreadMapping } from "./thread-mapping-store.js";
import type {
  OutgoingMessage,
  PlatformAdapter,
  PlatformDeliveryReceipt,
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

function logA2AContinuationTransition(
  event: string,
  continuation: Pick<
    A2AContinuation,
    "id" | "integrationTaskId" | "a2aTaskId" | "attempts" | "status"
  >,
): void {
  console.info("[integrations] a2a-continuation-transition", {
    event,
    continuationId: continuation.id,
    integrationTaskId: continuation.integrationTaskId,
    downstreamTaskId: continuation.a2aTaskId,
    attempt: continuation.attempts,
    status: continuation.status,
  });
}

export async function dispatchA2AContinuation(
  continuationId: string,
  webhookBaseUrl?: string,
): Promise<void> {
  // Self-dispatch: this POST has to land on the deployment that enqueued the
  // continuation. It used to carry its own chain, which omitted
  // DEPLOY_PRIME_URL — so a deploy preview dispatched to production — and
  // silently fell back to localhost in production, where the request simply
  // never arrives and the continuation is dropped with no error.
  // `WEBHOOK_BASE_URL` stays ahead of it: this runs from a retry job with no
  // inbound request, and a dev tunnel is reachable where the app's own address
  // is not.
  const baseUrl =
    webhookBaseUrl ||
    process.env.WEBHOOK_BASE_URL ||
    resolveSelfDispatchBaseUrl();

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

export async function recoverA2AContinuationAfterProcessorFailure(
  continuationId: string,
  options: {
    adapters: Map<string, PlatformAdapter>;
    reason: string;
  },
): Promise<void> {
  const continuation = await getA2AContinuation(continuationId);
  if (
    !continuation ||
    continuation.status === "completed" ||
    continuation.status === "failed"
  ) {
    return;
  }
  if (
    continuation.terminalDeliveryConfirmedAt != null &&
    continuation.terminalHistoryPayload
  ) {
    await persistAndFinalizeConfirmedA2ADelivery(continuation);
    return;
  }
  const adapter = options.adapters.get(continuation.platform);
  if (continuation.attempts < MAX_ATTEMPTS) {
    logA2AContinuationTransition("processor_released", continuation);
    await rescheduleAndRedispatchA2AContinuation(continuation.id);
    return;
  }
  if (!adapter) {
    const reason = `Unknown platform: ${continuation.platform}`;
    logA2AContinuationTransition(
      "processor_exhausted_without_adapter",
      continuation,
    );
    await failA2AContinuationsForIntegrationTask(
      continuation.integrationTaskId,
      reason,
    );
    if (
      await hasPendingConfirmedA2ADeliveryForIntegrationTask(
        continuation.integrationTaskId,
      )
    ) {
      await dispatchPendingIntegrationTask({
        taskId: continuation.integrationTaskId,
        task: {
          platform: continuation.platform,
          externalThreadId: continuation.externalThreadId,
          platformContext: continuation.incoming.platformContext,
        },
        campaignContinuation: true,
        allowPortableConfirmedReceiptReconciliation: true,
      }).catch((err) => {
        console.error(
          `[integrations] Failed to wake confirmed sibling history for ${continuation.integrationTaskId}:`,
          err,
        );
      });
      return;
    }
    await failIntegrationCampaignTaskDeliveryContainment(
      continuation.integrationTaskId,
      reason,
    );
    return;
  }

  const progress = await resumeA2AContinuationProgress(continuation, adapter);
  if (continuation.verifiedArtifactCheckpoint) {
    logA2AContinuationTransition(
      "processor_exhausted_checkpoint_delivery",
      continuation,
    );
    await deliverAndCompleteA2AContinuation(
      continuation,
      adapter,
      formatRecoverableArtifactFallbackText(
        continuation.verifiedArtifactCheckpoint,
      ),
      progress,
    );
    return;
  }
  logA2AContinuationTransition(
    "processor_exhausted_failure_notice",
    continuation,
  );
  await notifyAndFailA2AContinuation(
    continuation,
    adapter,
    options.reason,
    progress,
  );
}

export async function processDueA2AContinuations(options: {
  adapters: Map<string, PlatformAdapter>;
  limit?: number;
}): Promise<void> {
  const continuations = await claimDueA2AContinuations(options.limit ?? 5);
  for (const continuation of continuations) {
    await processClaimedContinuation(continuation, options).catch(
      async (err) => {
        console.error(
          `[integrations] A2A continuation ${continuation.id} failed; durable recovery requested`,
        );
        try {
          await recoverA2AContinuationAfterProcessorFailure(continuation.id, {
            adapters: options.adapters,
            reason:
              err instanceof Error
                ? err.message.slice(0, 500)
                : "continuation processing failed",
          });
        } catch (recoveryError) {
          console.error(
            `[integrations] A2A continuation ${continuation.id} recovery failed; later continuations will continue`,
            recoveryError instanceof Error
              ? recoveryError.name
              : "recovery_error",
          );
        }
      },
    );
  }
}

/**
 * Durable scheduler wake-up only: make a bounded set of due/stale rows
 * eligible, then invoke their normal processors. It never polls remote A2A
 * tasks or runs a mutation itself, keeping the scheduled route within its
 * short execution budget. Duplicate wake-ups are safe because each processor
 * still takes the store's atomic claim before it can progress or deliver.
 */
export async function recoverDueA2AContinuations(options?: {
  limit?: number;
  webhookBaseUrl?: string;
}): Promise<{ dispatched: number; failed: number }> {
  const limit = options?.limit ?? 5;
  const candidateTasks = await listRecoverableA2AIntegrationTasks(200);
  const eligibleTaskIds: string[] = [];
  const confirmedHistoryTaskIds: string[] = [];
  for (const task of candidateTasks) {
    const enabled = isIntegrationDurableDispatchEnabledForTask({
      platform: task.platform,
      externalThreadId: task.externalThreadId,
      platformContext: task.dispatchScope
        ? { channelId: task.dispatchScope }
        : undefined,
    });
    if (enabled) {
      eligibleTaskIds.push(task.id);
    } else if (task.hasPendingConfirmedDelivery) {
      confirmedHistoryTaskIds.push(task.id);
    } else {
      await failDisabledDurableA2ATask(task);
    }
    if (eligibleTaskIds.length + confirmedHistoryTaskIds.length >= limit) break;
  }
  const ids = await recoverDueA2AContinuationIds(limit, eligibleTaskIds);
  const remaining = Math.max(0, limit - ids.length);
  const confirmedHistoryIds =
    remaining > 0 && confirmedHistoryTaskIds.length > 0
      ? await recoverDueA2AContinuationIds(
          remaining,
          confirmedHistoryTaskIds,
          true,
        )
      : [];
  ids.push(...confirmedHistoryIds);
  let dispatched = 0;
  let failed = 0;

  await Promise.all(
    ids.map(async (id) => {
      try {
        await dispatchA2AContinuation(id, options?.webhookBaseUrl);
        dispatched += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[integrations] Failed to recover A2A continuation ${id}:`,
          err,
        );
      }
    }),
  );

  return { dispatched, failed };
}

async function processClaimedContinuation(
  continuation: A2AContinuation,
  options: { adapters: Map<string, PlatformAdapter> },
): Promise<void> {
  if (
    continuation.terminalDeliveryConfirmedAt != null &&
    continuation.terminalHistoryPayload
  ) {
    await persistAndFinalizeConfirmedA2ADelivery(continuation);
    return;
  }
  if (!(await durableContinuationScopeStillEnabled(continuation))) return;
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
  const recoverableArtifactSecrets =
    await resolveContinuationArtifactSecrets(continuation);
  let task: Task | null = null;
  let latestRecoverableArtifactText = continuation.verifiedArtifactCheckpoint;

  try {
    while (Date.now() < deadline) {
      task = await client.getTask(continuation.a2aTaskId);
      const recoverableArtifactText = extractVerifiedRecoverableArtifactText(
        task,
        continuation.agentUrl,
        recoverableArtifactSecrets,
      );
      if (recoverableArtifactText) {
        latestRecoverableArtifactText = await saveA2AVerifiedArtifactCheckpoint(
          continuation.id,
          recoverableArtifactText,
        );
        if (latestRecoverableArtifactText) {
          logA2AContinuationTransition("checkpoint_persisted", continuation);
        }
      }
      if (TERMINAL_STATES.has(task.status.state)) break;
      await reportA2AContinuationProgress(continuation, progress, task);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (err) {
    if (isTransientA2APollError(err)) {
      if (shouldStopPollingRemoteTask(continuation)) {
        if (latestRecoverableArtifactText) {
          await deliverAndCompleteA2AContinuation(
            continuation,
            adapter,
            formatRecoverableArtifactFallbackText(
              latestRecoverableArtifactText,
            ),
            progress,
          );
          return;
        }
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
      if (latestRecoverableArtifactText) {
        await deliverAndCompleteA2AContinuation(
          continuation,
          adapter,
          formatRecoverableArtifactFallbackText(latestRecoverableArtifactText),
          progress,
        );
        return;
      }
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
      if (latestRecoverableArtifactText) {
        await deliverAndCompleteA2AContinuation(
          continuation,
          adapter,
          formatRecoverableArtifactFallbackText(latestRecoverableArtifactText),
          progress,
        );
        return;
      }
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
    if (latestRecoverableArtifactText) {
      await deliverAndCompleteA2AContinuation(
        continuation,
        adapter,
        formatRecoverableArtifactFallbackText(latestRecoverableArtifactText),
        progress,
      );
      return;
    }
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
    if (latestRecoverableArtifactText) {
      await deliverAndCompleteA2AContinuation(
        continuation,
        adapter,
        formatRecoverableArtifactFallbackText(latestRecoverableArtifactText),
        progress,
      );
      return;
    }
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

async function durableContinuationScopeStillEnabled(
  continuation: A2AContinuation,
): Promise<boolean> {
  const campaign = await getIntegrationCampaignForTask(
    continuation.integrationTaskId,
  );
  if (!campaign) return true;
  if (campaign.status === "completed" || campaign.status === "failed") {
    await failA2AContinuation(
      continuation.id,
      "Owning integration campaign is already terminal",
    );
    return false;
  }
  const task = await getPendingTask(continuation.integrationTaskId);
  const enabled =
    task?.status === "processing" &&
    isIntegrationDurableDispatchEnabledForTask({
      platform: task.platform,
      externalThreadId: task.externalThreadId,
      platformContext: task.dispatchScope
        ? { channelId: task.dispatchScope }
        : undefined,
    });
  if (enabled) return true;

  if (
    await hasPendingConfirmedA2ADeliveryForIntegrationTask(
      continuation.integrationTaskId,
    )
  ) {
    await failA2AContinuation(
      continuation.id,
      "Durable integration campaign was disabled before this continuation delivered",
    );
    await reconcileTerminalA2AParentIfDisabled(continuation.integrationTaskId);
    return false;
  }

  await failDisabledDurableA2ATask({
    id: continuation.integrationTaskId,
    platform: task?.platform ?? continuation.platform,
    externalThreadId: task?.externalThreadId ?? continuation.externalThreadId,
    dispatchScope: task?.dispatchScope ?? null,
    status: task?.status ?? "missing",
  });
  return false;
}

async function failDisabledDurableA2ATask(
  task: Pick<
    RecoverableA2AIntegrationTask,
    "id" | "platform" | "externalThreadId" | "dispatchScope" | "status"
  >,
): Promise<void> {
  const message = "Durable integration campaign was disabled for this scope";
  await failA2AContinuationsForIntegrationTask(task.id, message);
  await failDisabledIntegrationCampaignTask(task.id, message);
  const nextTask = await getNextPendingTaskForThread(
    task.platform,
    task.externalThreadId,
  );
  if (nextTask) {
    await dispatchPendingIntegrationTask({
      taskId: nextTask.id,
      task: {
        platform: task.platform,
        externalThreadId: task.externalThreadId,
        platformContext: nextTask.dispatchScope
          ? { channelId: nextTask.dispatchScope }
          : undefined,
      },
    });
  }
}

export async function reconcileTerminalA2AParentIfDisabled(
  integrationTaskId: string,
): Promise<boolean> {
  if (
    (await getA2AContinuationTaskOutcome(integrationTaskId)) !==
    "terminal-without-delivery"
  ) {
    return false;
  }
  if (
    await hasOnlyLegacyFailedA2AContinuationsForIntegrationTask(
      integrationTaskId,
    )
  ) {
    await failIntegrationCampaignTaskDeliveryContainment(
      integrationTaskId,
      "Legacy A2A continuation ended without durable delivery proof",
    );
    return true;
  }
  const task = await getPendingTask(integrationTaskId);
  if (
    !task ||
    isIntegrationDurableDispatchEnabledForTask({
      platform: task.platform,
      externalThreadId: task.externalThreadId,
      platformContext: task.dispatchScope
        ? { channelId: task.dispatchScope }
        : undefined,
    })
  ) {
    return false;
  }
  await failDisabledDurableA2ATask({
    id: task.id,
    platform: task.platform,
    externalThreadId: task.externalThreadId,
    dispatchScope: task.dispatchScope,
    status: task.status,
  });
  return true;
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
  if (!(await durableContinuationScopeStillEnabled(continuation))) return;
  const deliveryContinuation = await claimA2AContinuationDelivery(
    continuation.id,
  );
  if (!deliveryContinuation) return;
  logA2AContinuationTransition(
    "failure_delivery_claimed",
    deliveryContinuation,
  );

  const message = formatContinuationFailureMessage(
    deliveryContinuation,
    reason,
  );
  let outgoing: OutgoingMessage;
  let deliveryReceipt: PlatformDeliveryReceipt;
  try {
    outgoing = adapter.formatAgentResponse(message);
    deliveryReceipt = await withTimeout(
      (signal) =>
        deliverA2AContinuationResponse(
          adapter,
          deliveryContinuation,
          outgoing,
          progress,
          "error",
          signal,
        ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${deliveryContinuation.platform} failure notification timed out`,
    );
  } catch (err) {
    console.error(
      `[integrations] Failed to notify ${deliveryContinuation.platform} about failed A2A continuation ${deliveryContinuation.id}:`,
      err,
    );
    await rescheduleAndRedispatchA2AContinuation(deliveryContinuation.id);
    return;
  }

  const confirmed = await recordTerminalA2ADelivery(
    deliveryContinuation,
    "failure",
    outgoing,
    deliveryReceipt,
    [],
    reason,
  );
  if (!confirmed) return;
  await persistAndFinalizeConfirmedA2ADelivery(confirmed);
}

async function deliverAndCompleteA2AContinuation(
  continuation: A2AContinuation,
  adapter: PlatformAdapter,
  text: string,
  progress: PlatformRunProgress | null = null,
): Promise<void> {
  if (!(await durableContinuationScopeStillEnabled(continuation))) return;
  const deliveryContinuation = await claimA2AContinuationDelivery(
    continuation.id,
  );
  if (!deliveryContinuation) return;
  logA2AContinuationTransition(
    "response_delivery_claimed",
    deliveryContinuation,
  );

  let outgoing: OutgoingMessage;
  let deliveryReceipt: PlatformDeliveryReceipt;
  const artifactSecrets =
    await resolveContinuationArtifactSecrets(deliveryContinuation);
  const artifacts = extractA2AArtifactIdentities(
    [{ tool: "call-agent", result: text }],
    { persistedArtifactSecrets: artifactSecrets },
  );
  try {
    outgoing = adapter.formatAgentResponse(
      stripA2APersistedArtifactMarkers(text),
    );
    deliveryReceipt = await withTimeout(
      (signal) =>
        deliverA2AContinuationResponse(
          adapter,
          deliveryContinuation,
          outgoing,
          progress,
          "done",
          signal,
        ),
      PLATFORM_SEND_TIMEOUT_MS,
      `${deliveryContinuation.platform} response delivery timed out`,
    );
    const confirmed = await recordTerminalA2ADelivery(
      deliveryContinuation,
      "success",
      outgoing,
      deliveryReceipt,
      artifacts,
    );
    if (!confirmed) return;
    await persistAndFinalizeConfirmedA2ADelivery(confirmed);
  } catch {
    await rescheduleAndRedispatchA2AContinuation(deliveryContinuation.id);
    return;
  }
}

async function deliverA2AContinuationResponse(
  adapter: PlatformAdapter,
  continuation: A2AContinuation,
  message: OutgoingMessage,
  progress: PlatformRunProgress | null,
  status: "done" | "error",
  signal: AbortSignal,
): Promise<PlatformDeliveryReceipt> {
  if (progress) {
    try {
      await progress.onEvent(
        {
          type: "agent_call",
          agent: continuation.agentName,
          status,
        },
        { signal },
      );
      throwIfAborted(signal);
      const receipt = await progress.complete(message, { signal });
      if (receipt?.status === "delivered") return receipt;
      throw new Error("Continuation progress completed without delivery proof");
    } catch {
      throwIfAborted(signal);
      // A resumed Slack stream can no longer be finalized (for example when
      // chat.stopStream rejects). Preserve the final answer with the same
      // thread reply fallback used by the initial webhook run. Also ask the
      // adapter to terminate the native stream: otherwise Slack can keep the
      // task card in its working state after the thread fallback succeeds.
      try {
        await progress.fail?.(
          "I couldn't update the live response, but I posted the final result in this thread.",
          { signal },
        );
      } catch {
        // The thread reply below is still the authoritative final answer.
      }
      logA2AContinuationTransition("native_progress_fallback", continuation);
    }
  }
  throwIfAborted(signal);
  const receipt = await adapter.sendResponse(message, continuation.incoming, {
    idempotencyKey: `a2a-continuation:${continuation.id}`,
    reconcileAfter: continuation.createdAt,
    signal,
    placeholderRef:
      progress?.responseTargetRef ?? continuation.placeholderRef ?? undefined,
    strictTargetRef: true,
  });
  if (receipt?.status !== "delivered") {
    throw new Error("Continuation response completed without delivery proof");
  }
  return receipt;
}

async function persistA2AContinuationDelivery(
  continuation: A2AContinuation,
  history: A2ATerminalHistoryPayload,
): Promise<void> {
  const mapping = await getThreadMapping(
    continuation.platform,
    continuation.externalThreadId,
  );
  if (!mapping) {
    throw new Error("Integration thread mapping is not available");
  }
  const thread = await getThread(mapping.internalThreadId);
  if (!thread) {
    throw new Error("Integration chat thread is not available");
  }

  let repo: any;
  try {
    repo = JSON.parse(thread.threadData || "{}");
  } catch {
    repo = {};
  }
  if (!Array.isArray(repo.messages)) repo.messages = [];

  const metadata: Record<string, unknown> = {
    integrationDeliveryAttempted: true,
    integrationDelivery: {
      platform: continuation.platform,
      status: "delivered",
      text: history.text,
      deliveredAt: history.deliveredAt,
      ...(history.messageRefs.length
        ? { messageRefs: history.messageRefs }
        : {}),
    },
  };
  if (history.artifacts.length > 0) {
    metadata.integrationArtifacts = history.artifacts;
  }

  const messageId = `msg-${continuation.id}-assistant-continuation`;
  if (!repo.messages.some((message: any) => message?.id === messageId)) {
    repo.messages.push({
      id: messageId,
      role: "assistant",
      content: [{ type: "text", text: history.text }],
      createdAt: history.deliveredAt,
      metadata,
    });
  }
  const meta = extractThreadMeta(repo);
  await updateThreadData(
    mapping.internalThreadId,
    JSON.stringify(repo),
    meta.title || thread.title || "Integration Chat",
    meta.preview || thread.preview || "",
    repo.messages.length,
  );
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

async function recordTerminalA2ADelivery(
  continuation: A2AContinuation,
  kind: A2ATerminalDeliveryKind,
  outgoing: OutgoingMessage,
  receipt: PlatformDeliveryReceipt,
  artifacts: A2AArtifactIdentity[],
  errorMessage?: string,
): Promise<A2AContinuation | null> {
  const historyPayload: A2ATerminalHistoryPayload = {
    text: outgoing.text,
    deliveredAt: new Date().toISOString(),
    messageRefs: receipt.messageRefs ?? [],
    artifacts,
  };
  for (let attempt = 0; attempt < COMPLETE_AFTER_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const confirmed = await recordA2ATerminalDeliveryReceipt(
        continuation.id,
        kind,
        historyPayload,
        errorMessage,
      );
      logA2AContinuationTransition(
        kind === "success"
          ? "response_delivery_confirmed"
          : "failure_delivery_confirmed",
        continuation,
      );
      return confirmed;
    } catch {}
  }

  console.error(
    `[integrations] ${continuation.platform} accepted terminal A2A delivery for ${continuation.id}, ` +
      `but recording its receipt failed after ${COMPLETE_AFTER_DELIVERY_ATTEMPTS} attempts. Leaving it in delivering for stale recovery.`,
  );
  try {
    await retainA2AUnconfirmedDeliveryClaim(continuation.id);
  } catch (err) {
    console.error(
      `[integrations] Failed to retain unconfirmed A2A delivery claim ${continuation.id}:`,
      err instanceof Error ? err.name : "receipt_recovery_error",
    );
  }
  return null;
}

async function persistAndFinalizeConfirmedA2ADelivery(
  continuation: A2AContinuation,
): Promise<void> {
  const history = continuation.terminalHistoryPayload;
  if (!history || continuation.terminalDeliveryConfirmedAt == null) {
    throw new Error("Confirmed A2A delivery is missing durable history");
  }
  let lastError: unknown;
  let historyFinalized = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (!historyFinalized) {
        await persistA2AContinuationDelivery(continuation, history);
        await finalizeA2ATerminalHistory(continuation.id);
        historyFinalized = true;
        logA2AContinuationTransition(
          "terminal_history_persisted",
          continuation,
        );
      }
      await completeParentCampaignAfterTerminalA2A({
        ...continuation,
        status:
          continuation.terminalDeliveryKind === "success"
            ? "completed"
            : "failed",
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.error(
    historyFinalized
      ? `[integrations] A2A continuation ${continuation.id} finalized history but parent completion remains retryable:`
      : `[integrations] A2A continuation ${continuation.id} has a provider receipt but its history remains retryable:`,
    lastError instanceof Error ? lastError.name : "persistence_error",
  );
  if (historyFinalized) {
    await dispatchPendingIntegrationTask({
      taskId: continuation.integrationTaskId,
      task: {
        platform: continuation.platform,
        externalThreadId: continuation.externalThreadId,
        platformContext: continuation.incoming.platformContext,
      },
      campaignContinuation: true,
      allowPortableConfirmedReceiptReconciliation: true,
    }).catch((err) => {
      console.error(
        `[integrations] Failed to wake A2A parent ${continuation.integrationTaskId} after terminal history finalization:`,
        err,
      );
    });
    return;
  }
  await rescheduleAndRedispatchA2AContinuation(continuation.id);
}

async function completeParentCampaignAfterTerminalA2A(
  continuation: A2AContinuation,
): Promise<void> {
  const campaign = await getIntegrationCampaignForTask(
    continuation.integrationTaskId,
  );
  if (!campaign) return;
  const outcome = await getA2AContinuationTaskOutcome(
    continuation.integrationTaskId,
  );
  if (outcome !== "terminal-delivered") {
    if (outcome === "terminal-without-delivery") {
      if (
        await reconcileTerminalA2AParentIfDisabled(
          continuation.integrationTaskId,
        )
      ) {
        return;
      }
    }
    if (outcome !== "active") {
      console.warn(
        `[integrations] Refusing to complete A2A parent ${continuation.integrationTaskId} with outcome ${outcome}`,
      );
    }
    return;
  }
  const completed = await completeIntegrationCampaignTaskAfterA2A(
    continuation.integrationTaskId,
  );
  if (!completed) return;
  logA2AContinuationTransition("parent_completed", continuation);

  const nextTask = await getNextPendingTaskForThread(
    continuation.platform,
    continuation.externalThreadId,
  );
  if (!nextTask) return;
  await dispatchPendingIntegrationTask({
    taskId: nextTask.id,
    task: {
      platform: continuation.platform,
      externalThreadId: continuation.externalThreadId,
      platformContext: nextTask.dispatchScope
        ? { channelId: nextTask.dispatchScope }
        : undefined,
    },
  }).catch((err) => {
    console.error(
      `[integrations] Failed to wake successor ${nextTask.id} after A2A parent completion:`,
      err,
    );
  });
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
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(message));
    }, timeoutMs);
    const result = await operation(controller.signal);
    if (timedOut) throw new Error(message);
    return result;
  } catch (error) {
    if (timedOut) throw new Error(message);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Platform delivery was aborted");
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

async function resolveContinuationArtifactSecrets(
  continuation: A2AContinuation,
): Promise<string[]> {
  const secrets: string[] = [];
  const add = (secret: string | null | undefined) => {
    const value = secret?.trim();
    if (value && !secrets.includes(value)) secrets.push(value);
  };
  add(process.env.A2A_SECRET);
  if (continuation.orgId) {
    try {
      const { getOrgA2ASecret } = await import("../org/context.js");
      add(await getOrgA2ASecret(continuation.orgId));
    } catch {}
  }
  return secrets;
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

function extractVerifiedRecoverableArtifactText(
  task: Task,
  agentUrl: string,
  artifactSecrets: readonly string[],
): string | null {
  if (task.status.message?.metadata?.agentNativeRecoverableArtifacts !== true) {
    return null;
  }

  const text = formatContinuationArtifactText(extractTaskText(task), agentUrl);
  if (!text.trim()) return null;

  // Require the signed identity ledger so arbitrary peer progress prose cannot
  // prematurely complete the continuation.
  const artifacts = extractA2AArtifactIdentities(
    [{ tool: "call-agent", result: text }],
    {
      persistedArtifactSecrets: artifactSecrets,
    },
  );
  return artifacts.length > 0 ? text : null;
}

function formatRecoverableArtifactFallbackText(text: string): string {
  return text.replace(
    "The agent is still working on the full response, but these verified artifacts already exist:",
    "The downstream agent did not finish its full response, but these verified artifacts already exist:",
  );
}

function formatContinuationArtifactText(
  text: string,
  agentUrl: string,
): string {
  const expandedText = expandRelativeUrls(text, agentUrl);
  return appendA2AArtifactLinks(
    expandedText,
    [{ tool: "call-agent", result: expandedText }],
    { baseUrl: resolveArtifactBaseUrl(undefined) },
  );
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
