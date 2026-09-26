import type { ActionEntry } from "../agent/production-agent.js";
import { DEFAULT_AUTOMATION_SCHEDULE } from "../automations/service.js";
import { getDbExec } from "../db/client.js";
import { resolveUserSchedulingTimezone } from "../localization/user-timezone.js";
import {
  resourcePut,
  resourceGetByPath,
  resourceList,
  resourceDelete,
  organizationIdFromResourceOwner,
  sharedResourceOwner,
  SHARED_OWNER,
} from "../resources/store.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
  getIntegrationRequestContext,
} from "../server/request-context.js";
import {
  isReasoningEffort,
  REASONING_EFFORTS,
} from "../shared/reasoning-effort.js";
import {
  isValidCron,
  nextOccurrence,
  describeCron,
  effectiveTimezone,
  isValidTimezone,
} from "./cron.js";
import {
  assertJobExecutionTargetFields,
  classifyJobResource,
  jobBelongsToApp,
  patchJobFrontmatterFields,
  replaceJobResourceBody,
  type JobFrontmatterPatch,
} from "./frontmatter.js";
import {
  parseJobFrontmatter,
  buildJobContent,
  normalizeJobMcpTools,
  type JobFrontmatter,
} from "./scheduler.js";

export { jobBelongsToApp } from "./frontmatter.js";

