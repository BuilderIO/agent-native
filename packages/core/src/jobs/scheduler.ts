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
  jobBelongsToApp,
  parseJobResource,
  type JobFrontmatter,
} from "./frontmatter.js";
import {
  dispatchRemoteAutomation,
  finishRemoteAutomationHistory,
  getRemoteAutomationStatus,
} from "./remote-execution.js";
import {
  claimAutomationRun,
  finishAutomationRun,
  getAutomationRun,
  listAutomationRuns,
} from "./run-history.js";
import {
  acquireAutomationSchedulerLease,
  recordAutomationSchedulerHealth,
  releaseAutomationSchedulerLease,
  renewAutomationSchedulerLease,
  AUTOMATION_SCHEDULER_LEASE_RENEWAL_MS,
} from "./scheduler-health.js";

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

const MAX_CONCURRENT_SCHEDULED_JOBS = 8;
const MAX_IDENTITY_PREFLIGHTS_PER_TICK = MAX_CONCURRENT_SCHEDULED_JOBS * 4;
const IDENTITY_FAILURE_RETRY_MS = 5 * 60_000;
const _activeScheduledJobs = new Set<string>();
const _preflightingScheduledJobs = new Set<string>();

// Skip the DB query on every tick if we recently confirmed no jobs exist.
// `_hasJobsCache` is invalidated whenever a `jobs/*` resource is written or
// deleted (subscribed below), and refreshed at most every 5 minutes.
let _hasJobsCache: boolean | undefined;
let _lastJobsCheck = 0;
const JOBS_CHECK_INTERVAL_MS = 5 * 60_000;
let _emitterSubscribed = false;

async function recordSchedulerHealthForScopes(input: {
  appId?: string;
  orgIds: Iterable<string | null>;
  checkedAt?: number;
  dispatchedAt?: number;
  error?: string | null;
}): Promise<void> {
  const orgIds = [...new Set(input.orgIds)];
  const scopes = orgIds.length > 0 ? orgIds : [null];
  const results = await Promise.allSettled(
    scopes.map((orgId) =>
      recordAutomationSchedulerHealth({
        appId: input.appId,
        orgId,
        checkedAt: input.checkedAt,
        dispatchedAt: input.dispatchedAt,
        error: input.error,
        runtime: "recurring-jobs",
      }),
    ),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn(
        "[recurring-jobs] Could not persist scheduler health:",
        result.reason,
      );
    }
  }
}

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
 *
 * Scans may overlap while a long-running job is executing. Each resource is
 * still protected by its persisted running state and a process-local key, so
 * one job cannot run twice while leaving other due jobs waiting behind it.
 */
