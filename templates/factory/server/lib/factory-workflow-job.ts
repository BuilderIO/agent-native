import { randomUUID } from "node:crypto";

import { deleteAutomationRuns, nextOccurrence } from "@agent-native/core/jobs";
import {
  buildJobResourceContent,
  parseJobResource,
  patchJobFrontmatterFields,
  type JobFrontmatter,
  type JobFrontmatterPatch,
} from "@agent-native/core/jobs/frontmatter";
import {
  organizationResourceOwner,
  resourceDeleteByPath,
  resourceGetByPath,
  resourcePutIfAbsent,
  resourcePutIfCurrent,
  type Resource,
} from "@agent-native/core/resources";

import type { WorkflowGraph } from "../workflow/contract.js";
import {
  WorkflowScheduleError,
  deriveJobSchedule,
  type JobSchedule,
  type ScheduleErrorCode,
} from "../workflow/schedule.js";
import {
  assertAuthorFilter,
  readFrontmatterValue,
  type FactoryAutomationAuthorMode,
} from "./factory-automation-config.js";
import {
  findFactoryAutomationDefinition,
  type FactoryAutomationDefinition,
} from "./factory-automation-resources.js";
import {
  factoryAutomationJobPrefix,
  factoryAutomationRunHistoryKey,
  setAutomationFrontmatterField,
} from "./factory-scope.js";
import { WORKFLOW_RUNNER } from "./factory-workflow-runner.js";
import { canonicalGitHubRepository } from "./github-repository.js";
import { isSlackChannelId } from "./slack-channel-id.js";

// Core refuses to run a job with an empty body, and the runner never reads it.
const WORKFLOW_JOB_STUB_BODY =
  "# Factory workflow\n\nThis job runs the saved workflow graph. The graph is the source of truth; edit it in the workflow canvas. This text is a placeholder and is never sent to a model.";

const JOB_CONFLICT_ATTEMPTS = 3;
const JOB_PATH_ATTEMPTS = 3;

const WORKFLOW_JOB_ERROR_CODES = [
  "job_missing",
  "job_replaced",
  "job_conflict",
  "job_name_taken",
  "job_invalid",
] as const;

/** The job file could not be written or found; the workflow rows are not to blame. */
export class WorkflowJobError extends Error {
  readonly code: (typeof WORKFLOW_JOB_ERROR_CODES)[number];

  constructor(code: WorkflowJobError["code"], message: string) {
    super(message);
    this.name = "WorkflowJobError";
    this.code = code;
  }
}

interface WorkflowJobIssue {
  code:
    | "schedule_timezone_required"
    | "schedule_timezone_invalid"
    | "schedule_cadence_unsupported"
    | "source_scope_unsupported"
    | "source_filter_invalid"
    | "source_filter_conflict"
    | "source_poller_duplicate";
  nodeId?: string;
  detail: string;
}

export interface WorkflowJobPlan {
  schedule: JobSchedule;
  /**
   * Frontmatter the pollers read from the calling job: channel, repository,
   * Sentry project, author filter, work limit. A key set to undefined is
   * removed so a Source taken off the canvas stops being polled.
   */
  config: Record<string, string | undefined>;
}

const SCHEDULE_ISSUES: Partial<
  Record<ScheduleErrorCode, WorkflowJobIssue["code"]>
> = {
  timezone_required: "schedule_timezone_required",
  timezone_invalid: "schedule_timezone_invalid",
  cadence_unsupported: "schedule_cadence_unsupported",
};

const CONFIG_KEYS = [
  "slackChannelId",
  "repository",
  "sentryOrgSlug",
  "sentryProjectSlug",
  "authorMode",
  "authorIds",
  "workLimit",
] as const;

