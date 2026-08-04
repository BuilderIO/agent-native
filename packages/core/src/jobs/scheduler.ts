import {
  resourceGetByPath,
  resourceListAllOwners,
  resourcePutIfCurrent,
  type Resource,
} from "../resources/store.js";
import {
  backgroundRunCutOffReason,
  isBackgroundAutomationRunActive,
  resolveBackgroundAutomationIdentity,
  runBackgroundAutomation,
  type BackgroundAutomationContext,
  type BackgroundAutomationDeps,
} from "./background-automation-runner.js";
import {
  nextOccurrence,
  isValidCron,
  describeCron,
  effectiveTimezone,
} from "./cron.js";
import {
  buildJobResourceContent,
  parseJobResource,
  type JobFrontmatter,
} from "./frontmatter.js";
import {
  claimAutomationRun,
  finishAutomationRun,
  getAutomationRun,
} from "./run-history.js";

// ─── Frontmatter parsing ────────────────────────────────────────────────────

export {
  classifyJobFrontmatter,
  classifyJobResource,
  normalizeJobMcpTools,
  parseJobResource,
  type JobFrontmatter,
  type JobResourceClassification,
} from "./frontmatter.js";

export function parseJobFrontmatter(content: string): {
  meta: JobFrontmatter;
  body: string;
} {
  const { meta, body } = parseJobResource(content);
  return { meta, body };
}

export function buildJobContent(meta: JobFrontmatter, body: string): string {
  return buildJobResourceContent(meta, body);
}

// ─── Job execution ──────────────────────────────────────────────────────────

export type RecurringJobContext = BackgroundAutomationContext;

export interface SchedulerDeps extends BackgroundAutomationDeps {
  /**
   * Tool names to expose on the FIRST engine request for a job run. When
   * provided, every other action returned by `getActions()` is deferred
   * behind an attached `tool-search` entry instead of being serialized on
   * every scheduled tick — `runAgentLoop`'s mid-run tool expansion
   * (`expandActiveTools`) still lets the model discover and call them after
   * a search. Omit to keep the full `getActions()` set visible up front
   * (current behavior). The caller (not this module) knows which of the
   * merged actions are the app's own vs. framework additions, so this must
   * be supplied explicitly rather than inferred here.
   */
  getInitialToolNames?: (job?: RecurringJobContext) => string[] | undefined;
}

let _isRunning = false;

// Skip the DB query on every tick if we recently confirmed no jobs exist.
// `_hasJobsCache` is invalidated whenever a `jobs/*` resource is written or
// deleted (subscribed below), and refreshed at most every 5 minutes.
let _hasJobsCache: boolean | undefined;
let _lastJobsCheck = 0;
const JOBS_CHECK_INTERVAL_MS = 5 * 60_000;
let _emitterSubscribed = false;

function subscribeToJobsResourceEvents(): void {
  if (_emitterSubscribed) return;
  _emitterSubscribed = true;
  // Lazy import to avoid circular deps at module load
  import("../resources/emitter.js")
    .then(({ getResourcesEmitter }) => {
      getResourcesEmitter().on("resources", (event: any) => {
        if (typeof event?.path === "string" && event.path.startsWith("jobs/")) {
          _hasJobsCache = undefined;
        }
      });
    })
    .catch((err) => {
      console.warn(
        "[jobs] resource-event subscription failed:",
        err instanceof Error ? err.message : err,
      );
    });
}

/**
 * Process all due recurring jobs. Called every 60 seconds.
 * Sequential execution with 5-minute timeout per job.
 */
