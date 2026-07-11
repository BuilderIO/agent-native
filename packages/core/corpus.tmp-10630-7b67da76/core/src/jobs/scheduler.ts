import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import {
  getStoredModelForEngine,
  normalizeModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import type { AgentEngine } from "../agent/engine/types.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  filterInitialEngineTools,
  getOwnerActiveApiKey,
  type ActionEntry,
} from "../agent/production-agent.js";
import { startRun, resolveRunSoftTimeoutMs } from "../agent/run-manager.js";
import { attachToolSearch } from "../agent/tool-search.js";
import { createThread } from "../chat-threads/store.js";
import {
  organizationIdFromResourceOwner,
  resourceListAllOwners,
  resourcePut,
  type Resource,
} from "../resources/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import { nextOccurrence, isValidCron, describeCron } from "./cron.js";

// ─── Frontmatter parsing ────────────────────────────────────────────────────

export interface JobFrontmatter {
  schedule: string;
  enabled: boolean;
  createdBy?: string;
  orgId?: string;
  runAs?: "creator" | "shared";
  lastRun?: string;
  lastStatus?: "success" | "error" | "running" | "skipped";
  lastError?: string;
  nextRun?: string;
  originScopeId?: string;
  deliveryPlatform?: string;
  deliveryDestination?: string;
  deliveryThreadRef?: string;
  deliveryTenantId?: string;
  model?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseJobFrontmatter(content: string): {
  meta: JobFrontmatter;
  body: string;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      meta: { schedule: "", enabled: false },
      body: content,
    };
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const meta: JobFrontmatter = { schedule: "", enabled: true };

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case "schedule":
        meta.schedule = value;
        break;
      case "enabled":
        meta.enabled = value !== "false";
        break;
      case "createdBy":
        meta.createdBy = value;
        break;
      case "orgId":
        meta.orgId = value;
        break;
      case "runAs":
        meta.runAs =
          value === "shared" || value === "creator" ? value : undefined;
        break;
      case "lastRun":
        meta.lastRun = value;
        break;
      case "lastStatus":
        meta.lastStatus = value as JobFrontmatter["lastStatus"];
        break;
      case "lastError":
        // Reverse the escaping applied in buildJobContent.
        meta.lastError = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        break;
      case "nextRun":
        meta.nextRun = value;
        break;
      case "originScopeId":
        meta.originScopeId = value;
        break;
      case "deliveryPlatform":
        meta.deliveryPlatform = value;
        break;
      case "deliveryDestination":
        meta.deliveryDestination = value;
        break;
      case "deliveryThreadRef":
        meta.deliveryThreadRef = value;
        break;
      case "deliveryTenantId":
        meta.deliveryTenantId = value;
        break;
      case "model":
        meta.model = value;
        break;
    }
  }

  return { meta, body };
}

