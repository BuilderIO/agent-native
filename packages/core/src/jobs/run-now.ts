import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import { resolveAutomationAccess } from "../automations/access.js";
import type { AutomationScope } from "../automations/service.js";
import { isLocalDatabase } from "../db/client.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
} from "../resources/store.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { parseJobResource } from "./frontmatter.js";
import {
  listUnclaimedAutomationRuns,
  startAutomationRun,
} from "./run-history.js";

export interface RunAutomationNowInput {
  userEmail: string;
  orgId?: string | null;
  resourceId?: string;
  scope?: AutomationScope;
  name?: string;
}

export interface QueuedAutomationRun {
  queued: true;
  runId: string;
  automationRunId: string;
}

async function dispatchAutomationRun(historyId: string): Promise<void> {
  const dispatchPath = resolveAgentChatProcessRunDispatchPath();
  await fireInternalDispatch({
    path: dispatchPath,
    taskId: historyId,
    body: {
      [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
        runId: historyId,
        automationRunId: historyId,
      },
    },
    ...(dispatchPathTargetsNetlifyBackgroundFunction(dispatchPath)
      ? { awaitResponse: true, responseTimeoutMs: 5_000 }
      : !isLocalDatabase()
        ? { awaitResponse: true, responseTimeoutMs: 5_000 }
        : {}),
  });
}

function ownerForScope(input: RunAutomationNowInput): string {
  if (input.scope === "personal") return input.userEmail.trim().toLowerCase();
  if (input.scope !== "organization") {
    throw Object.assign(
      new Error("Automation resource id or name and scope is required."),
      { statusCode: 400 },
    );
  }
  if (!input.orgId) {
    throw Object.assign(
      new Error("An organization is required for organization automations."),
      { statusCode: 400 },
    );
  }
  return organizationResourceOwner(input.orgId);
}

async function resolveRunAutomation(input: RunAutomationNowInput) {
  if (input.resourceId?.trim()) {
    return resolveAutomationAccess(
      { userEmail: input.userEmail },
      input.resourceId.trim(),
    );
  }

  const name = input.name?.trim() ?? "";
  if (!name || name.includes("/") || name.endsWith(".md")) {
    throw Object.assign(new Error("A valid automation name is required."), {
      statusCode: 400,
    });
  }
  const resource = await resourceGetByPath(
    ownerForScope(input),
    `jobs/${name}.md`,
  );
  if (!resource) return null;
  return resolveAutomationAccess({ userEmail: input.userEmail }, resource.id);
}

export async function queueAutomationRunNow(
  input: RunAutomationNowInput,
): Promise<QueuedAutomationRun> {
  const access = await resolveRunAutomation(input);
  if (!access) {
    throw Object.assign(new Error("Automation not found."), {
      statusCode: 404,
    });
  }
  if (!access.capabilities.canOperate) {
    throw Object.assign(
      new Error("Collaborate access is required to run this automation."),
      { statusCode: 403 },
    );
  }
  const { resource, name } = access;
  const { body } = parseJobResource(resource.content);
  if (!body.trim()) {
    throw Object.assign(
      new Error(`Automation "${name}" has no instructions.`),
      {
        statusCode: 400,
      },
    );
  }

  // A manual-run request is a guaranteed app request even on hosts without a
  // durable timer. Use it to recover older rows before adding the new one.
  await redispatchUnclaimedAutomationRuns().catch((error) => {
    console.warn(
      "[automations] Could not sweep queued runs before run-now:",
      error,
    );
  });

  const historyId = await startAutomationRun({
    owner: resource.owner,
    automation: name,
    path: resource.path,
    scope: access.owningOrganizationId ? "organization" : "personal",
    orgId: access.owningOrganizationId,
    dispatchPending: true,
  });
  try {
    await dispatchAutomationRun(historyId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Background dispatch failed";
    console.warn(
      `[automations] Initial run-now dispatch failed; leaving ${historyId} queued for redelivery:`,
      message,
    );
    throw error;
  }

  return { queued: true, runId: historyId, automationRunId: historyId };
}

/**
 * Recover manual rows whose first serverless handoff never reached a worker.
 * This is intentionally a redelivery, not a second execution: the worker's
 * claim CAS decides which request owns the run.
 */
export async function redispatchUnclaimedAutomationRuns(): Promise<number> {
  const runs = await listUnclaimedAutomationRuns();
  let attempted = 0;
  for (const run of runs) {
    try {
      await dispatchAutomationRun(run.id);
      attempted += 1;
    } catch (error) {
      console.error(
        `[automations] Could not redeliver queued run ${run.id}:`,
        error,
      );
    }
  }
  return attempted;
}
