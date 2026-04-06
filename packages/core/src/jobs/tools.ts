import type { ActionEntry } from "../agent/production-agent.js";
import { isValidCron, nextOccurrence, describeCron } from "./cron.js";
import {
  parseJobFrontmatter,
  buildJobContent,
  type JobFrontmatter,
} from "./scheduler.js";
import {
  resourcePut,
  resourceGet,
  resourceGetByPath,
  resourceList,
  SHARED_OWNER,
} from "../resources/store.js";
function getOwner(): string {
  return process.env.AGENT_USER_EMAIL || "local@localhost";
}

export function createJobTools(): Record<string, ActionEntry> {
  return {
    "create-job": {
      tool: {
        description:
          "Create a recurring job that runs on a cron schedule. The job instructions describe what the agent should do each time it runs. The schedule uses standard 5-field cron format (minute hour day-of-month month day-of-week). Common patterns: '0 9 * * *' (daily 9am), '0 9 * * 1-5' (weekdays 9am), '0 * * * *' (every hour), '0 9 * * 1' (Mondays 9am), '*/30 * * * *' (every 30 min).",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Job name (hyphen-case, e.g. 'daily-scorecard-check'). Used as the filename.",
            },
            schedule: {
              type: "string",
              description:
                "Cron expression (5 fields: minute hour day-of-month month day-of-week). Examples: '0 9 * * 1-5' (weekdays 9am), '0 */2 * * *' (every 2 hours).",
            },
            instructions: {
              type: "string",
              description:
                "What the agent should do when this job runs. Be specific — include which actions to call and what to do with the results.",
            },
            scope: {
              type: "string",
              description:
                "personal (only your jobs) or shared (team jobs). Default: shared.",
              enum: ["personal", "shared"],
            },
          },
          required: ["name", "schedule", "instructions"],
        },
      },
      run: async (args) => {
        const { name, schedule, instructions, scope } = args;

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
      },
    },

    "list-jobs": {
      tool: {
        description:
          "List all recurring jobs and their status (schedule, enabled, last run, last status, next run).",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description:
                "Filter by scope: personal, shared, or all. Default: all.",
              enum: ["personal", "shared", "all"],
            },
          },
        },
      },
      run: async (args) => {
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
              scheduleDescription: meta.schedule
                ? describeCron(meta.schedule)
                : "",
              enabled: meta.enabled,
              lastRun: meta.lastRun || null,
              lastStatus: meta.lastStatus || null,
              lastError: meta.lastError || null,
              nextRun: meta.nextRun || null,
            };
          }),
        );

        if (jobs.length === 0) {
          return "No recurring jobs configured. Use create-job to create one.";
        }

        return JSON.stringify(jobs, null, 2);
      },
    },

    "update-job": {
      tool: {
        description:
          "Update a recurring job's schedule, instructions, or enabled state.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Job name (e.g. 'daily-scorecard-check')",
            },
            schedule: {
              type: "string",
              description: "New cron expression (optional)",
            },
            instructions: {
              type: "string",
              description: "New job instructions (optional)",
            },
            enabled: {
              type: "string",
              description: "Enable or disable: 'true' or 'false' (optional)",
              enum: ["true", "false"],
            },
            scope: {
              type: "string",
              description:
                "Which scope to search: personal, shared, or all. Default: all.",
              enum: ["personal", "shared", "all"],
            },
          },
          required: ["name"],
        },
      },
      run: async (args) => {
        const { name, schedule, instructions, enabled, scope } = args;
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
      },
    },
  };
}