export function buildJobContent(meta: JobFrontmatter, body: string): string {
  const lines = [`---`];
  lines.push(`schedule: "${meta.schedule}"`);
  lines.push(`enabled: ${meta.enabled}`);
  if (meta.createdBy) lines.push(`createdBy: ${meta.createdBy}`);
  if (meta.orgId) lines.push(`orgId: ${meta.orgId}`);
  if (meta.runAs) lines.push(`runAs: ${meta.runAs}`);
  if (meta.lastRun) lines.push(`lastRun: ${meta.lastRun}`);
  if (meta.lastStatus) lines.push(`lastStatus: ${meta.lastStatus}`);
  if (meta.lastError) {
    // Escape backslash, quote, then CR/LF. The frontmatter parser splits on
    // "\n", so an un-escaped newline (common in stack traces) would otherwise
    // split the value across lines and corrupt/truncate the stored error.
    const escaped = meta.lastError
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
    lines.push(`lastError: "${escaped}"`);
  }
  if (meta.nextRun) lines.push(`nextRun: ${meta.nextRun}`);
  if (meta.originScopeId) lines.push(`originScopeId: ${meta.originScopeId}`);
  if (meta.deliveryPlatform)
    lines.push(`deliveryPlatform: ${meta.deliveryPlatform}`);
  if (meta.deliveryDestination)
    lines.push(`deliveryDestination: ${meta.deliveryDestination}`);
  if (meta.deliveryThreadRef)
    lines.push(`deliveryThreadRef: ${meta.deliveryThreadRef}`);
  if (meta.deliveryTenantId)
    lines.push(`deliveryTenantId: ${meta.deliveryTenantId}`);
  if (meta.model) lines.push(`model: ${meta.model}`);
  lines.push(`---`);
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

// ─── Job execution ──────────────────────────────────────────────────────────

export interface SchedulerDeps {
  getActions: () => Record<string, ActionEntry>;
  getSystemPrompt: (owner: string) => Promise<string>;
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
  getInitialToolNames?: () => string[] | undefined;
  /** Optional engine override. Defaults to the resolved request engine. */
  engine?: AgentEngine;
  apiKey?: string;
  model?: string;
  /** App/template id used for org-scoped per-app model defaults. */
  appId?: string;
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

      // Skip disabled or missing schedule
      if (!meta.enabled || !meta.schedule) continue;
      if (!isValidCron(meta.schedule)) continue;

      // Skip if currently running, unless it has been stuck for more than 10 minutes
      // (server crash mid-job leaves lastStatus=running forever without this guard)
      if (meta.lastStatus === "running") {
        const stuckCutoff = 10 * 60 * 1000;
        if (
          meta.lastRun &&
          now.getTime() - new Date(meta.lastRun).getTime() < stuckCutoff
        ) {
          continue;
        }
        // Stuck — reset so the next check can re-run it
        meta.lastStatus = "error";
        meta.lastError = "Job timed out or server crashed mid-run";
        const next = nextOccurrence(meta.schedule, now);
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
        const next = nextOccurrence(meta.schedule, now);
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

/**
 * Validate that the run-as user still exists and (if scoped to an org) is
 * still a member of that org. Skips the check for the dev-mode bypass
 * identity and the shared-owner sentinel, neither of which map to a real
 * user row.
 *
 * SECURITY: without this check the scheduler keeps running jobs as
 * `meta.createdBy` indefinitely — even after the user has been deleted,
 * removed from the org, or had their account disabled. The cron entry
 * itself is left intact so an admin can purge it manually after the
 * underlying user-state issue is investigated. See audit 12 #10.
 */
async function isJobRunAsStillValid(
  jobUserEmail: string,
  jobOrgId: string | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  // Shared-owner sentinel isn't a real user (used by jobs run as the
  // workspace identity).
  if (
    jobUserEmail === "__shared__" ||
    organizationIdFromResourceOwner(jobUserEmail)
  ) {
    return { ok: true };
  }
  try {
    const { getDbExec } = await import("../db/client.js");
    const db = getDbExec();
    // Better Auth's user table is named "user" (singular). The reserved
    // word is quoted to avoid ambiguity in Postgres.
    const userResult = await db.execute({
      sql: `SELECT 1 FROM "user" WHERE email = ? LIMIT 1`,
      args: [jobUserEmail],
    });
    if (!userResult.rows || userResult.rows.length === 0) {
      return { ok: false, reason: `user "${jobUserEmail}" no longer exists` };
    }
    if (jobOrgId) {
      const memberResult = await db.execute({
        sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) LIMIT 1`,
        args: [jobOrgId, jobUserEmail],
      });
      if (!memberResult.rows || memberResult.rows.length === 0) {
        return {
          ok: false,
          reason: `user "${jobUserEmail}" is no longer a member of org "${jobOrgId}"`,
        };
      }
    }
    return { ok: true };
  } catch (err: any) {
    // Tables may not exist on a brand-new install (no auth tables yet).
    // Treat that as "valid" rather than blocking every job. The check is
    // only meaningful once the auth tables exist.
    const msg = err?.message?.toLowerCase() ?? "";
    if (
      msg.includes("does not exist") ||
      msg.includes("no such table") ||
      msg.includes("undefined table")
    ) {
      return { ok: true };
    }
    // Any other DB error: be conservative and let the job run rather than
    // blocking on an unexpected failure mode (e.g. transient connection
    // issue). We log so it's visible.
    console.warn(
      `[recurring-jobs] User/membership validation failed for "${jobUserEmail}":`,
      err?.message,
    );
    return { ok: true };
  }
}

async function executeJob(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
  deps: SchedulerDeps,
  now: Date,
): Promise<void> {
  const jobName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");

  // Set owner context so all scoped operations (app-state, resources, etc.)
  // operate on the correct user's data
  const effectiveRunAs = meta.runAs ?? "creator";
  const jobUserEmail =
    effectiveRunAs === "creator"
      ? meta.createdBy || resource.owner
      : resource.owner;
  const jobOrgId = meta.orgId ?? undefined;

  // SECURITY (audit 12 #10): re-validate the run-as user/membership on
  // every tick. Sharing revocation, user deletion, and org-member removal
  // must take effect for already-scheduled jobs. Skip the tick on
  // failure; leave the cron entry alone so an admin can purge after
  // investigation.
  const validity = await isJobRunAsStillValid(jobUserEmail, jobOrgId);
  if (!validity.ok) {
    console.warn(
      `[recurring-jobs] Skipping job "${jobName}": ${validity.reason}. ` +
        `User/membership no longer valid — leaving cron entry for admin review.`,
    );
    // Mark as skipped without resetting nextRun so an admin can find it.
    meta.lastRun = now.toISOString();
    meta.lastStatus = "skipped";
    meta.lastError = validity.reason;
    await updateResource(resource, meta, body);
    return;
  }

  // Mark as running
  meta.lastRun = now.toISOString();
  meta.lastStatus = "running";
  meta.lastError = undefined;
  await updateResource(resource, meta, body);

  await runWithRequestContext(
    {
      userEmail: jobUserEmail,
      orgId: jobOrgId,
      ...(meta.originScopeId &&
      meta.deliveryPlatform &&
      meta.deliveryDestination
        ? {
            isIntegrationCaller: true,
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
        : {}),
    },
    async () => {
      try {
        const baseActions = deps.getActions();
        const systemPrompt = await deps.getSystemPrompt(jobUserEmail);
        const initialToolNames = deps.getInitialToolNames?.();
        // Only attach tool-search (and pay its schema cost) when the caller
        // actually supplied an initial subset to filter down to — otherwise
        // this is byte-for-byte the prior unfiltered behavior.
        const actions = initialToolNames
          ? attachToolSearch({ ...baseActions })
          : baseActions;
        const availableTools = actionsToEngineTools(actions);
        const tools = filterInitialEngineTools(
          availableTools,
          initialToolNames,
        );

        // Prefer the job runner's saved Anthropic key so recurring jobs
        // don't silently bill the shared platform key once a user has
        // brought their own. Falls back to the platform key when absent.
        const userApiKey = await getOwnerActiveApiKey(jobUserEmail);
        const engine =
          deps.engine ??
          (await resolveEngine({
            apiKey: userApiKey ?? deps.apiKey,
            appId: deps.appId,
          }));
        const modelCandidate =
          meta.model ??
          deps.model ??
          (await getStoredModelForEngine(engine, { appId: deps.appId })) ??
          engine.defaultModel;
        const model = normalizeModelForEngine(engine, modelCandidate);

        // Create a chat thread for this run
        const threadTitle = `Job: ${jobName} — ${now.toLocaleDateString()}`;
        const thread = await createThread(jobUserEmail, { title: threadTitle });

        const jobText = `[Recurring Job: ${jobName}]\nSchedule: ${describeCron(meta.schedule)}\n\nExecute the following job instructions:\n\n${body}`;
        const messages = [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: jobText }],
          },
        ];

        // Route through startRun (from run-manager) instead of calling
        // runAgentLoop directly. This adds:
        //   1. A heartbeat row in agent_runs so a serverless kill is detected
        //      by reapAllStaleRuns on the next startup and the row is flipped
        //      to 'errored' — no more stranded lastStatus:"running" in the job
        //      frontmatter after the next tick resets it via the stuck-guard.
        //   2. The soft-timeout infrastructure so the job checkpoints cleanly
        //      before serverless hard-kill rather than dying mid-flight.
        //   3. SQL abort checks so a displaced/reaped run self-aborts instead
        //      of completing invisibly and potentially overwriting newer state.
        const runId = `job-${jobName.replace(/[^a-zA-Z0-9._-]/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Use the same soft-timeout logic as interactive runs. On hosted
        // runtimes this clamps to 40s (under the gateway wall); locally it
        // defaults to 0 (no framework timeout). The 5-minute hard-abort
        // below is still provided as a backstop via the startRun signal.
        const softTimeoutMs = resolveRunSoftTimeoutMs(undefined, {
          useHostedDefault: true,
        });

        let jobError: Error | null = null;
        // Hard-abort backstop: 5 minutes. On hosted runtimes the soft-timeout
        // will fire first; locally this is the only guard. Cleared when the
        // run completes so finished jobs don't leave a live timer keeping the
        // process/event loop alive for the remainder of the window.
        let hardAbortTimer: ReturnType<typeof setTimeout> | null = null;
        const jobUsageRef: {
          current: Awaited<ReturnType<typeof runAgentLoop>> | null;
        } = { current: null };
        let responseText = "";
        await new Promise<void>((resolve, reject) => {
          const activeRun = startRun(
            runId,
            thread.id,
            async (send, signal) => {
              try {
                jobUsageRef.current = await runAgentLoop({
                  engine,
                  model,
                  systemPrompt,
                  tools,
                  availableTools,
                  messages,
                  actions,
                  send,
                  signal,
                  threadId: thread.id,
                });
              } catch (err) {
                throw err;
              }
            },
            // onComplete: run finished (completed or aborted)
            async (run) => {
              if (hardAbortTimer) {
                clearTimeout(hardAbortTimer);
                hardAbortTimer = null;
              }
              if (run.status === "completed") {
                responseText = collectFinalResponseTextFromAgentEvents(
                  (run.events ?? []).map((event) => event.event),
                );
                resolve();
              } else {
                reject(new Error(`Job run ended with status: ${run.status}`));
              }
            },
            {
              softTimeoutMs,
              // turnId defaults to runId — fine for single-turn jobs
            },
          );

          // Abort the run-manager's own controller after 5 minutes if the
          // run hasn't finished naturally.
          hardAbortTimer = setTimeout(
            () => {
              hardAbortTimer = null;
              if (activeRun.status === "running") {
                activeRun.abort.abort("job_hard_timeout");
                reject(new Error("Job timed out after 5 minutes"));
              }
            },
            5 * 60 * 1000,
          );
        }).catch((err: any) => {
          jobError = err;
        });
        if (hardAbortTimer) {
          clearTimeout(hardAbortTimer);
          hardAbortTimer = null;
        }

        if (jobError) throw jobError;

        if (
          responseText.trim() &&
          meta.deliveryPlatform &&
          meta.deliveryDestination
        ) {
          const { getDefaultAdapter } =
            await import("../integrations/adapters/index.js");
          const adapter = getDefaultAdapter(meta.deliveryPlatform);
          if (!adapter?.sendMessageToTarget) {
            throw new Error(
              `Recurring job delivery is not supported for ${meta.deliveryPlatform}`,
            );
          }
          await adapter.sendMessageToTarget(
            adapter.formatAgentResponse(responseText),
            {
              destination: meta.deliveryDestination,
              threadRef: meta.deliveryThreadRef ?? null,
              tenantId: meta.deliveryTenantId,
            },
          );
        }

        const jobUsage = jobUsageRef.current;
        if (
          jobUsage &&
          (jobUsage.inputTokens > 0 ||
            jobUsage.outputTokens > 0 ||
            jobUsage.cacheReadTokens > 0 ||
            jobUsage.cacheWriteTokens > 0)
        ) {
          try {
            const { recordUsage } = await import("../usage/store.js");
            await recordUsage({
              ownerEmail: jobUserEmail,
              inputTokens: jobUsage.inputTokens,
              outputTokens: jobUsage.outputTokens,
              cacheReadTokens: jobUsage.cacheReadTokens,
              cacheWriteTokens: jobUsage.cacheWriteTokens,
              model: jobUsage.model,
              label: `recurring-job:${jobName}`,
              app: deps.appId,
              refId: runId,
            });
          } catch {
            // Usage attribution must not break the scheduled task.
          }
        }

        // Success — update status. Compute the next run from completion time,
        // not the job's start time `now`: a long run could otherwise schedule a
        // nextRun that's already in the past and re-fire immediately next tick.
        const next = nextOccurrence(meta.schedule, new Date());
        meta.lastStatus = "success";
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);

        console.log(
          `[recurring-jobs] Job "${jobName}" completed. Next run: ${meta.nextRun}`,
        );
      } catch (err: any) {
        // Error — update status. Use completion time (see success path).
        const next = nextOccurrence(meta.schedule, new Date());
        meta.lastStatus = "error";
        meta.lastError = err?.message?.slice(0, 200) || "Unknown error";
        meta.nextRun = next.toISOString();
        await updateResource(resource, meta, body);

        console.error(
          `[recurring-jobs] Job "${jobName}" failed:`,
          err?.message,
        );
      }
    },
  ); // end runWithRequestContext
}

async function updateResource(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
): Promise<void> {
  const content = buildJobContent(meta, body);
  await resourcePut(resource.owner, resource.path, content);
}
