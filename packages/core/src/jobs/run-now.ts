import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import {
  canUpdateAutomationResource,
  type AutomationScope,
} from "../automations/service.js";
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
  appId?: string | null;
  scope: AutomationScope;
  /** Inbound request headers used to dispatch back to this exact local host. */
  requestHeaders?: Headers;
  /** Flat automation name, resolved as `jobs/<name>.md`. */
  name?: string;
  /**
   * Full resource path for an automation the caller already resolved. Required
   * for automations nested under `jobs/` (e.g. per-factory jobs), whose names
   * contain a slash and cannot round-trip through `name`.
   */
  path?: string;
}

export interface QueuedAutomationRun {
  queued: true;
  runId: string;
  automationRunId: string;
}

async function dispatchAutomationRun(
  historyId: string,
  requestHeaders?: Headers,
): Promise<void> {
  const dispatchPath = resolveAgentChatProcessRunDispatchPath();
  await fireInternalDispatch({
    path: dispatchPath,
    taskId: historyId,
    ...(requestHeaders ? { event: { headers: requestHeaders } } : {}),
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

function automationName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function ownerForScope(input: RunAutomationNowInput): string {
  if (input.scope === "personal") return input.userEmail.trim().toLowerCase();
  if (!input.orgId) {
    throw Object.assign(
      new Error("An organization is required for organization automations."),
      { statusCode: 400 },
    );
  }
  return organizationResourceOwner(input.orgId);
}

/**
 * One place decides which resource a run-now request means. Callers that
 * already hold the resource pass `path`; callers that only know a flat slug
 * pass `name`. Accepting both at once would let two disagreeing identifiers
 * silently pick a winner.
 */
function resolveAutomationTarget(input: RunAutomationNowInput): {
  path: string;
  name: string;
} {
  const path = input.path?.trim();
  const name = input.name?.trim();
  if (path && name) {
    throw Object.assign(
      new Error("Specify either an automation name or a path, not both."),
      { statusCode: 400 },
    );
  }
  if (path) {
    const segments = path.split("/");
    const valid =
      segments[0] === "jobs" &&
      segments.length > 1 &&
      path.endsWith(".md") &&
      !path.includes("\\") &&
      segments.every(
        (segment) => segment && segment !== "." && segment !== "..",
      );
    if (!valid) {
      throw Object.assign(new Error("A valid automation path is required."), {
        statusCode: 400,
      });
    }
    return { path, name: automationName(path) };
  }
  if (!name || name.includes("/") || name.endsWith(".md")) {
    throw Object.assign(new Error("A valid automation name is required."), {
      statusCode: 400,
    });
  }
  return { path: `jobs/${name}.md`, name };
}

export async function queueAutomationRunNow(
  input: RunAutomationNowInput,
): Promise<QueuedAutomationRun> {
  const { path, name } = resolveAutomationTarget(input);
  const owner = ownerForScope(input);
  const resource = await resourceGetByPath(owner, path);
  if (!resource) {
    throw Object.assign(new Error(`Automation "${name}" not found.`), {
      statusCode: 404,
    });
  }
  if (!(await canUpdateAutomationResource(input, resource))) {
    throw Object.assign(
      new Error(
        "Only the automation's creator or an organization admin can run it.",
      ),
      { statusCode: 403 },
    );
  }
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
  await redispatchUnclaimedAutomationRuns({
    appId: input.appId,
    requestHeaders: input.requestHeaders,
  }).catch((error) => {
    console.warn(
      "[automations] Could not sweep queued runs before run-now:",
      error,
    );
  });

  const historyId = await startAutomationRun({
    owner: resource.owner,
    automation: name,
    path: resource.path,
    scope: input.scope,
    orgId: input.scope === "organization" ? input.orgId : null,
    appId: input.appId,
    dispatchPending: true,
  });
  try {
    await dispatchAutomationRun(historyId, input.requestHeaders);
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
export async function redispatchUnclaimedAutomationRuns(options?: {
  appId?: string | null;
  requestHeaders?: Headers;
}): Promise<number> {
  const runs = await listUnclaimedAutomationRuns({ appId: options?.appId });
  let attempted = 0;
  for (const run of runs) {
    try {
      await dispatchAutomationRun(run.id, options?.requestHeaders);
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
