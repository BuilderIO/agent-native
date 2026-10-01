import {
  resourceGetByPath,
  resourceListAllOwners,
  resourcePutIfCurrent,
  type Resource,
} from "../resources/store.js";
import {
  countAutomationCredentialState,
  trackAutomationPaused,
  trackAutomationResumed,
} from "./automation-events.js";
import {
  applyAutomationFailure,
  classifyAutomationFailure,
  CLEAR_FAILURE_STATE,
  CONFIG_INVALID_ERROR_CODE,
  hasStalePause,
  isMissingCredentialCode,
  isPausedByFramework,
  isReservedIdentityBlocked,
  isTransientPauseProbeDue,
  OWNER_MISSING_ERROR_CODE,
  OWNER_RESERVED_ERROR_CODE,
  pauseNow,
  RESUME_AUTOMATION_PATCH,
  reservedIdentityMessage,
  runtimeFailureNextRun,
  TRANSIENT_PROBE_RESUME_PATCH,
  withDeliveryNote,
  type AutomationFailure,
} from "./automation-outcome.js";
import {
  backgroundRunCutOffReason,
  checkBackgroundAutomationCredentials,
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
  isRecoveredFactoryJob,
  jobBelongsToApp,
  parseJobResource,
  patchJobFrontmatterFields,
  recoveredFactoryOwnerOrgId,
  type JobFrontmatter,
  type JobFrontmatterPatch,
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
import { reapStaleWork } from "./stale-reaper.js";

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

export type RecurringJobContext = BackgroundAutomationContext;

export interface SchedulerDeps extends BackgroundAutomationDeps {
  getInitialToolNames?: (job?: RecurringJobContext) => string[] | undefined;
}

const MAX_CONCURRENT_SCHEDULED_JOBS = 8;
const MAX_IDENTITY_PREFLIGHTS_PER_TICK = MAX_CONCURRENT_SCHEDULED_JOBS * 4;
const IDENTITY_FAILURE_RETRY_MS = 5 * 60_000;
const MAX_PAUSED_RECHECKS_PER_TICK = 8;
const PAUSED_RECHECK_MS = 15 * 60_000;
const _activeScheduledJobs = new Set<string>();
const _preflightingScheduledJobs = new Set<string>();

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
  let shouldThrowReleaseError = false;
  let releaseErrorToThrow: unknown;
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
      if (!primaryFailed) {
        shouldThrowReleaseError = true;
        releaseErrorToThrow = releaseError;
      }
    }
  }
  if (shouldThrowReleaseError) throw releaseErrorToThrow;
}

