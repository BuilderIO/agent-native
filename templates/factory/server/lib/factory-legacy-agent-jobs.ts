import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import {
  resourceGetByPath,
  resourcePutIfCurrent,
} from "@agent-native/core/resources";

import { recordFactoryGovernanceAudit } from "../triage/audit.js";
import { readFrontmatterValue } from "./factory-automation-config.js";
import type { FactoryAutomationDefinition } from "./factory-automation-resources.js";
import {
  factoryAutomationLeafName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";
import { WORKFLOW_RUNNER } from "./factory-workflow-runner.js";

/**
 * The agent jobs Factory used to seed: Slack feedback, Sentry errors, GitHub
 * issues, and PR babysit. Workflows replaced them, and the actions their
 * prompts call are gone. A copy made from the same template carries a numeric
 * suffix.
 */
const RETIRED_JOB_LEAF =
  /^factory-(?:slack-feedback|sentry-errors|github-issues|pr-babysit)(?:-\d+)?$/;

const RETIRED_ACTION_NAMES = [
  "get-slack-feedback-context",
  "dispatch-factory-item",
  "report-factory-findings",
  "babysit-factory-pull-request",
  "propose-pr-babysit-status",
] as const;

export const LEGACY_JOB_PAUSE_REASON = "replaced_by_workflows";

const LEGACY_JOB_NOTE =
  "Replaced by workflows. This job called actions that were removed. Delete it, or rebuild it as a workflow.";

// Core clears `pausedReason` when an owner enables a job again, so this stamp
// is what keeps the pause to once per job.
const RETIRED_AT_FIELD = "retiredAt";

interface LegacyJobFailure {
  path: string;
  stage: "pause" | "audit";
  message: string;
}

interface RetireLegacyAgentJobsResult {
  /** Names of the jobs this call paused. */
  retired: string[];
  /** Jobs whose pause or audit record did not complete; a pause that did not complete is tried again on the next read. */
  failed: LegacyJobFailure[];
  /** The input definitions, with each paused job's new state applied. */
  definitions: FactoryAutomationDefinition[];
}

/**
 * Whether a stored job is a seeded agent job that would still call a removed
 * action. A job is never touched when it runs the workflow engine, is already
 * disabled, was already paused here, or no longer names a removed action
 * because a person rewrote it.
 */
function isRetirable(job: { path: string; content: string }): boolean {
  if (!RETIRED_JOB_LEAF.test(factoryAutomationLeafName(job.path))) return false;
  if (!RETIRED_ACTION_NAMES.some((name) => job.content.includes(name))) {
    return false;
  }
  const { meta } = parseJobResource(job.content);
  return (
    meta.enabled &&
    meta.runner !== WORKFLOW_RUNNER &&
    readFrontmatterValue(job.content, RETIRED_AT_FIELD) === undefined
  );
}

function pausedContent(content: string, at: string): string {
  let next = content;
  for (const [key, value] of [
    ["enabled", "false"],
    ["lastStatus", "paused"],
    ["lastError", JSON.stringify(LEGACY_JOB_NOTE)],
    ["pausedReason", LEGACY_JOB_PAUSE_REASON],
    ["pausedAt", at],
    [RETIRED_AT_FIELD, at],
  ] as const) {
    next = setAutomationFrontmatterField(next, key, value);
  }
  return next;
}

/** The paused file content, or null when the job is no longer retirable or changed under the write. */
async function pauseJob(
  resource: FactoryAutomationDefinition["resource"],
  at: string,
): Promise<string | null> {
  // The listing carries no revision, so the write is checked against a fresh
  // read of the file as it is now.
  const fresh = await resourceGetByPath(resource.owner, resource.path);
  if (!fresh || !isRetirable(fresh)) return null;
  const content = pausedContent(fresh.content, at);
  // The text edit leaves a file it cannot read as frontmatter unchanged; that
  // must not be written and reported as a pause.
  const paused = parseJobResource(content).meta;
  if (paused.enabled || paused.pausedReason !== LEGACY_JOB_PAUSE_REASON) {
    throw new Error(
      `The frontmatter of ${resource.path} could not be rewritten to pause it.`,
    );
  }
  const written = await resourcePutIfCurrent({
    owner: resource.owner,
    path: resource.path,
    content,
    mimeType: "text/markdown",
    expectedId: fresh.id,
    expectedUpdatedAt: fresh.updatedAt,
    expectedContent: fresh.content,
  });
  if (!written) {
    console.warn(
      `[factory-legacy-agent-jobs] ${resource.path} changed while it was being paused; it is checked again on the next read.`,
    );
    return null;
  }
  return content;
}

/**
 * Pauses the retired seeded agent jobs in one factory, once each, and keeps
 * their resource: the owner decides whether to delete them. It never runs at
 * plugin init. Callers run it behind a request that already read the
 * factory's jobs, so a deployment pays for it only when someone looks.
 */
export async function retireLegacyAgentJobs(input: {
  identity: { userEmail: string; orgId: string };
  factoryId: string;
  definitions: readonly FactoryAutomationDefinition[];
  now?: () => Date;
}): Promise<RetireLegacyAgentJobsResult> {
  const now = input.now ?? (() => new Date());
  const result: RetireLegacyAgentJobsResult = {
    retired: [],
    failed: [],
    definitions: [],
  };

  for (const definition of input.definitions) {
    const { resource, name } = definition;
    let content: string | null = null;
    const at = now().toISOString();
    if (isRetirable(resource)) {
      try {
        content = await pauseJob(resource, at);
      } catch (error) {
        console.error(
          `[factory-legacy-agent-jobs] could not pause ${resource.path}:`,
          error,
        );
        result.failed.push({
          path: resource.path,
          stage: "pause",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (content === null) {
      result.definitions.push(definition);
      continue;
    }

    result.retired.push(name);
    result.definitions.push({
      ...definition,
      resource: { ...resource, content },
      meta: parseJobResource(content).meta,
    });
    try {
      await recordFactoryGovernanceAudit(input.identity, {
        action: "retire-legacy-agent-job",
        kind: "governance",
        status: "success",
        factoryId: input.factoryId,
        summary: `Paused ${name}: replaced by workflows.`,
        details: {
          path: resource.path,
          resourceId: resource.id,
          pausedReason: LEGACY_JOB_PAUSE_REASON,
          pausedAt: at,
        },
      });
    } catch (error) {
      console.error(
        `[factory-legacy-agent-jobs] paused ${resource.path} but could not record the audit event:`,
        error,
      );
      result.failed.push({
        path: resource.path,
        stage: "audit",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
