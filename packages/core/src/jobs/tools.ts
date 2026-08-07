import type { ActionEntry } from "../agent/production-agent.js";
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
  isValidCron,
  nextOccurrence,
  describeCron,
  effectiveTimezone,
  isValidTimezone,
} from "./cron.js";
import { classifyJobResource } from "./frontmatter.js";
import {
  parseJobFrontmatter,
  buildJobContent,
  normalizeJobMcpTools,
  type JobFrontmatter,
} from "./scheduler.js";

function getOwner(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

function getSharedOwner(): string {
  return sharedResourceOwner(getRequestOrgId());
}

function jobBelongsToApp(meta: JobFrontmatter, appId?: string): boolean {
  const ownerAppId = meta.appId?.trim();
  if (!ownerAppId) return true;
  return ownerAppId === appId?.trim();
}

/**
 * Determine if the current request's user is an org owner/admin in the
 * given org. Used to allow privileged users to update or delete shared
 * jobs created by other org members. Returns false when there is no org,
 * no user, no membership, or any error querying — fail closed.
 */
async function isCurrentUserOrgAdmin(
  orgId: string | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  const email = getRequestUserEmail();
  if (!email) return false;
  try {
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
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

  // Allow org owners/admins to manage shared jobs created by other members.
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
  const { name, schedule, instructions, scope, runAs, model } = args;
  const requestedTimezone = args.timezone;

  if (!name || !schedule || !instructions) {
    return JSON.stringify({
      error: "name, schedule, and instructions are required",
    });
  }

  if (!isValidCron(schedule)) {
    return JSON.stringify({
      error: `Invalid cron expression: "${schedule}". Use 5 fields: minute hour day-of-month month day-of-week.`,
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
  // A cron time with no zone silently means the host's zone, which is how an
  // "8am" job ends up firing at 4am for the person who asked for it.
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
  // Fetch only current user's and shared jobs (not other users')
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
  const { name, schedule, instructions, enabled, scope, runAs, model } = args;
  const path = `jobs/${name}.md`;

  // Try to find the resource
  let resource = await resourceGetByPath(getSharedOwner(), path);
  if (!resource && scope !== "shared") {
    resource = await resourceGetByPath(getOwner(), path);
  }

  if (!resource) {
    return JSON.stringify({ error: `Job "${name}" not found` });
  }

  const { meta, body } = parseJobFrontmatter(resource.content);
  if (classifyJobResource(resource.content).kind === "automation") {
    return JSON.stringify({
      error: `"${name}" is an automation. Use manage-automations to update it.`,
    });
  }

  // Reject when the caller doesn't own the shared job and isn't an org
  // admin. Without this check, any user could rewrite a shared job whose
  // `createdBy` is alice@…, and the next cron tick would run the
  // attacker's instructions as alice (creator-runAs schedules in
  // jobs/scheduler.ts line 273-278).
  const denied = await authorizeJobMutation(resource.owner, meta, appId);
  if (denied) {
    return JSON.stringify({ error: denied });
  }

  if (!meta.appId && appId?.trim()) meta.appId = appId.trim();

  if (schedule) {
    if (!isValidCron(schedule)) {
      return JSON.stringify({
        error: `Invalid cron expression: "${schedule}"`,
      });
    }
    meta.schedule = schedule;
  }

  if (args.timezone !== undefined) {
    if (!isValidTimezone(args.timezone)) {
      return JSON.stringify({
        error: `Unknown timezone: "${args.timezone}".`,
      });
    }
    meta.timezone = args.timezone;
  }

  if (schedule || args.timezone !== undefined) {
    meta.nextRun = nextOccurrence(
      meta.schedule,
      undefined,
      meta.timezone,
    ).toISOString();
  }

  if (enabled !== undefined) {
    // Accept both the schema's string enum ("true"/"false") and a real boolean
    // from non-LLM callers. `enabled === "true"` alone treats a boolean `true`
    // as false — silently *disabling* a job the caller meant to enable.
    meta.enabled = enabled === true || enabled === "true";
  }

  if (runAs === "creator" || runAs === "shared") {
    meta.runAs = runAs;
  }
  if (typeof model === "string" && model.trim()) meta.model = model.trim();

  if (args.mcpTools !== undefined) {
    try {
      const mcpTools = normalizeJobMcpTools(args.mcpTools) ?? [];
      if (mcpTools.length) meta.mcpTools = mcpTools;
      else delete meta.mcpTools;
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  const newBody = instructions || body;
  const content = buildJobContent(meta, newBody);
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

  // Same access check as runUpdate — only the creator or an org admin can
  // remove a shared job. Otherwise any user could break another tenant's
  // recurring schedule.
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
- "create": Create a new recurring job. Requires name, schedule, and instructions.
- "list": List all recurring jobs and their status (schedule, enabled, last run, next run).
- "update": Update a job's schedule, instructions, or enabled state. Requires name.
- "delete": Delete a recurring job. Requires name. Always confirm with the user first.

Cron format is 5 fields: minute hour day-of-month month day-of-week. Common patterns: '0 9 * * *' (daily 9am), '0 9 * * 1-5' (weekdays 9am), '0 * * * *' (every hour), '0 9 * * 1' (Mondays 9am), '*/30 * * * *' (every 30 min).

For jobs that use a connected MCP, pass the exact tool names in mcpTools. This binds only those tools to the background run; OAuth credentials remain in the connector and are resolved for the job's user/org context.`,
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
                "Cron expression (5 fields: minute hour day-of-month month day-of-week). Required for create, optional for update.",
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