function inboxConfig(graph: WorkflowGraph): {
  config: WorkflowJobPlan["config"];
  issues: WorkflowJobIssue[];
} {
  const issues: WorkflowJobIssue[] = [];
  const config: WorkflowJobPlan["config"] = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, undefined]),
  );
  const seen = new Map<string, string>();
  let author:
    | { mode: FactoryAutomationAuthorMode; ids: string[]; nodeId: string }
    | undefined;
  let workLimit = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "source" || node.settings.source !== "inbox-poll") {
      continue;
    }
    const { poller, takeLimit, filter } = node.settings;
    const issue = (
      code: WorkflowJobIssue["code"],
      detail: string,
    ): WorkflowJobIssue => ({ code, nodeId: node.id, detail });
    const earlier = seen.get(poller);
    if (earlier) {
      issues.push(
        issue(
          "source_poller_duplicate",
          `A workflow job polls one ${poller} source; "${earlier}" already does.`,
        ),
      );
      continue;
    }
    seen.set(poller, node.id);
    workLimit = Math.max(workLimit, takeLimit);

    const scopes = filter?.scopes ?? [];
    if (scopes.length > 1) {
      issues.push(
        issue(
          "source_scope_unsupported",
          `A ${poller} source polls one ${poller === "slack" ? "channel" : poller === "github" ? "repository" : "project"} per workflow; this one lists ${scopes.length}.`,
        ),
      );
    }
    const scope = scopes[0];
    if (scope && scopes.length === 1) {
      if (poller === "slack") {
        if (isSlackChannelId(scope)) config.slackChannelId = scope;
        else {
          issues.push(
            issue(
              "source_scope_unsupported",
              `A Slack source polls a channel ID such as C0123ABCD, not "${scope}". Resolve the channel's ID, or ask the user for it.`,
            ),
          );
        }
      } else if (poller === "github") {
        try {
          config.repository = canonicalGitHubRepository(scope);
        } catch (error) {
          issues.push(
            issue(
              "source_scope_unsupported",
              error instanceof Error ? error.message : "Invalid repository.",
            ),
          );
        }
      } else {
        const [org, project, ...rest] = scope.split("/");
        if (!org || !project || rest.length > 0) {
          issues.push(
            issue(
              "source_scope_unsupported",
              'A Sentry source names its project as "organization/project".',
            ),
          );
        } else {
          config.sentryOrgSlug = org;
          config.sentryProjectSlug = project;
        }
      }
    }

    const authors = filter?.authors ?? [];
    const excluded = filter?.excludeAuthors ?? [];
    if (authors.length > 0 && excluded.length > 0) {
      issues.push(
        issue(
          "source_filter_invalid",
          "A source includes authors or excludes them, not both.",
        ),
      );
    } else if (authors.length > 0 || excluded.length > 0) {
      const mode = authors.length > 0 ? "include" : "exclude";
      try {
        if (poller === "sentry") {
          throw new Error("A Sentry source does not filter by author.");
        }
        const ids = assertAuthorFilter(
          poller,
          mode,
          mode === "include" ? authors : excluded,
        );
        if (
          author &&
          (author.mode !== mode || author.ids.join() !== ids.join())
        ) {
          issues.push(
            issue(
              "source_filter_conflict",
              `The author filter is kept once per workflow job; it differs from the one on "${author.nodeId}".`,
            ),
          );
        } else {
          author = { mode, ids, nodeId: node.id };
        }
      } catch (error) {
        issues.push(
          issue(
            "source_filter_invalid",
            error instanceof Error ? error.message : "Invalid author filter.",
          ),
        );
      }
    }
  }
  if (author) {
    config.authorMode = author.mode;
    config.authorIds = author.ids.join(",");
  }
  if (workLimit > 0) config.workLimit = String(workLimit);
  return { config, issues };
}

/**
 * What the job file must say for this graph, or why it cannot say it. Pure, so
 * a save can refuse before it writes anything.
 */
export function planWorkflowJob(graph: WorkflowGraph): {
  plan: WorkflowJobPlan | null;
  issues: WorkflowJobIssue[];
} {
  const { config, issues } = inboxConfig(graph);
  let schedule: JobSchedule | null = null;
  try {
    schedule = deriveJobSchedule(graph);
  } catch (error) {
    if (!(error instanceof WorkflowScheduleError)) throw error;
    // The validator already reports a missing or doubled Trigger.
    if (error.code !== "trigger_count") {
      const code = SCHEDULE_ISSUES[error.code];
      if (!code) throw error;
      issues.push({ code, nodeId: error.nodeId, detail: error.message });
    }
  }
  return {
    plan: schedule && issues.length === 0 ? { schedule, config } : null,
    issues,
  };
}

/** Where every workflow job lives, including in the default Factory. */
function workflowJobPath(factoryId: string, leaf: string): string {
  return `${factoryAutomationJobPrefix(factoryId)}${leaf}.md`;
}

function workflowJobLeaf(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled";
  return `workflow-${slug}-${randomUUID().slice(0, 8)}`;
}