export async function processRecurringJobs(deps: SchedulerDeps): Promise<void> {
  // Prevent concurrent runs
  if (_isRunning) return;

  subscribeToJobsResourceEvents();

  // Skip if we recently confirmed there are no job resources to run.
  const nowMs = Date.now();
  if (
    _hasJobsCache === false &&
    nowMs - _lastJobsCheck < JOBS_CHECK_INTERVAL_MS
  ) {
    return;
  }

  _isRunning = true;

  try {
    const jobResources = await resourceListAllOwners("jobs/");
    _hasJobsCache = jobResources.some(
      (r) => r.path.endsWith(".md") && !r.path.endsWith(".keep"),
    );
    _lastJobsCheck = nowMs;
    if (!_hasJobsCache) return;
    const now = new Date();

    for (const resource of jobResources) {
      // Skip non-markdown or .keep files
      if (!resource.path.endsWith(".md")) continue;
      if (resource.path.endsWith(".keep")) continue;

      const { meta, body } = parseJobFrontmatter(resource.content);

      // Legacy jobs have no explicit trigger type. Explicit automations are
      // acquired here only when they positively declare a schedule trigger.
      const isScheduleTrigger =
        meta.triggerType === undefined || meta.triggerType === "schedule";
      if (!isScheduleTrigger) continue;

      // Skip disabled or missing schedule
      if (!meta.enabled || !meta.schedule) continue;
      if (!isValidCron(meta.schedule)) continue;

      // Skip if currently running, unless it has been stuck for more than 10 minutes
      // (server crash mid-job leaves lastStatus=running forever without this guard)
      if (meta.lastStatus === "running") {
        if (isBackgroundAutomationRunActive(meta, now)) continue;
        // Stuck — reset so the next check can re-run it
        meta.lastStatus = "error";
        meta.lastError = "Job timed out or server crashed mid-run";
        const next = nextOccurrence(meta.schedule, now, meta.timezone);
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);
        continue;
      }

      // Check if due
      if (meta.nextRun) {
        const nextRunDate = new Date(meta.nextRun);
        if (nextRunDate > now) continue;
      } else {
        // No nextRun computed yet — seed it from `now` so the job waits for its
        // real next occurrence. Computing from new Date(0) (the epoch) always
        // returns a 1970 date, which is < now, so the job would fire
        // immediately on first sight regardless of its schedule.
        const next = nextOccurrence(meta.schedule, now, meta.timezone);
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);
        continue;
      }

      // Skip if body is empty
      if (!body.trim()) continue;

      // Execute the job
      await executeJob(resource, meta, body, deps, now);
    }
  } catch (err) {
    // Transient WS / connection drops (Neon serverless): silently retry next
    // tick instead of spamming stderr — `retryOnConnectionError` already did
    // its retry budget at the driver level.
    const { isConnectionError } = await import("../db/client.js");
    if (isConnectionError(err)) {
      _hasJobsCache = undefined; // force re-check on next successful tick
      _lastJobsCheck = 0;
      return;
    }
    // Unwrap ErrorEvent (Neon WS driver emits these on network failure) so logs show the real cause
    const detail =
      err instanceof Error
        ? err
        : ((err as any)?.error ?? (err as any)?.message ?? err);
    console.error("[recurring-jobs] Error processing jobs:", detail);
  } finally {
    _isRunning = false;
  }
}

export const jobRunCutOffReason = backgroundRunCutOffReason;

interface JobExecutionResult {
  status: "success" | "error" | "skipped";
  runId?: string;
  error?: string;
}

interface ExecuteJobOptions {
  advanceSchedule?: boolean;
  historyId?: string;
  manual?: boolean;
}

