import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import { resolveAutomationAccess } from "../automations/access.js";
import {
  canQueueAutomationRunNow,
  type AutomationScope,
} from "../automations/service.js";
import { isLocalDatabase } from "../db/client.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
} from "../resources/store.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { parseJobResource } from "./frontmatter.js";
import { automationRunOwnership } from "./run-history-ownership.js";
import {
  listUnclaimedAutomationRuns,
  startAutomationRun,
} from "./run-history.js";

export interface RunAutomationNowInput {
  userEmail: string;
  orgId?: string | null;
  resourceId?: string;
  appId?: string | null;
  scope?: AutomationScope;
  requestHeaders?: Headers;
  name?: string;
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
  const scope = input.scope ?? "personal";
  if (scope === "personal") return input.userEmail.trim().toLowerCase();
  if (scope !== "organization") {
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

function resolveAutomationTarget(input: RunAutomationNowInput): {
  path: string;
  name: string;
} {
  if (input.resourceId?.trim()) {
    throw Object.assign(
      new Error("Specify either a resourceId or an automation name/path."),
      { statusCode: 400 },
    );
  }
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

async function resolveRunAutomation(input: RunAutomationNowInput) {
  if (input.resourceId?.trim()) {
    if (input.name || input.path) {
      throw Object.assign(
        new Error("Specify either a resourceId or an automation name/path."),
        { statusCode: 400 },
      );
    }
    const access = await resolveAutomationAccess(
      { userEmail: input.userEmail },
      input.resourceId.trim(),
    );
    if (!access) return null;
    return {
      resource: access.resource,
      name: access.name,
      scope: access.owningOrganizationId ? "organization" : "personal",
      orgId: access.owningOrganizationId,
    };
  }

  const { path } = resolveAutomationTarget(input);
  const resource = await resourceGetByPath(ownerForScope(input), path);
  if (!resource) return null;
  const ownership = automationRunOwnership(
    resource.owner,
    input.userEmail,
    input.orgId,
  );
  return {
    resource,
    name: automationName(resource.path),
    scope: ownership.scope,
    orgId: ownership.orgId,
  };
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
  if (
    !(await canQueueAutomationRunNow(
      input,
      access.resource,
      access.scope as AutomationScope,
    ))
  ) {
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
    ...automationRunOwnership(
      resource.owner,
      input.userEmail,
      access.orgId ?? input.orgId,
    ),
    automation: name,
    path: resource.path,
    appId: input.appId,
    // The person who asked for the run, already authorized above; a stored
    // `createdBy` may have left the organization.
    notificationEmail: input.userEmail,
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