// Factory's field writer appends a newline each time it replaces the last
// field, so a field that already holds the value is left alone: a save that
// changes nothing must leave the file byte for byte as it was.
function setFactoryField(content: string, key: string, value: string): string {
  if ((readFrontmatterValue(content, key) ?? "") === value) return content;
  return setAutomationFrontmatterField(content, key, value);
}

// What the saved workflow decides in a job file. Everything else in it, the
// scheduler's run state above all, is left as the scheduler wrote it.
function renderJob(
  content: string,
  input: {
    plan: WorkflowJobPlan;
    enabled: boolean;
    name: string;
    factoryId: string;
    latest: JobFrontmatter;
  },
): string {
  const { plan, enabled, latest } = input;
  const { cron, timezone } = plan.schedule;
  const fields: JobFrontmatterPatch = {
    schedule: cron,
    enabled,
    runner: WORKFLOW_RUNNER,
  };
  if (timezone !== null) fields.timezone = timezone;
  const zone = timezone ?? latest.timezone;
  const moved = latest.schedule !== cron || latest.timezone !== zone;
  if (enabled && (moved || !latest.enabled)) {
    fields.nextRun = nextOccurrence(cron, undefined, zone).toISOString();
  }
  if (
    enabled &&
    (latest.pausedReason || latest.lastErrorCode || latest.consecutiveFailures)
  ) {
    // Enabling lifts a pause and starts a clean failure streak, as core's own
    // job tools do; the engine's first tick then settles the real state.
    Object.assign(fields, {
      lastError: undefined,
      lastErrorCode: undefined,
      consecutiveFailures: undefined,
      lastFailedEventId: undefined,
      pausedReason: undefined,
      pausedAt: undefined,
      lastStatus: undefined,
    });
  }
  let next = patchJobFrontmatterFields(content, fields);
  const factoryFields: Record<string, string | undefined> = {
    factoryId: input.factoryId,
    displayName: input.name,
    ...plan.config,
  };
  for (const [key, value] of Object.entries(factoryFields)) {
    next = setFactoryField(next, key, value ?? "");
  }
  return next;
}

/** Writes the job file for a new workflow, switched off. */
export async function createWorkflowJob(input: {
  orgId: string;
  factoryId: string;
  ownerEmail: string;
  name: string;
  plan: WorkflowJobPlan;
}): Promise<{ id: string; path: string }> {
  const owner = organizationResourceOwner(input.orgId);
  const meta: JobFrontmatter = {
    schedule: input.plan.schedule.cron,
    enabled: false,
    triggerType: "schedule",
    domain: "factory",
    appId: "factory",
    createdBy: input.ownerEmail,
    orgId: input.orgId,
    runAs: "creator",
    runner: WORKFLOW_RUNNER,
    ...(input.plan.schedule.timezone === null
      ? {}
      : { timezone: input.plan.schedule.timezone }),
  };
  const base = buildJobResourceContent(meta, WORKFLOW_JOB_STUB_BODY);
  const content = renderJob(base, { ...input, enabled: false, latest: meta });
  for (let attempt = 0; attempt < JOB_PATH_ATTEMPTS; attempt += 1) {
    const path = workflowJobPath(input.factoryId, workflowJobLeaf(input.name));
    const written = await resourcePutIfAbsent(
      owner,
      path,
      content,
      "text/markdown",
    );
    if (written) return { id: written.id, path };
  }
  throw new WorkflowJobError(
    "job_name_taken",
    "Could not find a free job file name for this workflow.",
  );
}

/**
 * Rewrites an existing job file. The write is compare-and-swap against the
 * exact file it read, retried on the latest content, so a run the scheduler
 * records in between is not overwritten.
 */