async function executeJob(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
  deps: SchedulerDeps,
  now: Date,
  options: ExecuteJobOptions = {},
): Promise<JobExecutionResult> {
  const jobName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");

  const jobContext: RecurringJobContext = {
    name: jobName,
    meta,
    body,
    resource,
  };
  const identity = await resolveBackgroundAutomationIdentity(jobContext);

  // SECURITY (audit 12 #10): re-validate the run-as user/membership on
  // every tick. Sharing revocation, user deletion, and org-member removal
  // must take effect for already-scheduled jobs. Skip the tick on
  // failure; leave the cron entry alone so an admin can purge after
  // investigation.
  if (!identity.ok) {
    console.warn(
      `[recurring-jobs] Skipping job "${jobName}": ${identity.reason}. ` +
        `User/membership no longer valid — leaving cron entry for admin review.`,
    );
    // Mark as skipped without resetting nextRun so an admin can find it.
    // `lastRun` is deliberately untouched: the job did not run, and stamping
    // it here made a permanently blocked job look like it ran every minute.
    // Re-writing an unchanged resource on every tick also churns the poll
    // stream, so only persist when the failure state actually changed.
    const alreadyRecorded =
      meta.lastStatus === "skipped" && meta.lastError === identity.reason;
    meta.lastCheck = now.toISOString();
    meta.lastStatus = "skipped";
    meta.lastError = identity.reason;
    if (!alreadyRecorded) await updateResource(resource, meta, body);
    if (options.historyId) {
      await finishAutomationRun(
        options.historyId,
        "error",
        `Automation did not run: ${identity.reason}. No delivery was confirmed.`,
      );
    }
    return { status: "skipped", error: identity.reason };
  }
  const jobUserEmail = identity.identity.userEmail;
  const jobOrgId = identity.identity.orgId;

  // Manual runs use the same resource row as scheduled runs for concurrency
  // protection. The check is paired with the conditional write below: two
  // requests that read the same idle snapshot cannot both claim it.
  if (options.manual && isBackgroundAutomationRunActive(meta, now)) {
    const error = "The automation is already running.";
    if (options.historyId) {
      await finishAutomationRun(
        options.historyId,
        "error",
        `${error} No delivery was confirmed.`,
      );
    }
    return { status: "skipped", error };
  }

  // Mark as running
  meta.lastRun = now.toISOString();
  meta.lastStatus = "running";
  meta.lastError = undefined;
  if (!(await updateResource(resource, meta, body))) {
    console.log(
      `[recurring-jobs] "${resource.path}" changed before it could start; dropping this tick.`,
    );
    if (options.historyId) {
      await finishAutomationRun(
        options.historyId,
        "error",
        "The automation changed before the run could start. No delivery was confirmed.",
      );
    }
    return {
      status: "error",
      error: "The automation changed before the run could start.",
    };
  }

  const requestContext =
    meta.originScopeId && meta.deliveryPlatform && meta.deliveryDestination
      ? {
          isIntegrationCaller: true as const,
          integration: {
            taskId: `job:${jobName}:${now.getTime()}`,
            scopeId: meta.originScopeId,
            principalType: "service" as const,
            incoming: {
              platform: meta.deliveryPlatform,
              externalThreadId: `${meta.deliveryTenantId || "unknown"}:${meta.deliveryDestination}:${meta.deliveryThreadRef || "root"}`,
              text: "",
              tenantId: meta.deliveryTenantId,
              integrationScopeId: meta.originScopeId,
              platformContext: {
                channelId: meta.deliveryDestination,
                threadTs: meta.deliveryThreadRef,
                teamId: meta.deliveryTenantId,
              },
              threadRef: meta.deliveryThreadRef,
              timestamp: now.getTime(),
            },
          },
        }
      : undefined;

  try {
    const result = await runBackgroundAutomation(
      {
        automation: jobContext,
        ownerEmail: jobUserEmail,
        orgId: jobOrgId,
        prompt: options.manual
          ? `[Manual Automation Run: ${jobName}]\nThis run was explicitly started by the automation owner. Execute the following instructions now:\n\n${body}`
          : `[Recurring Job: ${jobName}]\nSchedule: ${describeCron(meta.schedule, effectiveTimezone(meta.timezone))}\n\nExecute the following job instructions:\n\n${body}`,
        threadTitle: `${options.manual ? "Automation" : "Job"}: ${jobName} — ${now.toLocaleDateString()}`,
        runIdPrefix: `${options.manual ? "manual" : "job"}-${jobName}`,
        usageLabel: `${options.manual ? "manual-automation" : "recurring-job"}:${jobName}`,
        requestContext,
        ...(options.historyId ? { historyId: options.historyId } : {}),
        actionCaller: "automation" as const,
      },
      deps,
    );

    await recordExecutionOutcome(resource, {
      lastRun: meta.lastRun,
      lastStatus: "success",
      lastError: undefined,
      advanceSchedule: options.advanceSchedule,
    });
    console.log(`[recurring-jobs] Job "${jobName}" completed.`);
    return { status: "success", runId: result.runId };
  } catch (err) {
    const lastError =
      err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
    const reportedError = `${lastError}. No delivery was confirmed.`;
    await recordExecutionOutcome(resource, {
      lastRun: meta.lastRun,
      lastStatus: "error",
      lastError: reportedError,
      advanceSchedule: options.advanceSchedule,
    });
    console.error(`[recurring-jobs] Job "${jobName}" failed:`, reportedError);
    return { status: "error", error: reportedError };
  }
}