export async function processRecurringJobs(deps: SchedulerDeps): Promise<void> {
  const leaseOwner = await acquireAutomationSchedulerLease({
    appId: deps.appId,
  });
  if (!leaseOwner) return;

  const leaseRenewal = setInterval(() => {
    void renewAutomationSchedulerLease({
      appId: deps.appId,
      owner: leaseOwner,
    }).catch((error) => {
      console.warn(
        "[recurring-jobs] Scheduler lease renewal failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, AUTOMATION_SCHEDULER_LEASE_RENEWAL_MS);

  let primaryFailed = false;
  try {
    await processRecurringJobsWithLease(deps);
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    clearInterval(leaseRenewal);
    try {
      await releaseAutomationSchedulerLease({
        appId: deps.appId,
        owner: leaseOwner,
      });
    } catch (releaseError) {
      console.warn(
        "[recurring-jobs] Scheduler lease release failed:",
        releaseError instanceof Error ? releaseError.message : releaseError,
      );
      if (!primaryFailed) throw releaseError;
    }
  }
}

async function processRecurringJobsWithLease(
  deps: SchedulerDeps,
): Promise<void> {
  subscribeToJobsResourceEvents();

  // Skip if we recently confirmed there are no job resources to run.
  const nowMs = Date.now();
  // Write a global heartbeat before the resource scan. A slow or failed scan
  // must not make a healthy worker look idle until the finally block runs.
  await recordSchedulerHealthForScopes({
    appId: deps.appId,
    orgIds: [],
    checkedAt: nowMs,
  });
  if (
    _hasJobsCache === false &&
    nowMs - _lastJobsCheck < JOBS_CHECK_INTERVAL_MS
  ) {
    await recordSchedulerHealthForScopes({
      appId: deps.appId,
      orgIds: [],
      checkedAt: nowMs,
    });
    return;
  }

  const reservedJobKeys = new Set<string>();
  const startedJobKeys = new Set<string>();
  const healthOrgIds = new Set<string | null>();
  let healthError: string | null = null;
  let dispatchedAt: number | undefined;

  try {
    const jobResources = await resourceListAllOwners("jobs/");
    _hasJobsCache = jobResources.some(
      (r) => r.path.endsWith(".md") && !r.path.endsWith(".keep"),
    );
    _lastJobsCheck = nowMs;
    if (!_hasJobsCache) return;
    const now = new Date();

    const dueJobCandidates: Array<{
      key: string;
      resource: Resource;
      meta: JobFrontmatter;
      body: string;
    }> = [];

    for (const resource of jobResources) {
      // Skip non-markdown or .keep files
      if (!resource.path.endsWith(".md")) continue;
      if (resource.path.endsWith(".keep")) continue;

      const { meta, body } = parseJobFrontmatter(resource.content);
      // Jobs written before app ownership was persisted remain compatible with
      // the shared scheduler. Once a job declares an owner, only that app may
      // evaluate or execute it. Without this boundary every app's scheduled
      // worker can claim the same organization resource.
      if (!jobBelongsToApp(meta, deps.appId)) continue;
      healthOrgIds.add(meta.orgId ?? null);

      // A host-targeted run is reconciled from the durable relay command. It
      // must never fall back to this scheduler after the laptop disconnects.
      if (meta.lastStatus === "running" && meta.executionHostId) {
        await reconcileRemoteJob(resource, meta, now);
        continue;
      }

      // Skip disabled or missing schedule
      if (!meta.enabled || !meta.schedule) continue;
      if (!isValidCron(meta.schedule)) continue;

      // Skip if currently running, unless it has been stuck for more than 10 minutes
      // (server crash mid-job leaves lastStatus=running forever without this guard)
      if (meta.lastStatus === "running") {
        if (isBackgroundAutomationRunActive(meta, now)) continue;
        // Stuck — reset so the next check can re-run it
        meta.lastStatus = "error";
        meta.lastError =
          "Worker stopped before a terminal result was recorded. The serverless worker may have timed out or been recycled. No delivery was confirmed.";
        const next = nextOccurrence(meta.schedule, now, meta.timezone);
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);
        await recoverStaleAutomationHistory(resource.owner, resource.path);
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

      if (hasRecentIdentityFailure(meta, now)) continue;

      const key = `${resource.owner}:${resource.path}`;
      if (
        _activeScheduledJobs.has(key) ||
        _preflightingScheduledJobs.has(key)
      ) {
        continue;
      }
      dueJobCandidates.push({ key, resource, meta, body });
    }

    const preflightCandidates: typeof dueJobCandidates = [];
    for (const candidate of dueJobCandidates) {
      if (
        _activeScheduledJobs.size >= MAX_CONCURRENT_SCHEDULED_JOBS ||
        preflightCandidates.length >= MAX_IDENTITY_PREFLIGHTS_PER_TICK
      ) {
        break;
      }
      if (
        _activeScheduledJobs.has(candidate.key) ||
        _preflightingScheduledJobs.has(candidate.key)
      ) {
        continue;
      }
      preflightCandidates.push(candidate);
    }

    // Identity checks can reject stale jobs that remain due for admin review.
    // Bound the checks so a large blocked backlog cannot consume the whole
    // invocation or make valid jobs wait behind an unbounded stale queue.
    const dueJobs: typeof dueJobCandidates = [];
    for (const candidate of preflightCandidates) {
      _preflightingScheduledJobs.add(candidate.key);
      try {
        const identity = await resolveBackgroundAutomationIdentity({
          name: candidate.resource.path
            .replace(/^jobs\//, "")
            .replace(/\.md$/, ""),
          meta: candidate.meta,
          body: candidate.body,
          resource: candidate.resource,
        });
        if (!identity.ok) {
          await recordIdentityFailure(
            candidate.resource,
            candidate.meta,
            candidate.body,
            now,
            identity.reason,
          );
          continue;
        }
        if (_activeScheduledJobs.size >= MAX_CONCURRENT_SCHEDULED_JOBS) {
          break;
        }
        _activeScheduledJobs.add(candidate.key);
        reservedJobKeys.add(candidate.key);
        dueJobs.push(candidate);
      } finally {
        _preflightingScheduledJobs.delete(candidate.key);
      }
    }

    if (dueJobs.length > 0) dispatchedAt = Date.now();
    await recordSchedulerHealthForScopes({
      appId: deps.appId,
      orgIds: healthOrgIds,
      checkedAt: Date.now(),
      dispatchedAt,
    });
    const outcomes = await Promise.allSettled(
      dueJobs.map(({ key, resource, meta, body }) => {
        startedJobKeys.add(key);
        return executeJob(resource, meta, body, deps, now).finally(() => {
          _activeScheduledJobs.delete(key);
        });
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        console.error("[recurring-jobs] Job execution error:", outcome.reason);
      }
    }
  } catch (err) {
    // Transient WS / connection drops (Neon serverless): silently retry next
    // tick instead of spamming stderr — `retryOnConnectionError` already did
    // its retry budget at the driver level.
    const { isConnectionError } = await import("../db/client.js");
    if (isConnectionError(err)) {
      healthError = "The scheduler could not reach the database.";
      _hasJobsCache = undefined; // force re-check on next successful tick
      _lastJobsCheck = 0;
      return;
    }
    // Unwrap ErrorEvent (Neon WS driver emits these on network failure) so logs show the real cause
    const detail =
      err instanceof Error
        ? err
        : ((err as any)?.error ?? (err as any)?.message ?? err);
    healthError = detail instanceof Error ? detail.message : String(detail);
    console.error("[recurring-jobs] Error processing jobs:", detail);
  } finally {
    // A scan can fail after reserving a job but before dispatching it. Do not
    // leave that reservation blocking the job on every subsequent tick.
    for (const key of reservedJobKeys) {
      if (!startedJobKeys.has(key)) _activeScheduledJobs.delete(key);
    }
    await recordSchedulerHealthForScopes({
      appId: deps.appId,
      orgIds: healthOrgIds,
      checkedAt: Date.now(),
      dispatchedAt,
      error: healthError,
    });
  }
}

async function recoverStaleAutomationHistory(
  owner: string,
  path: string,
): Promise<void> {
  const automation = path.replace(/^jobs\//, "").replace(/\.md$/, "");
  try {
    const [run] = await listAutomationRuns({
      owners: [owner],
      automation,
      limit: 1,
    });
    if (
      !run ||
      run.finishedAt !== null ||
      (run.status !== "running" && run.status !== "interrupted")
    ) {
      return;
    }
    await finishAutomationRun(
      run.id,
      "error",
      "Worker stopped before a terminal result was recorded. The serverless worker may have timed out or been recycled. No delivery was confirmed.",
    );
  } catch (error) {
    console.warn(
      `[recurring-jobs] Could not record stale history for "${automation}":`,
      error instanceof Error ? error.message : error,
    );
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

async function recordIdentityFailure(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
  now: Date,
  reason: string,
  historyId?: string,
): Promise<JobExecutionResult> {
  const jobName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
  console.warn(
    `[recurring-jobs] Skipping job "${jobName}": ${reason}. ` +
      `User/membership no longer valid — leaving cron entry for admin review.`,
  );
  // Keep blocked jobs due so an admin can find them, but do not let their
  // persistent failure consume an execution slot on every scheduler sweep.
  const alreadyRecorded =
    meta.lastStatus === "skipped" && meta.lastError === reason;
  meta.lastCheck = now.toISOString();
  meta.lastStatus = "skipped";
  meta.lastError = reason;
  if (!alreadyRecorded) await updateResource(resource, meta, body);
  if (historyId) {
    await finishAutomationRun(
      historyId,
      "error",
      `Automation did not run: ${reason}. No delivery was confirmed.`,
    );
  }
  return { status: "skipped", error: reason };
}

function hasRecentIdentityFailure(meta: JobFrontmatter, now: Date): boolean {
  if (meta.lastStatus !== "skipped" || !meta.lastCheck || !meta.lastError) {
    return false;
  }
  const lastCheckMs = Date.parse(meta.lastCheck);
  const elapsedMs = now.getTime() - lastCheckMs;
  return (
    Number.isFinite(lastCheckMs) &&
    elapsedMs >= 0 &&
    elapsedMs < IDENTITY_FAILURE_RETRY_MS
  );
}

async function reconcileRemoteJob(
  resource: Resource,
  meta: JobFrontmatter,
  now: Date,
): Promise<void> {
  const ownerEmail = meta.createdBy?.trim() || resource.owner;
  try {
    const remote = await getRemoteAutomationStatus({
      meta,
      ownerEmail,
      orgId: meta.orgId,
      now,
    });
    if (remote.state === "active") return;

    const error =
      remote.error ??
      (remote.state === "failed"
        ? "The remote execution host did not complete this automation."
        : undefined);
    await finishRemoteAutomationHistory(
      meta,
      remote.state === "completed" ? "completed" : "failed",
      error,
    ).catch((historyError) => {
      console.warn(
        `[recurring-jobs] Could not finish remote history for "${resource.path}":`,
        historyError,
      );
    });
    await recordExecutionOutcome(resource, {
      lastRun: meta.lastRun,
      lastStatus: remote.state === "completed" ? "success" : "error",
      lastError: error,
      remoteRequestId: undefined,
      remoteCommandId: undefined,
      remoteRunId: undefined,
      remoteAutomationRunId: undefined,
      remoteAdvanceSchedule: undefined,
      advanceSchedule: meta.remoteAdvanceSchedule !== false,
    });
    console.log(
      `[recurring-jobs] Remote job "${resource.path}" reached ${remote.state}.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "Remote execution host could not be reached.";
    await finishRemoteAutomationHistory(meta, "failed", message).catch(
      () => undefined,
    );
    await recordExecutionOutcome(resource, {
      lastRun: meta.lastRun,
      lastStatus: "error",
      lastError: message,
      remoteRequestId: undefined,
      remoteCommandId: undefined,
      remoteRunId: undefined,
      remoteAutomationRunId: undefined,
      remoteAdvanceSchedule: undefined,
      advanceSchedule: meta.remoteAdvanceSchedule !== false,
    });
    console.error(
      `[recurring-jobs] Remote job "${resource.path}" failed:`,
      message,
    );
  }
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
    return recordIdentityFailure(
      resource,
      meta,
      body,
      now,
      identity.reason,
      options.historyId,
    );
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

  const prompt = options.manual
    ? `[Manual Automation Run: ${jobName}]\nThis run was explicitly started by the automation owner. Execute the following instructions now:\n\n${body}`
    : `[Recurring Job: ${jobName}]\nSchedule: ${describeCron(meta.schedule, effectiveTimezone(meta.timezone))}\n\nExecute the following job instructions:\n\n${body}`;

  if (meta.executionHostId) {
    try {
      const dispatch = await dispatchRemoteAutomation({
        resource,
        meta,
        body,
        ownerEmail: jobUserEmail,
        orgId: jobOrgId,
        appId: deps.appId,
        prompt,
        title: `${options.manual ? "Automation" : "Job"}: ${jobName}`,
        historyId: options.historyId,
        advanceSchedule: options.advanceSchedule,
        now,
      });
      console.log(
        `[recurring-jobs] Job "${jobName}" queued on remote host as ${dispatch.command.id}.`,
      );
      return { status: "success", runId: dispatch.command.id };
    } catch (err) {
      const lastError =
        err instanceof Error
          ? err.message.slice(0, 200)
          : "Remote dispatch failed";
      const reportedError = `${lastError}. No delivery was confirmed.`;
      await recordExecutionOutcome(resource, {
        lastRun: meta.lastRun,
        lastStatus: "error",
        lastError: reportedError,
        remoteRequestId: undefined,
        remoteCommandId: undefined,
        remoteRunId: undefined,
        remoteAutomationRunId: undefined,
        remoteAdvanceSchedule: undefined,
        advanceSchedule: options.advanceSchedule,
      });
      if (options.historyId) {
        await finishAutomationRun(options.historyId, "error", reportedError);
      }
      console.error(
        `[recurring-jobs] Job "${jobName}" remote dispatch failed:`,
        reportedError,
      );
      return { status: "error", error: reportedError };
    }
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
        prompt,
        threadTitle: `${options.manual ? "Automation" : "Job"}: ${jobName} — ${now.toLocaleDateString()}`,
        runIdPrefix: `${options.manual ? "manual" : "job"}-${jobName}`,
        usageLabel: `${options.manual ? "manual-automation" : "recurring-job"}:${jobName}`,
        requestContext,
        ...(options.historyId ? { historyId: options.historyId } : {}),
        actionCaller: "automation" as const,
        actionAutomation: {
          triggerId: resource.id,
          triggerName: jobName,
          ...(meta.delegatedPolicyId
            ? { policyId: meta.delegatedPolicyId }
            : {}),
        },
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
  options: { historyId?: string; path?: string } = {},
): Promise<JobExecutionResult> {
  const path = options.path ?? `jobs/${name}.md`;
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
  const queuedAppId = queued.appId?.trim() || null;
  const workerAppId = deps.appId?.trim() || null;
  if (queuedAppId && queuedAppId !== workerAppId) {
    return { skipped: true };
  }
  if (!(await claimAutomationRun(historyId))) {
    return { skipped: true };
  }
  const result = await runJobNow(queued.owner, queued.automation, deps, {
    historyId,
    path: queued.path,
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
  | "lastRun"
  | "lastCheck"
  | "lastStatus"
  | "lastError"
  | "remoteRequestId"
  | "remoteCommandId"
  | "remoteRunId"
  | "remoteAutomationRunId"
  | "remoteAdvanceSchedule"
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