async function editWorkflowJob(
  input: { orgId: string; factoryId: string; automationId: string },
  render: (content: string, latest: JobFrontmatter) => string,
): Promise<{ id: string; path: string; changed: boolean }> {
  const definition = await findFactoryAutomationDefinition(
    input.orgId,
    input.factoryId,
    input.automationId,
  );
  if (!definition) {
    throw new WorkflowJobError(
      "job_missing",
      "The job file for this workflow is gone.",
    );
  }
  const { owner, path } = definition.resource;
  let base: Resource | null = await resourceGetByPath(owner, path);
  for (let attempt = 0; attempt < JOB_CONFLICT_ATTEMPTS; attempt += 1) {
    if (!base) {
      throw new WorkflowJobError(
        "job_missing",
        "The job file for this workflow is gone.",
      );
    }
    if (base.id !== definition.resource.id) {
      throw new WorkflowJobError(
        "job_replaced",
        "A different file now sits at this workflow's job path.",
      );
    }
    const latest = parseJobResource(base.content).meta;
    if (latest.executionHostId) {
      throw new WorkflowJobError(
        "job_invalid",
        "A workflow job runs here and cannot target an execution host.",
      );
    }
    const content = render(base.content, latest);
    if (content === base.content) {
      return { id: base.id, path, changed: false };
    }
    const written = await resourcePutIfCurrent({
      owner,
      path,
      content,
      mimeType: "text/markdown",
      expectedId: base.id,
      expectedUpdatedAt: base.updatedAt,
      expectedContent: base.content,
    });
    if (written) return { id: written.id, path, changed: true };
    base = await resourceGetByPath(owner, path);
  }
  throw new WorkflowJobError(
    "job_conflict",
    "The job file kept changing while it was updated; try again.",
  );
}

/** Brings an existing job file in line with the saved workflow. */
export function syncWorkflowJob(input: {
  orgId: string;
  factoryId: string;
  automationId: string;
  name: string;
  plan: WorkflowJobPlan;
  enabled: boolean;
}): Promise<{ id: string; path: string; changed: boolean }> {
  return editWorkflowJob(input, (content, latest) =>
    renderJob(content, { ...input, latest }),
  );
}

/** Switches the job off without needing the graph to still describe a schedule. */
export function disableWorkflowJob(input: {
  orgId: string;
  factoryId: string;
  automationId: string;
}): Promise<{ id: string; path: string; changed: boolean }> {
  return editWorkflowJob(input, (content) =>
    patchJobFrontmatterFields(content, { enabled: false }),
  );
}

/** Deletes the job file and its run history. False when it was already gone. */
export async function removeWorkflowJob(input: {
  orgId: string;
  factoryId: string;
  automationId: string;
}): Promise<boolean> {
  const definition = await findFactoryAutomationDefinition(
    input.orgId,
    input.factoryId,
    input.automationId,
  );
  if (!definition) return false;
  const { owner, path } = definition.resource;
  const removed = await resourceDeleteByPath(owner, path);
  await deleteAutomationRuns(owner, factoryAutomationRunHistoryKey(path));
  return removed;
}

export interface WorkflowJobHealth {
  /** False when the workflow has no job or its file is gone: it will not run. */
  exists: boolean;
  enabled: boolean | null;
  schedule: string | null;
  timezone: string | null;
  runner: string | null;
  lastStatus: string | null;
  lastRun: string | null;
  nextRun: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  pausedReason: string | null;
  pausedAt: string | null;
  /** What disagrees with the saved workflow, such as `schedule` after a failed write-through. */
  drift: string[];
}

export function summarizeWorkflowJob(
  definition: FactoryAutomationDefinition | null,
  expected: { enabled: boolean; schedule?: JobSchedule },
): WorkflowJobHealth {
  if (!definition) {
    return {
      exists: false,
      enabled: null,
      schedule: null,
      timezone: null,
      runner: null,
      lastStatus: null,
      lastRun: null,
      nextRun: null,
      lastError: null,
      lastErrorCode: null,
      consecutiveFailures: 0,
      pausedReason: null,
      pausedAt: null,
      drift: ["missing"],
    };
  }
  const { meta } = definition;
  const drift: string[] = [];
  if (meta.runner !== WORKFLOW_RUNNER) drift.push("runner");
  if (meta.enabled !== expected.enabled) drift.push("enabled");
  if (expected.schedule) {
    if (meta.schedule !== expected.schedule.cron) drift.push("schedule");
    if (
      expected.schedule.timezone !== null &&
      meta.timezone !== expected.schedule.timezone
    ) {
      drift.push("timezone");
    }
  }
  return {
    exists: true,
    enabled: meta.enabled,
    schedule: meta.schedule || null,
    timezone: meta.timezone ?? null,
    runner: meta.runner ?? null,
    lastStatus: meta.lastStatus ?? null,
    lastRun: meta.lastRun ?? null,
    nextRun: meta.nextRun ?? null,
    lastError: meta.lastError ?? null,
    lastErrorCode: meta.lastErrorCode ?? null,
    consecutiveFailures: meta.consecutiveFailures ?? 0,
    pausedReason: meta.pausedReason ?? null,
    pausedAt: meta.pausedAt ?? null,
    drift,
  };
}