/** Execute one stored automation without changing its scheduled next run. */
export async function runJobNow(
  owner: string,
  name: string,
  deps: SchedulerDeps,
  options: { historyId?: string } = {},
): Promise<JobExecutionResult> {
  const path = `jobs/${name}.md`;
  const resource = await resourceGetByPath(owner, path);
  if (!resource) throw new Error(`Automation "${name}" not found.`);
  const { meta, body } = parseJobFrontmatter(resource.content);
  if (!body.trim())
    throw new Error(`Automation "${name}" has no instructions.`);
  return executeJob(resource, meta, body, deps, new Date(), {
    advanceSchedule: false,
    historyId: options.historyId,
    manual: true,
  });
}

/** Process a durable run-now history row exactly once in the background worker. */
export async function runQueuedAutomation(
  historyId: string,
  deps: SchedulerDeps,
): Promise<{ skipped: boolean; runId?: string; error?: string }> {
  const queued = await getAutomationRun(historyId);
  if (!queued) throw new Error(`Automation run "${historyId}" not found.`);
  if (!(await claimAutomationRun(historyId))) {
    return { skipped: true };
  }
  const result = await runJobNow(queued.owner, queued.automation, deps, {
    historyId,
  });
  return {
    skipped: false,
    ...(result.runId ? { runId: result.runId } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

async function updateResource(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
): Promise<boolean> {
  const content = buildJobContent(meta, body);
  const written = await resourcePutIfCurrent({
    owner: resource.owner,
    path: resource.path,
    content,
    expectedId: resource.id,
    expectedUpdatedAt: resource.updatedAt,
    expectedContent: resource.content,
  });
  return written !== null;
}

/** Execution bookkeeping the scheduler owns; the rest belongs to the editor. */
type ExecutionOutcome = Pick<
  JobFrontmatter,
  "lastRun" | "lastCheck" | "lastStatus" | "lastError"
> & { advanceSchedule?: boolean };

/**
 * Persist the result of a run without clobbering a concurrent edit.
 *
 * A run holds its `meta` for as long as the job takes, so writing that whole
 * snapshot back on completion would silently revert a schedule, timezone or
 * instruction change made while it was running. Only the execution fields are
 * ours to write, and `nextRun` is recomputed from whatever schedule is stored
 * now, so an edit mid-run takes effect on the next tick.
 */
async function recordExecutionOutcome(
  resource: Resource,
  outcome: ExecutionOutcome,
): Promise<void> {
  const latest = await resourceGetByPath(resource.owner, resource.path);
  if (!latest) {
    // Deleted while it was running. Writing the pre-run snapshot back would
    // resurrect the automation and schedule it again.
    console.log(
      `[recurring-jobs] "${resource.path}" was deleted mid-run; dropping its outcome.`,
    );
    return;
  }
  if (latest.id !== resource.id) {
    // The old definition was deleted and a new one reused the same path.
    // Never attach the old run's outcome to the replacement definition.
    console.log(
      `[recurring-jobs] "${resource.path}" was replaced mid-run; dropping its outcome.`,
    );
    return;
  }
  const current = parseJobResource(latest.content);

  const { advanceSchedule, ...execution } = outcome;
  const meta: JobFrontmatter = { ...current.meta, ...execution };
  if (
    advanceSchedule !== false &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    // Measured from completion so a long run cannot immediately re-fire.
    meta.nextRun = nextOccurrence(
      meta.schedule,
      new Date(),
      meta.timezone,
    ).toISOString();
  }
  if (!(await updateResource(latest, meta, current.body))) {
    console.log(
      `[recurring-jobs] "${resource.path}" changed while its outcome was being recorded; dropping the outcome.`,
    );
  }
}
