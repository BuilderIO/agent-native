import { hasConfiguredA2ASecret } from "../a2a/auth-policy.js";
import {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_INTEGRATION,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveDurableBackgroundDispatchPath,
} from "../agent/durable-background.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import {
  INTEGRATION_DURABLE_DISPATCH_ENV,
  INTEGRATION_DURABLE_DISPATCH_SCOPES_ENV,
  INTEGRATION_PROCESS_TASK_PATH,
  INTEGRATION_RETRY_SWEEP_PATH,
  INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT,
  isIntegrationDurableDispatchConfigured,
} from "./integration-durable-dispatch-config.js";
import { recordPendingTaskDispatchAttempt } from "./pending-tasks-store.js";

export {
  INTEGRATION_DURABLE_DISPATCH_ENV,
  INTEGRATION_DURABLE_DISPATCH_SCOPES_ENV,
  INTEGRATION_PROCESS_TASK_PATH,
  INTEGRATION_RETRY_SWEEP_PATH,
  INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT,
  isIntegrationDurableDispatchConfigured,
};

export type IntegrationDispatchOutcome =
  | "background-acknowledged"
  | "portable-unconfirmed"
  | "failed";

export interface IntegrationDispatchTaskScope {
  platform: string;
  externalThreadId: string;
  platformContext?: Record<string, unknown>;
}

export interface IntegrationDurableDispatchScope {
  platform: string;
  value: string;
}

export function integrationDispatchScopeValue(
  task: IntegrationDispatchTaskScope,
): string | null {
  const value = task.platformContext?.channelId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function configuredIntegrationDurableDispatchScopes():
  | IntegrationDurableDispatchScope[]
  | null {
  const raw = process.env.AGENT_INTEGRATION_DURABLE_DISPATCH_SCOPES;
  if (!raw?.trim()) return null;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((scope) => {
      const separator = scope.indexOf(":");
      return {
        platform: separator > 0 ? scope.slice(0, separator) : "",
        value: separator > 0 ? scope.slice(separator + 1) : "",
      };
    })
    .filter((scope) => scope.platform && scope.value);
}

function taskScopeCandidates(task: IntegrationDispatchTaskScope): string[] {
  const candidates = [
    `${task.platform}:*`,
    `${task.platform}:${task.externalThreadId}`,
  ];
  const explicitScope = integrationDispatchScopeValue(task);
  if (explicitScope) {
    candidates.push(`${task.platform}:${explicitScope}`);
  } else if (task.platform === "slack") {
    const channelId = task.externalThreadId.split(":")[2];
    if (channelId) candidates.push(`slack:${channelId}`);
  }
  return candidates;
}

export function isIntegrationDurableDispatchEnabledForTask(
  task: IntegrationDispatchTaskScope,
): boolean {
  if (!isIntegrationDurableDispatchConfigured()) return false;
  const scopes = configuredIntegrationDurableDispatchScopes();
  if (
    scopes &&
    !taskScopeCandidates(task).some((candidate) =>
      scopes.some((scope) => `${scope.platform}:${scope.value}` === candidate),
    )
  ) {
    return false;
  }
  const path = resolveDurableBackgroundDispatchPath(
    INTEGRATION_PROCESS_TASK_PATH,
  );
  return (
    dispatchPathTargetsNetlifyBackgroundFunction(path) &&
    hasConfiguredA2ASecret()
  );
}

async function recordDispatch(
  taskId: string,
  outcome: IntegrationDispatchOutcome,
): Promise<void> {
  try {
    await recordPendingTaskDispatchAttempt(taskId, outcome);
  } catch (error) {
    console.error(
      `[integrations] Failed to record dispatch outcome for ${taskId}:`,
      error,
    );
  }
}

function logDispatch(
  taskId: string,
  outcome: IntegrationDispatchOutcome,
  startedAt: number,
): void {
  console.info("[integrations] pending task dispatch", {
    taskId,
    outcome,
    durationMs: Date.now() - startedAt,
  });
}

export async function dispatchPendingIntegrationTask(input: {
  taskId: string;
  task: IntegrationDispatchTaskScope;
  event?: unknown;
  baseUrl?: string;
  portableSettleMs?: number;
}): Promise<IntegrationDispatchOutcome> {
  const startedAt = Date.now();
  const durable = isIntegrationDurableDispatchEnabledForTask(input.task);
  if (durable) {
    const backgroundPath = resolveDurableBackgroundDispatchPath(
      INTEGRATION_PROCESS_TASK_PATH,
    );
    try {
      await fireInternalDispatch({
        event: input.event,
        baseUrl: input.baseUrl,
        path: backgroundPath,
        taskId: input.taskId,
        body: {
          [AGENT_BACKGROUND_PROCESSOR_FIELD]:
            AGENT_BACKGROUND_PROCESSOR_INTEGRATION,
        },
        awaitResponse: true,
        responseTimeoutMs: 2_000,
      });
      await recordDispatch(input.taskId, "background-acknowledged");
      logDispatch(input.taskId, "background-acknowledged", startedAt);
      return "background-acknowledged";
    } catch (error) {
      console.error(
        `[integrations] Background dispatch failed for ${input.taskId}; trying the portable processor:`,
        error,
      );
    }
  }

  try {
    await fireInternalDispatch({
      event: input.event,
      baseUrl: input.baseUrl,
      path: INTEGRATION_PROCESS_TASK_PATH,
      taskId: input.taskId,
      settleMs: input.portableSettleMs,
    });
    await recordDispatch(input.taskId, "portable-unconfirmed");
    logDispatch(input.taskId, "portable-unconfirmed", startedAt);
    return "portable-unconfirmed";
  } catch (error) {
    console.error(
      `[integrations] Portable dispatch failed for ${input.taskId}:`,
      error,
    );
    await recordDispatch(input.taskId, "failed");
    logDispatch(input.taskId, "failed", startedAt);
    return "failed";
  }
}