function getOwner(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

function getSharedOwner(): string {
  return sharedResourceOwner(getRequestOrgId());
}

async function isCurrentUserOrgAdmin(
  orgId: string | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  const email = getRequestUserEmail();
  if (!email) return false;
  try {
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    if (rows.length === 0) return false;
    const role = String((rows[0] as any).role ?? "").toLowerCase();
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

/**
 * Authorise a mutation (update / delete) against a job resource. When the
 * job is in the SHARED scope the caller must either be the original
 * `createdBy` user or an org owner/admin — otherwise any user could rewrite
 * another user's shared job and have it run as that user on the next cron
 * tick (the privilege-escalation chain documented in audit
 * `/tmp/security-audit/12-mcp-a2a-agent.md`, finding #3).
 *
 * Returns null when the mutation is allowed, or an error string suitable
 * for returning to the caller when not.
 */
export async function authorizeJobMutation(
  resourceOwner: string,
  meta: JobFrontmatter,
  appId?: string,
): Promise<string | null> {
  if (!jobBelongsToApp(meta, appId)) {
    return "This job belongs to another app and cannot be changed here.";
  }
  const resourceOrgId = organizationIdFromResourceOwner(resourceOwner);
  if (resourceOwner !== SHARED_OWNER && !resourceOrgId) {
    // Personal-scope job — owner is the request's user. resourceGetByPath is
    // already scoped to the caller, so we know meta.createdBy must match.
    return null;
  }
  const caller = getOwner();
  const createdBy = meta.createdBy?.toLowerCase();
  if (createdBy && createdBy === caller.toLowerCase()) return null;

  const isAdmin = await isCurrentUserOrgAdmin(
    resourceOrgId ?? meta.orgId ?? getRequestOrgId() ?? undefined,
  );
  if (isAdmin) return null;

  return "Only the job's creator (or an org admin) can update or delete it.";
}

async function runCreate(
  args: Record<string, any>,
  appId?: string,
): Promise<string> {
  const {
    name,
    instructions,
    scope,
    runAs,
    model,
    reasoningEffort,
    executionHostId,
    executionEngine,
    executionCwd,
  } = args;
  const schedule =
    typeof args.schedule === "string" && args.schedule.trim()
      ? args.schedule.trim()
      : DEFAULT_AUTOMATION_SCHEDULE;
  const requestedTimezone = args.timezone;

  if (!name || !instructions) {
    return JSON.stringify({
      error: "name and instructions are required",
    });
  }

  if (!isValidCron(schedule)) {
    return JSON.stringify({
      error: `Invalid cron expression: "${schedule}". Use 5 fields: minute hour day-of-month month day-of-week.`,
    });
  }

  if (reasoningEffort !== undefined && !isReasoningEffort(reasoningEffort)) {
    return JSON.stringify({
      error: `Invalid reasoningEffort: "${reasoningEffort}". Use one of: ${REASONING_EFFORTS.join(", ")}.`,
    });
  }

  let mcpTools: string[] | undefined;
  try {
    mcpTools = normalizeJobMcpTools(args.mcpTools);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }

  const owner = scope === "personal" ? getOwner() : getSharedOwner();
  const path = `jobs/${name}.md`;
  const now = new Date();
  if (requestedTimezone && !isValidTimezone(requestedTimezone)) {
    return JSON.stringify({
      error: `Unknown timezone: "${requestedTimezone}". Use an IANA zone such as America/New_York.`,
    });
  }
  const timezone =
    requestedTimezone ||
    (await resolveUserSchedulingTimezone(getRequestUserEmail()));
  const next = nextOccurrence(schedule, now, timezone);
  const integration = getIntegrationRequestContext();
  const channelId = integration?.incoming.platformContext.channelId;
  const threadRef = integration?.incoming.threadRef;

  const meta: JobFrontmatter = {
    schedule,
    timezone,
    enabled: true,
    createdBy: getOwner(),
    orgId: getRequestOrgId() || undefined,
    appId: appId?.trim() || undefined,
    runAs: runAs === "shared" ? "shared" : "creator",
    nextRun: next.toISOString(),
    ...(integration?.scopeId ? { originScopeId: integration.scopeId } : {}),
    ...(integration?.incoming.platform
      ? { deliveryPlatform: integration.incoming.platform }
      : {}),
    ...(typeof channelId === "string"
      ? { deliveryDestination: channelId }
      : {}),
    ...(typeof threadRef === "string" ? { deliveryThreadRef: threadRef } : {}),
    ...(integration?.incoming.tenantId
      ? { deliveryTenantId: integration.incoming.tenantId }
      : {}),
    ...(typeof model === "string" && model.trim()
      ? { model: model.trim() }
      : {}),
    ...(isReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
    ...(typeof executionHostId === "string" && executionHostId.trim()
      ? { executionHostId: executionHostId.trim() }
      : {}),
    ...(typeof executionEngine === "string" && executionEngine.trim()
      ? { executionEngine: executionEngine.trim() }
      : {}),
    ...(typeof executionCwd === "string" && executionCwd.trim()
      ? { executionCwd: executionCwd.trim() }
      : {}),
    ...(mcpTools?.length ? { mcpTools } : {}),
  };

  const content = buildJobContent(meta, instructions);
  await resourcePut(owner, path, content);

  return JSON.stringify({
    created: true,
    name,
    path,
    schedule,
    timezone,
    scheduleDescription: describeCron(schedule, timezone),
    nextRun: next.toISOString(),
    scope: scope || "shared",
    ...(mcpTools?.length ? { mcpTools } : {}),
  });
}

async function runList(
  args: Record<string, any>,
  appId?: string,
): Promise<string> {
  const owner = getOwner();
  const sharedOwner = getSharedOwner();
  const [personal, shared] = await Promise.all([
    resourceList(owner, "jobs/"),
    resourceList(sharedOwner, "jobs/"),
  ]);
  let resources = [...personal, ...shared];
  if (args.scope === "personal") resources = personal;
  else if (args.scope === "shared") resources = shared;
  const metas = resources.filter(
    (r) => r.path.endsWith(".md") && !r.path.endsWith(".keep"),
  );
  const jobs = await Promise.all(
    metas.map(async (r) => {
      const full = await resourceGetByPath(r.owner, r.path);
      if (!full) return null;
      if (classifyJobResource(full.content).kind === "automation") return null;
      const { meta } = parseJobFrontmatter(full.content);
      if (!jobBelongsToApp(meta, appId)) return null;
      return {
        name: r.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
        path: r.path,
        scope: r.owner === sharedOwner ? "shared" : "personal",
        schedule: meta.schedule,
        timezone: effectiveTimezone(meta.timezone),
        scheduleDescription: meta.schedule
          ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
          : "",
        enabled: meta.enabled,
        lastRun: meta.lastRun || null,
        lastStatus: meta.lastStatus || null,
        lastError: meta.lastError || null,
        nextRun: meta.nextRun || null,
        originScopeId: meta.originScopeId || null,
        deliveryPlatform: meta.deliveryPlatform || null,
        deliveryDestination: meta.deliveryDestination || null,
        model: meta.model || null,
        reasoningEffort: meta.reasoningEffort || null,
        executionHostId: meta.executionHostId || null,
        executionEngine: meta.executionEngine || null,
        executionCwd: meta.executionCwd || null,
        mcpTools: meta.mcpTools || [],
      };
    }),
  );
  const scheduledJobs = jobs.filter((job) => job !== null);

  if (scheduledJobs.length === 0) {
    return "No recurring jobs configured. Use manage-jobs with action 'create' to create one.";
  }

  return JSON.stringify(scheduledJobs, null, 2);
}

async function runUpdate(
  args: Record<string, any>,
  appId?: string,
): Promise<string> {
  const {
    name,
    schedule,
    instructions,
    enabled,
    scope,
    runAs,
    model,
    reasoningEffort,
    executionHostId,
    executionEngine,
    executionCwd,
  } = args;
  const path = `jobs/${name}.md`;

  let resource = await resourceGetByPath(getSharedOwner(), path);
  if (!resource && scope !== "shared") {
    resource = await resourceGetByPath(getOwner(), path);
  }

  if (!resource) {
    return JSON.stringify({ error: `Job "${name}" not found` });
  }

  const { meta } = parseJobFrontmatter(resource.content);
  if (classifyJobResource(resource.content).kind === "automation") {
    return JSON.stringify({
      error: `"${name}" is an automation. Use manage-automations to update it.`,
    });
  }

  const denied = await authorizeJobMutation(resource.owner, meta, appId);
  if (denied) {
    return JSON.stringify({ error: denied });
  }

  const fields: JobFrontmatterPatch = {};
  if (!meta.appId && appId?.trim()) {
    meta.appId = appId.trim();
    fields.appId = meta.appId;
  }

  if (schedule) {
    if (!isValidCron(schedule)) {
      return JSON.stringify({
        error: `Invalid cron expression: "${schedule}"`,
      });
    }
    meta.schedule = schedule;
    fields.schedule = schedule;
  }

  if (args.timezone !== undefined) {
    if (!isValidTimezone(args.timezone)) {
      return JSON.stringify({
        error: `Unknown timezone: "${args.timezone}".`,
      });
    }
    meta.timezone = args.timezone;
    fields.timezone = args.timezone;
  }

  if (schedule || args.timezone !== undefined) {
    meta.nextRun = nextOccurrence(
      meta.schedule,
      undefined,
      meta.timezone,
    ).toISOString();
    fields.nextRun = meta.nextRun;
  }

  if (enabled !== undefined) {
    meta.enabled = enabled === true || enabled === "true";
    fields.enabled = meta.enabled;
  }

  if (runAs === "creator" || runAs === "shared") {
    meta.runAs = runAs;
    fields.runAs = runAs;
  }
  if (typeof model === "string" && model.trim()) {
    meta.model = model.trim();
    fields.model = meta.model;
  }
  if (reasoningEffort !== undefined) {
    if (!isReasoningEffort(reasoningEffort)) {
      return JSON.stringify({
        error: `Invalid reasoningEffort: "${reasoningEffort}". Use one of: ${REASONING_EFFORTS.join(", ")}.`,
      });
    }
    meta.reasoningEffort = reasoningEffort;
    fields.reasoningEffort = reasoningEffort;
  }
  if (executionHostId !== undefined) {
    meta.executionHostId =
      typeof executionHostId === "string" && executionHostId.trim()
        ? executionHostId.trim()
        : undefined;
    fields.executionHostId = meta.executionHostId;
  }
  if (executionEngine !== undefined) {
    meta.executionEngine =
      typeof executionEngine === "string" && executionEngine.trim()
        ? executionEngine.trim()
        : undefined;
    fields.executionEngine = meta.executionEngine;
  }
  if (executionCwd !== undefined) {
    meta.executionCwd =
      typeof executionCwd === "string" && executionCwd.trim()
        ? executionCwd.trim()
        : undefined;
    fields.executionCwd = meta.executionCwd;
  }

  if (
    Object.hasOwn(fields, "executionHostId") ||
    Object.hasOwn(fields, "executionEngine") ||
    Object.hasOwn(fields, "executionCwd")
  ) {
    try {
      assertJobExecutionTargetFields(meta);
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  if (args.mcpTools !== undefined) {
    try {
      const mcpTools = normalizeJobMcpTools(args.mcpTools) ?? [];
      if (mcpTools.length) meta.mcpTools = mcpTools;
      else delete meta.mcpTools;
      fields.mcpTools = meta.mcpTools;
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  let content = patchJobFrontmatterFields(resource.content, fields);
  if (instructions) {
    content = replaceJobResourceBody(content, instructions);
  }
  await resourcePut(resource.owner, resource.path, content);

  return JSON.stringify({
    updated: true,
    name,
    schedule: meta.schedule,
    timezone: effectiveTimezone(meta.timezone),
    scheduleDescription: describeCron(
      meta.schedule,
      effectiveTimezone(meta.timezone),
    ),
    enabled: meta.enabled,
    nextRun: meta.nextRun,
    mcpTools: meta.mcpTools || [],
    reasoningEffort: meta.reasoningEffort || null,
    executionHostId: meta.executionHostId || null,
    executionEngine: meta.executionEngine || null,
    executionCwd: meta.executionCwd || null,
  });
}

async function runDelete(
  args: Record<string, any>,
  appId?: string,
): Promise<string> {
  const { name, scope } = args;
  const path = `jobs/${name}.md`;

  let resource = await resourceGetByPath(getSharedOwner(), path);
  if (!resource && scope !== "shared") {
    resource = await resourceGetByPath(getOwner(), path);
  }

  if (!resource) {
    return JSON.stringify({ error: `Job "${name}" not found` });
  }

  const { meta } = parseJobFrontmatter(resource.content);
  if (classifyJobResource(resource.content).kind === "automation") {
    return JSON.stringify({
      error: `"${name}" is an automation. Use manage-automations to delete it.`,
    });
  }
  const denied = await authorizeJobMutation(resource.owner, meta, appId);
  if (denied) {
    return JSON.stringify({ error: denied });
  }

  await resourceDelete(resource.id);
  return JSON.stringify({ deleted: true, name });
}

export function createJobTools(appId?: string): Record<string, ActionEntry> {
  return {
    "manage-jobs": {
      tool: {
        description: `Manage recurring jobs that run on a cron schedule.

Actions:
- "create": Create a new recurring job. Requires name and instructions; an omitted schedule defaults to once per hour.
- "list": List all recurring jobs and their status (schedule, enabled, last run, next run).
- "update": Update a job's schedule, instructions, or enabled state. Requires name.
- "delete": Delete a recurring job. Requires name. Always confirm with the user first.

Cron format is 5 fields: minute hour day-of-month month day-of-week. Common patterns: '0 9 * * *' (daily 9am), '0 9 * * 1-5' (weekdays 9am), '0 * * * *' (every hour), '0 9 * * 1' (Mondays 9am), '*/30 * * * *' (every 30 min).

For jobs that use a connected MCP, pass the exact tool names in mcpTools. This binds only those tools to the background run; OAuth credentials remain in the connector and are resolved for the job's user/org context.

To run code-agent work on a paired always-on computer, pass executionHostId (from manage-automations action=list-hosts), and optionally executionEngine and executionCwd. The selected host is explicit and never silently replaced.`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "The action to perform.",
              enum: ["create", "list", "update", "delete"],
            },
            name: {
              type: "string",
              description:
                "Job name (hyphen-case, e.g. 'daily-scorecard-check'). Required for create and update.",
            },
            timezone: {
              type: "string",
              description:
                "IANA timezone the schedule's clock time is read in, e.g. 'America/New_York'. Optional; defaults to the user's saved scheduling timezone, then the caller's browser zone. Always pass this when the user names a time of day, so '8am' means 8am where they are rather than on the server.",
            },
            schedule: {
              type: "string",
              description:
                "Cron expression (5 fields: minute hour day-of-month month day-of-week). Defaults to once per hour (0 * * * *) for create; optional for update.",
            },
            instructions: {
              type: "string",
              description:
                "What the agent should do when this job runs. Be specific — include which actions to call and what to do with the results. Required for create, optional for update.",
            },
            enabled: {
              type: "string",
              description:
                "Enable or disable a job: 'true' or 'false'. Only used with update.",
              enum: ["true", "false"],
            },
            scope: {
              type: "string",
              description:
                "For create: personal or shared (default: shared). For list: personal, shared, or all (default: all). For update: which scope to search (default: all).",
              enum: ["personal", "shared", "all"],
            },
            runAs: {
              type: "string",
              description:
                "Who shared jobs execute as: creator or shared. Default: creator. Used with create and update.",
              enum: ["creator", "shared"],
            },
            model: {
              type: "string",
              description:
                "Optional model id for this routine. The channel/app/engine default is used when omitted.",
            },
            reasoningEffort: {
              type: "string",
              description:
                "Optional reasoning effort for this routine's model. Omitted uses the model's default.",
              enum: [...REASONING_EFFORTS],
            },
            executionHostId: {
              type: "string",
              description:
                "Optional exact paired execution host id. Use manage-automations action=list-hosts first.",
            },
            executionEngine: {
              type: "string",
              description:
                "Optional host engine id, for example codex-cli or claude-cli.",
            },
            executionCwd: {
              type: "string",
              description:
                "Optional workspace path on the selected host; otherwise the connector's configured workspace is used.",
            },
            mcpTools: {
              type: "array",
              items: { type: "string" },
              description:
                'Optional explicit MCP capabilities for this job. Use the connected tool names exactly as advertised, for example ["mcp__meeting-notes__list_meetings", "mcp__meeting-notes__get_transcript"]. The job runs only with these tools; credentials remain in the connector.',
            },
          },
          required: ["action"],
        },
      },
      planMode: {
        effect: (args) => (args.action === "list" ? "read" : "write"),
        allowedValues: { action: ["list"] },
        description: "Plan mode allows listing recurring jobs.",
      },
      run: async (args) => {
        switch (args.action) {
          case "create":
            return runCreate(args, appId);
          case "list":
            return runList(args, appId);
          case "update":
            return runUpdate(args, appId);
          case "delete":
            return runDelete(args, appId);
          default:
            return JSON.stringify({
              error: `Unknown action "${args.action}". Use "create", "list", or "update".`,
            });
        }
      },
    },
  };
}
