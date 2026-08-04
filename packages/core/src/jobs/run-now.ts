import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import {
  canUpdateAutomationResource,
  type AutomationScope,
} from "../automations/service.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
} from "../resources/store.js";
import { fireInternalDispatch } from "../server/self-dispatch.js";
import { parseJobResource } from "./frontmatter.js";
import { startAutomationRun, finishAutomationRun } from "./run-history.js";

export interface RunAutomationNowInput {
  userEmail: string;
  orgId?: string | null;
  scope: AutomationScope;
  name: string;
}

export interface QueuedAutomationRun {
  queued: true;
  runId: string;
  automationRunId: string;
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

export async function queueAutomationRunNow(
  input: RunAutomationNowInput,
): Promise<QueuedAutomationRun> {
  const name = input.name.trim();
  if (!name || name.includes("/") || name.endsWith(".md")) {
    throw Object.assign(new Error("A valid automation name is required."), {
      statusCode: 400,
    });
  }
  const owner = ownerForScope(input);
  const resource = await resourceGetByPath(owner, `jobs/${name}.md`);
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

  const historyId = await startAutomationRun({
    owner: resource.owner,
    automation: name,
    path: resource.path,
    scope: input.scope,
    orgId: input.scope === "organization" ? input.orgId : null,
  });
  const dispatchPath = resolveAgentChatProcessRunDispatchPath();
  try {
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
        : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Background dispatch failed";
    await finishAutomationRun(
      historyId,
      "error",
      `Could not start the automation: ${message}. No delivery was confirmed.`,
    ).catch(() => {});
    throw error;
  }

  return { queued: true, runId: historyId, automationRunId: historyId };
}
