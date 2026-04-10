import { nextOccurrence, isValidCron, describeCron } from "./cron.js";
import {
  resourceListAllOwners,
  resourcePut,
  resourceGet,
  type Resource,
} from "../resources/store.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  type ActionEntry,
} from "../agent/production-agent.js";
import { createAnthropicEngine } from "../agent/engine/index.js";
import type { AgentEngine } from "../agent/engine/types.js";
import { createThread } from "../chat-threads/store.js";
import type { AgentChatEvent } from "../agent/types.js";

// ─── Frontmatter parsing ────────────────────────────────────────────────────

export interface JobFrontmatter {
  schedule: string;
  enabled: boolean;
  lastRun?: string;
  lastStatus?: "success" | "error" | "running" | "skipped";
  lastError?: string;
  nextRun?: string;
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
      case "lastRun":
        meta.lastRun = value;
        break;
      case "lastStatus":
        meta.lastStatus = value as JobFrontmatter["lastStatus"];
        break;
      case "lastError":
        meta.lastError = value;
        break;
      case "nextRun":
        meta.nextRun = value;
        break;
    }
  }

  return { meta, body };
}

export function buildJobContent(meta: JobFrontmatter, body: string): string {
  const lines = [`---`];
  lines.push(`schedule: "${meta.schedule}"`);
  lines.push(`enabled: ${meta.enabled}`);
  if (meta.lastRun) lines.push(`lastRun: ${meta.lastRun}`);
  if (meta.lastStatus) lines.push(`lastStatus: ${meta.lastStatus}`);
  if (meta.lastError)
    lines.push(`lastError: "${meta.lastError.replace(/"/g, '\\"')}"`);
  if (meta.nextRun) lines.push(`nextRun: ${meta.nextRun}`);
  lines.push(`---`);
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

// ─── Job execution ──────────────────────────────────────────────────────────

export interface SchedulerDeps {
  getActions: () => Record<string, ActionEntry>;
  getSystemPrompt: (owner: string) => Promise<string>;
  /** Optional engine override. Defaults to AnthropicEngine using apiKey or ANTHROPIC_API_KEY. */
  engine?: AgentEngine;
  apiKey?: string;
  model: string;
}

let _isRunning = false;

/**
 * Process all due recurring jobs. Called every 60 seconds.
 * Sequential execution with 5-minute timeout per job.
 */
export async function processRecurringJobs(deps: SchedulerDeps): Promise<void> {
  // Prevent concurrent runs
  if (_isRunning) return;
  _isRunning = true;

  try {
    const jobResources = await resourceListAllOwners("jobs/");
    const now = new Date();

    for (const resource of jobResources) {
      // Skip non-markdown or .keep files
      if (!resource.path.endsWith(".md")) continue;
      if (resource.path.endsWith(".keep")) continue;

      const { meta, body } = parseJobFrontmatter(resource.content);

      // Skip disabled or missing schedule
      if (!meta.enabled || !meta.schedule) continue;
      if (!isValidCron(meta.schedule)) continue;

      // Skip if currently running
      if (meta.lastStatus === "running") continue;

      // Check if due
      if (meta.nextRun) {
        const nextRunDate = new Date(meta.nextRun);
        if (nextRunDate > now) continue;
      } else {
        // No nextRun computed yet — compute it and skip if not due
        const next = nextOccurrence(meta.schedule, new Date(0));
        if (next > now) {
          // Store nextRun for future checks
          meta.nextRun = next.toISOString();
          await updateResource(resource, meta, body);
          continue;
        }
      }

      // Skip if body is empty
      if (!body.trim()) continue;

      // Execute the job
      await executeJob(resource, meta, body, deps, now);
    }
  } catch (err) {
    console.error("[recurring-jobs] Error processing jobs:", err);
  } finally {
    _isRunning = false;
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

  // Mark as running
  meta.lastRun = now.toISOString();
  meta.lastStatus = "running";
  meta.lastError = undefined;
  await updateResource(resource, meta, body);

  // Set owner context so all scoped operations (app-state, resources, etc.)
  // operate on the correct user's data
  const prevOwner = process.env.AGENT_USER_EMAIL;
  process.env.AGENT_USER_EMAIL = resource.owner;

  try {
    const actions = deps.getActions();
    const systemPrompt = await deps.getSystemPrompt(resource.owner);
    const tools = actionsToEngineTools(actions);

    const engine =
      deps.engine ?? createAnthropicEngine({ apiKey: deps.apiKey });

    // Create a chat thread for this run
    const threadTitle = `Job: ${jobName} — ${now.toLocaleDateString()}`;
    const thread = await createThread(threadTitle);

    const jobText = `[Recurring Job: ${jobName}]\nSchedule: ${describeCron(meta.schedule)}\n\nExecute the following job instructions:\n\n${body}`;
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: jobText }],
      },
    ];

    // 5-minute timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const events: AgentChatEvent[] = [];
    const send = (event: AgentChatEvent) => {
      events.push(event);
    };

    try {
      await runAgentLoop({
        engine,
        model: deps.model,
        systemPrompt,
        tools,
        messages,
        actions,
        send,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Success — update status
    const next = nextOccurrence(meta.schedule, now);
    meta.lastStatus = "success";
    meta.nextRun = next.toISOString();
    await updateResource(resource, meta, body);

    console.log(
      `[recurring-jobs] Job "${jobName}" completed. Next run: ${meta.nextRun}`,
    );
  } catch (err: any) {
    // Error — update status
    const next = nextOccurrence(meta.schedule, now);
    meta.lastStatus = "error";
    meta.lastError = err?.message?.slice(0, 200) || "Unknown error";
    meta.nextRun = next.toISOString();
    await updateResource(resource, meta, body);

    console.error(`[recurring-jobs] Job "${jobName}" failed:`, err?.message);
  } finally {
    // Restore previous owner context
    if (prevOwner !== undefined) {
      process.env.AGENT_USER_EMAIL = prevOwner;
    } else {
      delete process.env.AGENT_USER_EMAIL;
    }
  }
}

async function updateResource(
  resource: Resource,
  meta: JobFrontmatter,
  body: string,
): Promise<void> {
  const content = buildJobContent(meta, body);
  await resourcePut(resource.owner, resource.path, content);
}
