import type { ActionEntry } from "../agent/production-agent.js";
import { isValidCron, nextOccurrence, describeCron } from "./cron.js";
import {
  parseJobFrontmatter,
  buildJobContent,
  type JobFrontmatter,
} from "./scheduler.js";
import {
  resourcePut,
  resourceGetByPath,
  resourceList,
  SHARED_OWNER,
} from "../resources/store.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
function getOwner(): string {
  return getRequestUserEmail() || "local@localhost";
}

async function runCreate(args: Record<string, any>): Promise<string> {
  const { name, schedule, instructions, scope, runAs } = args;

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

  const owner = scope === "personal" ? getOwner() : SHARED_OWNER;
  const path = `jobs/${name}.md`;
  const now = new Date();
  const next = nextOccurrence(schedule, now);

  const meta: JobFrontmatter = {
    schedule,
    enabled: true,
    createdBy: getOwner(),
    orgId: getRequestOrgId() || undefined,
    runAs: runAs === "shared" ? "shared" : "creator",
    nextRun: next.toISOString(),
  };

  const content = buildJobContent(meta, instructions);
  await resourcePut(owner, path, content);

  return JSON.stringify({
    created: true,
    name,
    path,
    schedule,
    scheduleDescription: describeCron(schedule),
    nextRun: next.toISOString(),
    scope: scope || "shared",
  });
}

async function runList(args: Record<string, any>): Promise<string> {
  const owner = getOwner();
  // Fetch only current user's and shared jobs (not other users')
  const [personal, shared] = await Promise.all([
    resourceList(owner, "jobs/"),
    resourceList(SHARED_OWNER, "jobs/"),
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
      const { meta } = parseJobFrontmatter(full?.content || "");
      return {
        name: r.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
        path: r.path,
        scope: r.owner === SHARED_OWNER ? "shared" : "personal",
        schedule: meta.schedule,
        scheduleDescription: meta.schedule ? describeCron(meta.schedule) : "",
        enabled: meta.enabled,
        lastRun: meta.lastRun || null,
        lastStatus: meta.lastStatus || null,
        lastError: meta.lastError || null,
        nextRun: meta.nextRun || null,
      };
    }),
  );

  if (jobs.length === 0) {
    return "No recurring jobs configured. Use manage-jobs with action 'create' to create one.";
  }

  return JSON.stringify(jobs, null, 2);
}

async function runUpdate(args: Record<string, any>): Promise<string> {
  const { name, schedule, instructions, enabled, scope, runAs } = args;
  const path = `jobs/${name}.md`;

  // Try to find the resource
  let resource = await resourceGetByPath(SHARED_OWNER, path);
  if (!resource && scope !== "shared") {
    resource = await resourceGetByPath(getOwner(), path);
  }

  if (!resource) {
    return JSON.stringify({ error: `Job "${name}" not found` });
  }

  const { meta, body } = parseJobFrontmatter(resource.content);

  if (schedule) {
    if (!isValidCron(schedule)) {
      return JSON.stringify({
        error: `Invalid cron expression: "${schedule}"`,
      });
    }
    meta.schedule = schedule;
    meta.nextRun = nextOccurrence(schedule).toISOString();
  }

  if (enabled !== undefined) {
    meta.enabled = enabled === "true";
  }

  if (runAs === "creator" || runAs === "shared") {
    meta.runAs = runAs;
  }

  const newBody = instructions || body;
  const content = buildJobContent(meta, newBody);
  await resourcePut(resource.owner, resource.path, content);

  return JSON.stringify({
    updated: true,
    name,
    schedule: meta.schedule,
    scheduleDescription: describeCron(meta.schedule),
    enabled: meta.enabled,
    nextRun: meta.nextRun,
  });
}

export function createJobTools(): Record<string, ActionEntry> {
  return {
    "manage-jobs": {
      tool: {
        description: `Manage recurring jobs that run on a cron schedule.

Actions:
- "create": Create a new recurring job. Requires name, schedule, and instructions.
- "list": List all recurring jobs and their status (schedule, enabled, last run, next run).
- "update": Update a job's schedule, instructions, or enabled state. Requires name.

Cron format is 5 fields: minute hour day-of-month month day-of-week. Common patterns: '0 9 * * *' (daily 9am), '0 9 * * 1-5' (weekdays 9am), '0 * * * *' (every hour), '0 9 * * 1' (Mondays 9am), '*/30 * * * *' (every 30 min).`,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "The action to perform.",
              enum: ["create", "list", "update"],
            },
            name: {
              type: "string",
              description:
                "Job name (hyphen-case, e.g. 'daily-scorecard-check'). Required for create and update.",
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
          },
          required: ["action"],
        },
      },
      run: async (args) => {
        switch (args.action) {
          case "create":
            return runCreate(args);
          case "list":
            return runList(args);
          case "update":
            return runUpdate(args);
          default:
            return JSON.stringify({
              error: `Unknown action "${args.action}". Use "create", "list", or "update".`,
            });
        }
      },
    },
  };
}