async function processRecurringJobsWithLease(
  deps: SchedulerDeps,
): Promise<void> {
  subscribeToJobsResourceEvents();

  try {
    const { runUploadReceiptCleanupOnce } =
      await import("../file-upload/actions/upload-image.js");
    await runUploadReceiptCleanupOnce();
  } catch (error) {
    console.error("[recurring-jobs] Upload receipt cleanup failed:", error);
  }

  // Throttled and row-capped inside; runs here, not at startup, so a cold
  // start does no sweeping.
  try {
    const reaped = await reapStaleWork();
    if (reaped && (reaped.automationRuns > 0 || reaped.a2aTasks > 0)) {
      console.warn(
        `[recurring-jobs] Closed ${reaped.automationRuns} stale automation run(s) and ${reaped.a2aTasks} stale A2A task(s).`,
      );
    }
  } catch (error) {
    console.error("[recurring-jobs] Stale work reaper failed:", error);
  }

  const nowMs = Date.now();
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
    const pausedRechecks: PausedRecheck[] = [];

    for (const resource of jobResources) {
      if (!resource.path.endsWith(".md")) continue;
      if (resource.path.endsWith(".keep")) continue;

      const { meta, body } = parseJobFrontmatter(resource.content);
      if (
        !jobBelongsToApp(meta, deps.appId) &&
        !isRecoveredFactoryJob(meta, resource.path, deps.appId, resource.owner)
      ) {
        continue;
      }
      healthOrgIds.add(
        recoveredFactoryOwnerOrgId(meta, resource.path, resource.owner) ??
          meta.orgId ??
          null,
      );

      // Whoever flipped `enabled` left the old pause fields behind: the owner
      // lifted the pause, so the job starts from a clean slate.
      if (hasStalePause(meta)) {
        await clearPauseFields(resource, meta, body);
        continue;
      }

      // Settled before the pause check: "Run now" on a paused job leaves it
      // `running`, and only these branches finish that run.
      if (meta.lastStatus === "running" && meta.executionHostId) {
        await reconcileRemoteJob(resource, meta, now);
        continue;
      }

      if (meta.lastStatus === "running") {
        if (isBackgroundAutomationRunActive(meta, now)) continue;
        meta.lastStatus = "error";
        meta.lastError =
          "Worker stopped before a terminal result was recorded. The serverless worker may have timed out or been recycled. No delivery was confirmed.";
        if (meta.schedule && isValidCron(meta.schedule)) {
          meta.nextRun = nextOccurrence(
            meta.schedule,
            now,
            meta.timezone,
          ).toISOString();
        }
        if (await updateResource(resource, meta, body)) {
          await recoverStaleAutomationHistory(resource.owner, resource.path);
        }
        continue;
      }

      if (isPausedByFramework(meta)) {
        const kind = isTransientPauseProbeDue(meta, now)
          ? "probe"
          : isMissingCredentialCode(meta.pausedReason) &&
              isRecheckDue(meta, now)
            ? "credential"
            : null;
        if (kind && pausedRechecks.length < MAX_PAUSED_RECHECKS_PER_TICK) {
          pausedRechecks.push({ kind, resource, meta, body });
        }
        continue;
      }

      if (!meta.enabled || !meta.schedule) continue;
      if (!isValidCron(meta.schedule)) continue;

      if (meta.nextRun) {
        const nextRunDate = new Date(meta.nextRun);
        if (nextRunDate > now) continue;
      } else {
        const next = nextOccurrence(meta.schedule, now, meta.timezone);
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);
        continue;
      }

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
          // A gone owner or a broken identity config will not heal on its own,
          // so the job is disabled once with the reason. An owner that merely
          // could not be verified is retried after a cooldown.
          if (
            identity.code === OWNER_MISSING_ERROR_CODE ||
            identity.code === CONFIG_INVALID_ERROR_CODE
          ) {
            await disableAutomation(candidate.resource, candidate.meta, now, {
              code: identity.code,
              message: identity.reason,
              precondition: true,
            });
            continue;
          }
          await recordIdentityFailure(
            candidate.resource,
            candidate.meta,
            candidate.body,
            now,
            identity.reason,
          );
          continue;
        }
        if (isReservedIdentityBlocked(identity.identity.userEmail)) {
          await disableAutomation(candidate.resource, candidate.meta, now, {
            code: OWNER_RESERVED_ERROR_CODE,
            message: reservedIdentityMessage(identity.identity.userEmail),
            precondition: true,
          });
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

    await resumeRecoveredPauses(pausedRechecks, deps, now);

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
    const { isConnectionError } = await import("../db/client.js");
    if (isConnectionError(err)) {
      healthError = "The scheduler could not reach the database.";
      _hasJobsCache = undefined;
      _lastJobsCheck = 0;
      return;
    }
    const detail =
      err instanceof Error
        ? err
        : ((err as any)?.error ?? (err as any)?.message ?? err);
    healthError = detail instanceof Error ? detail.message : String(detail);
    console.error("[recurring-jobs] Error processing jobs:", detail);
  } finally {
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
      "background_automation_interrupted",
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
  const alreadyRecorded =
    meta.lastError === reason && hasRecentIdentityFailure(meta, now);
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

function jobNameOf(resource: Resource): string {
  return resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function isRecheckDue(meta: JobFrontmatter, now: Date): boolean {
  const lastCheckMs = meta.lastCheck ? Date.parse(meta.lastCheck) : Number.NaN;
  return (
    !Number.isFinite(lastCheckMs) ||
    now.getTime() - lastCheckMs >= PAUSED_RECHECK_MS
  );
}

/**
 * Disables a job whose precondition failed before any run could start.
 * Nothing ran, so nothing is written but the job's own frontmatter: no thread,
 * no `agent_runs` row, and no history row.
 */
async function disableAutomation(
  resource: Resource,
  meta: JobFrontmatter,
  now: Date,
  failure: AutomationFailure,
): Promise<void> {
  console.warn(
    `[recurring-jobs] Disabling job "${jobNameOf(resource)}" (${failure.code}): ${failure.message}`,
  );
  const written = await updateResource(
    resource,
    { ...meta, lastCheck: now.toISOString() },
    "",
    pauseNow(failure, now).patch,
  );
  if (written) {
    trackAutomationPaused({
      name: jobNameOf(resource),
      failure,
      consecutiveFailures: 1,
      surface: "preflight",
    });
  }
}

async function clearPauseFields(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
): Promise<void> {
  await updateResource(resource, meta, body, RESUME_AUTOMATION_PATCH);
}

interface PausedRecheck {
  /** `probe`: a transient pause whose backoff elapsed; `credential`: an absent credential. */
  kind: "probe" | "credential";
  resource: Resource;
  meta: JobFrontmatter;
  body: string;
}

function nextRunAfterResume(meta: JobFrontmatter, now: Date) {
  return meta.schedule && isValidCron(meta.schedule)
    ? nextOccurrence(meta.schedule, now, meta.timezone).toISOString()
    : meta.nextRun;
}

/**
 * A job paused for an absent credential resumes by itself once its run
 * identity can reach an LLM, so connecting a provider is the whole fix
 * (checked at most every 15 minutes per job). A transient pause (spent
 * credits, a provider or platform outage) is lifted for one probe run once
 * its backoff elapses. A few jobs per tick.
 */
async function resumeRecoveredPauses(
  paused: PausedRecheck[],
  deps: SchedulerDeps,
  now: Date,
): Promise<void> {
  for (const { kind, resource, meta, body } of paused) {
    try {
      if (kind === "probe") {
        if (
          await updateResource(
            resource,
            { ...meta, nextRun: nextRunAfterResume(meta, now) },
            body,
            TRANSIENT_PROBE_RESUME_PATCH,
          )
        ) {
          console.log(
            `[recurring-jobs] Probing "${jobNameOf(resource)}" again after its ${meta.pausedReason} pause.`,
          );
        }
        continue;
      }
      const identity = await resolveBackgroundAutomationIdentity({
        name: jobNameOf(resource),
        meta,
        body,
        resource,
      });
      const recovered =
        identity.ok &&
        (
          await checkBackgroundAutomationCredentials(
            {
              ownerEmail: identity.identity.userEmail,
              orgId: identity.identity.orgId,
            },
            deps,
          )
        ).ok;
      if (!recovered) {
        await updateResource(
          resource,
          { ...meta, lastCheck: now.toISOString() },
          body,
        );
        continue;
      }
      if (
        await updateResource(
          resource,
          { ...meta, nextRun: nextRunAfterResume(meta, now) },
          body,
          { ...RESUME_AUTOMATION_PATCH, enabled: true },
        )
      ) {
        console.log(
          `[recurring-jobs] Resumed "${jobNameOf(resource)}": its LLM credential is available again.`,
        );
        trackAutomationResumed({
          name: jobNameOf(resource),
          via: "credential_recovered",
        });
      }
    } catch (error) {
      console.warn(
        `[recurring-jobs] Could not recheck paused job "${jobNameOf(resource)}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }
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
    await recordExecutionOutcome(
      resource,
      {
        lastRun: meta.lastRun,
        lastStatus: remote.state === "completed" ? "success" : "error",
        lastError: error,
        remoteRequestId: undefined,
        remoteCommandId: undefined,
        remoteRunId: undefined,
        remoteAutomationRunId: undefined,
        remoteAdvanceSchedule: undefined,
        advanceSchedule: meta.remoteAdvanceSchedule !== false,
      },
      remote.state === "completed"
        ? undefined
        : {
            failure: {
              code: "remote_execution_failed",
              message: error ?? "The remote execution host failed.",
              precondition: false,
            },
            // A "Run now" dispatch does not advance the schedule; like a local
            // manual run, it never moves the streak.
            countTowardPause: meta.remoteAdvanceSchedule !== false,
          },
    );
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
    await recordExecutionOutcome(
      resource,
      {
        lastRun: meta.lastRun,
        lastStatus: "error",
        lastError: message,
        remoteRequestId: undefined,
        remoteCommandId: undefined,
        remoteRunId: undefined,
        remoteAutomationRunId: undefined,
        remoteAdvanceSchedule: undefined,
        advanceSchedule: meta.remoteAdvanceSchedule !== false,
      },
      {
        failure: {
          code: "remote_execution_unavailable",
          message,
          precondition: false,
        },
        countTowardPause: meta.remoteAdvanceSchedule !== false,
      },
    );
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
      await recordExecutionOutcome(
        resource,
        {
          lastRun: meta.lastRun,
          lastStatus: "error",
          lastError: reportedError,
          remoteRequestId: undefined,
          remoteCommandId: undefined,
          remoteRunId: undefined,
          remoteAutomationRunId: undefined,
          remoteAdvanceSchedule: undefined,
          advanceSchedule: options.advanceSchedule,
        },
        {
          failure: {
            code: "remote_dispatch_failed",
            message: lastError,
            precondition: false,
          },
          countTowardPause: !options.manual,
        },
      );
      if (options.historyId) {
        await finishAutomationRun(
          options.historyId,
          "error",
          reportedError,
          "remote_dispatch_failed",
        );
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
        ...(options.manual ? { manual: true } : {}),
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
    const failure = classifyAutomationFailure(err);
    const reportedError = withDeliveryNote(failure.message);
    await recordExecutionOutcome(
      resource,
      {
        lastRun: meta.lastRun,
        lastStatus: "error",
        lastError: reportedError,
        advanceSchedule: options.advanceSchedule,
      },
      { failure, countTowardPause: !options.manual },
    );
    console.error(
      `[recurring-jobs] Job "${jobName}" failed (${failure.code}):`,
      reportedError,
    );
    return { status: "error", error: reportedError };
  }
}

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
  _body: string,
  extra: JobFrontmatterPatch = {},
): Promise<boolean> {
  const content = patchJobFrontmatterFields(resource.content, {
    lastRun: meta.lastRun,
    lastCheck: meta.lastCheck,
    lastStatus: meta.lastStatus,
    lastError: meta.lastError,
    nextRun: meta.nextRun,
    remoteRequestId: meta.remoteRequestId,
    remoteCommandId: meta.remoteCommandId,
    remoteRunId: meta.remoteRunId,
    remoteAutomationRunId: meta.remoteAutomationRunId,
    remoteAdvanceSchedule: meta.remoteAdvanceSchedule,
    ...extra,
  });
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

interface ExecutionFailure {
  failure: AutomationFailure;
  /** A manual run records its cause but never pauses the automation. */
  countTowardPause: boolean;
}

async function recordExecutionOutcome(
  resource: Resource,
  outcome: ExecutionOutcome,
  failed?: ExecutionFailure,
): Promise<void> {
  const latest = await resourceGetByPath(resource.owner, resource.path);
  if (!latest) {
    console.log(
      `[recurring-jobs] "${resource.path}" was deleted mid-run; dropping its outcome.`,
    );
    return;
  }
  if (latest.id !== resource.id) {
    console.log(
      `[recurring-jobs] "${resource.path}" was replaced mid-run; dropping its outcome.`,
    );
    return;
  }
  const current = parseJobResource(latest.content);

  const { advanceSchedule, ...execution } = outcome;
  const meta: JobFrontmatter = { ...current.meta, ...execution };
  const now = new Date();
  let extra: JobFrontmatterPatch = {};
  let resumed = false;
  let pausedAfter: number | undefined;
  if (failed) {
    const transition = applyAutomationFailure(
      current.meta,
      failed.failure,
      now,
      { countTowardPause: failed.countTowardPause },
    );
    extra = transition.patch;
    if (transition.pause) {
      pausedAfter = transition.consecutiveFailures;
      console.warn(
        `[recurring-jobs] Paused "${resource.path}" after ${transition.consecutiveFailures} consecutive ${failed.failure.code} failures: ${failed.failure.message}`,
      );
    }
  } else if (outcome.lastStatus === "success") {
    // A successful run proves the cause is gone: an automation the framework
    // paused (this can only be a manual run) resumes with a clean slate.
    resumed = isPausedByFramework(current.meta);
    extra = resumed
      ? { ...CLEAR_FAILURE_STATE, enabled: true }
      : CLEAR_FAILURE_STATE;
  }
  if (
    (advanceSchedule !== false || resumed) &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    meta.nextRun = nextOccurrence(
      meta.schedule,
      now,
      meta.timezone,
    ).toISOString();
    if (failed && failed.countTowardPause && !failed.failure.precondition) {
      const count = Number(extra.consecutiveFailures ?? 1);
      meta.nextRun = runtimeFailureNextRun(
        new Date(meta.nextRun),
        now,
        count,
      ).toISOString();
    }
  }
  if (!(await updateResource(latest, meta, current.body, extra))) {
    console.log(
      `[recurring-jobs] "${resource.path}" changed while its outcome was being recorded; dropping the outcome.`,
    );
    return;
  }
  if (failed) countAutomationCredentialState(failed.failure.code);
  if (failed && pausedAfter !== undefined) {
    trackAutomationPaused({
      name: jobNameOf(resource),
      failure: failed.failure,
      consecutiveFailures: pausedAfter,
      surface: "scheduler",
    });
  }
  if (resumed) {
    trackAutomationResumed({
      name: jobNameOf(resource),
      via: "successful_run",
    });
  }
}
