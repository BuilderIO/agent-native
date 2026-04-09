import { getH3App } from "./framework-request-handler.js";
import {
  createProductionAgentHandler,
  runAgentLoop,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  subscribeToRun,
  type ActionEntry,
} from "../agent/production-agent.js";
import type {
  ActionTool,
  MentionProvider,
  MentionProviderItem,
} from "../agent/types.js";
import { discoverAgents } from "./agent-discovery.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getQuery,
} from "h3";
import { agentEnv } from "../shared/agent-env.js";
import { getSession } from "./auth.js";
import {
  createThread,
  getThread,
  listThreads,
  searchThreads,
  updateThreadData,
  deleteThread,
} from "../chat-threads/store.js";
import {
  resourceListAccessible,
  resourceList,
  resourceGet,
  resourceGetByPath,
  ensurePersonalDefaults,
  SHARED_OWNER,
} from "../resources/store.js";
import nodePath from "node:path";
import { readBody } from "./h3-helpers.js";

// Lazy fs — loaded via dynamic import() on first use.
// This avoids require() which bundlers convert to createRequire(import.meta.url)
// that crashes on CF Workers where import.meta.url is undefined.
let _fs: typeof import("fs") | undefined;
async function lazyFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}

/**
 * Wraps a core CLI script (that writes to console.log) as a ActionEntry
 * by capturing stdout.
 */
function wrapCliScript(
  tool: ActionTool,
  cliDefault: (args: string[]) => Promise<void>,
): ActionEntry {
  return {
    tool,
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        cliArgs.push(`--${k}`, v);
      }
      const logs: string[] = [];
      const origLog = console.log;
      const origError = console.error;
      const origStdoutWrite = process.stdout.write;
      console.log = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };
      console.error = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };
      // Intercept process.stdout.write so scripts that write directly
      // (e.g. resource-read) have their output captured
      process.stdout.write = ((chunk: any, ...rest: any[]) => {
        if (typeof chunk === "string") {
          logs.push(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          logs.push(chunk.toString());
        }
        return true;
      }) as any;
      try {
        await cliDefault(cliArgs);
      } catch (err: any) {
        logs.push(`Error: ${err?.message ?? String(err)}`);
      } finally {
        console.log = origLog;
        console.error = origError;
        process.stdout.write = origStdoutWrite;
      }
      return logs.join("\n") || "(no output)";
    },
  };
}

/**
 * Creates resource ScriptEntries available in both prod and dev modes.
 */
async function createResourceScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const [list, read, write, del] = await Promise.all([
      import("../scripts/resources/list.js"),
      import("../scripts/resources/read.js"),
      import("../scripts/resources/write.js"),
      import("../scripts/resources/delete.js"),
    ]);

    return {
      "resource-list": wrapCliScript(
        {
          description:
            "List resources (persistent files/notes). Returns file paths, sizes, and metadata.",
          parameters: {
            type: "object",
            properties: {
              prefix: {
                type: "string",
                description: "Filter by path prefix (e.g. 'notes/')",
              },
              scope: {
                type: "string",
                description:
                  "Which resources to list: personal, shared, or all (default: all)",
                enum: ["personal", "shared", "all"],
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        list.default,
      ),
      "resource-read": wrapCliScript(
        {
          description: "Read a resource by path. Returns the file contents.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Resource path (e.g. 'LEARNINGS.md', 'notes/ideas.md')",
              },
              scope: {
                type: "string",
                description:
                  "personal or shared (default: personal, falls back to shared)",
                enum: ["personal", "shared"],
              },
            },
            required: ["path"],
          },
        },
        read.default,
      ),
      "resource-write": wrapCliScript(
        {
          description:
            "Write or update a resource. Creates the resource if it doesn't exist.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Resource path (e.g. 'LEARNINGS.md', 'notes/ideas.md')",
              },
              content: {
                type: "string",
                description: "The content to write",
              },
              scope: {
                type: "string",
                description: "personal or shared (default: personal)",
                enum: ["personal", "shared"],
              },
              mime: {
                type: "string",
                description: "MIME type (default: inferred from extension)",
              },
            },
            required: ["path", "content"],
          },
        },
        write.default,
      ),
      "resource-delete": wrapCliScript(
        {
          description: "Delete a resource by path.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Resource path to delete",
              },
              scope: {
                type: "string",
                description: "personal or shared (default: personal)",
                enum: ["personal", "shared"],
              },
            },
            required: ["path"],
          },
        },
        del.default,
      ),
    };
  } catch {
    // Resources not available — skip silently
    return {};
  }
}

/**
 * Creates chat management ActionEntries (search-chats, open-chat).
 */
async function createChatScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const [searchMod, openMod] = await Promise.all([
      import("../scripts/chat/search-chats.js"),
      import("../scripts/chat/open-chat.js"),
    ]);

    return {
      "search-chats": wrapCliScript(
        {
          description:
            "Search or list past agent chat threads. Use this to find previous conversations by keyword.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search term to find chats by title, preview, or content",
              },
              limit: {
                type: "string",
                description: "Max number of results (default: 20)",
              },
              format: {
                type: "string",
                description: "Output format",
                enum: ["json", "text"],
              },
            },
          },
        },
        searchMod.default,
      ),
      "open-chat": wrapCliScript(
        {
          description:
            "Open a chat thread in the UI as a new tab and focus it. Use search-chats first to find the thread ID.",
          parameters: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The chat thread ID to open",
              },
            },
            required: ["id"],
          },
        },
        openMod.default,
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Creates the call-agent ActionEntry for cross-agent A2A communication.
 */
async function createCallAgentScriptEntry(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const mod = await import("../scripts/call-agent.js");
    return {
      "call-agent": {
        tool: mod.tool,
        run: mod.run,
      },
    };
  } catch {
    return {};
  }
}

/**
 * Creates agent team orchestration tools (spawn-task, task-status, read-task-result).
 * These let the main agent spawn sub-agents and coordinate work.
 */
function createTeamTools(deps: {
  getOwner: () => string;
  getSystemPrompt: () => string;
  getActions: () => Record<string, ActionEntry>;
  getApiKey: () => string;
  getModel: () => string;
  getParentThreadId: () => string;
  getSend: () =>
    | ((event: import("../agent/types.js").AgentChatEvent) => void)
    | null;
}): Record<string, ActionEntry> {
  return {
    "spawn-task": {
      tool: {
        description:
          "Spawn a sub-agent to handle a task in the background. The sub-agent runs independently with its own conversation thread. Use this to delegate work so the main chat stays free for new requests. A live preview card will appear in the chat showing the sub-agent's progress.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description:
                "Clear description of what the sub-agent should accomplish",
            },
            instructions: {
              type: "string",
              description:
                "Optional additional instructions or context for the sub-agent",
            },
            name: {
              type: "string",
              description:
                "Short name for the sub-agent tab (e.g. 'Research', 'Draft email'). If omitted, derived from the task.",
            },
          },
          required: ["task"],
        },
      },
      run: async (args: Record<string, string>) => {
        // Capture the send function NOW (at spawn time) so that
        // concurrent runs don't clobber each other's send reference.
        const capturedSend = deps.getSend();
        const { spawnTask } = await import("./agent-teams.js");
        const task = await spawnTask({
          description: args.task,
          instructions: args.instructions,
          ownerEmail: deps.getOwner(),
          systemPrompt: deps.getSystemPrompt(),
          actions: deps.getActions(),
          apiKey: deps.getApiKey(),
          model: deps.getModel(),
          parentThreadId: deps.getParentThreadId(),
          parentSend: (event) => {
            if (capturedSend) capturedSend(event);
          },
        });
        return JSON.stringify({
          taskId: task.taskId,
          threadId: task.threadId,
          status: task.status,
          description: task.description,
          name: args.name || "",
        });
      },
    },
    "task-status": {
      tool: {
        description:
          "Check the status of a sub-agent task. Returns current status, preview of output, and current step.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The task ID returned by spawn-task",
            },
          },
          required: ["taskId"],
        },
      },
      run: async (args: Record<string, string>) => {
        const { getTask } = await import("./agent-teams.js");
        const task = await getTask(args.taskId);
        if (!task) return JSON.stringify({ error: "Task not found" });
        return JSON.stringify({
          taskId: task.taskId,
          threadId: task.threadId,
          status: task.status,
          description: task.description,
          preview: task.preview,
          currentStep: task.currentStep,
          summary: task.summary,
        });
      },
    },
    "read-task-result": {
      tool: {
        description:
          "Read the result of a completed sub-agent task. Returns the full output summary.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The task ID returned by spawn-task",
            },
          },
          required: ["taskId"],
        },
      },
      run: async (args: Record<string, string>) => {
        const { getTask } = await import("./agent-teams.js");
        const task = await getTask(args.taskId);
        if (!task) return JSON.stringify({ error: "Task not found" });
        if (task.status === "running") {
          return JSON.stringify({
            status: "running",
            preview: task.preview,
            message: "Task is still running. Check back later.",
          });
        }
        return JSON.stringify({
          taskId: task.taskId,
          status: task.status,
          summary: task.summary,
          preview: task.preview,
        });
      },
    },
    "send-to-task": {
      tool: {
        description:
          "Send a message or update to a running sub-agent. Use this to redirect, add context, or give feedback to a sub-agent while it's working.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The task ID returned by spawn-task",
            },
            message: {
              type: "string",
              description: "Message to send to the sub-agent",
            },
          },
          required: ["taskId", "message"],
        },
      },
      run: async (args: Record<string, string>) => {
        const { sendToTask } = await import("./agent-teams.js");
        const result = await sendToTask(args.taskId, args.message);
        return JSON.stringify(result);
      },
    },
    "list-tasks": {
      tool: {
        description:
          "List all sub-agent tasks and their current status. Use this to see what's running, completed, or failed.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      run: async () => {
        const { listTasks } = await import("./agent-teams.js");
        const tasks = await listTasks();
        if (tasks.length === 0) {
          return "No sub-agent tasks.";
        }
        return JSON.stringify(
          tasks.map((t) => ({
            taskId: t.taskId,
            threadId: t.threadId,
            description: t.description,
            status: t.status,
            currentStep: t.currentStep,
            hasResult: t.summary.length > 0,
          })),
          null,
          2,
        );
      },
    },
  };
}

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  /** Template-specific actions (email ops, booking ops, etc.) */
  actions?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  /** @deprecated Use `actions` instead */
  scripts?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  /** System prompt for the agent. A sensible default is provided. */
  systemPrompt?: string;
  /** Additional system prompt prepended in dev mode */
  devSystemPrompt?: string;
  /** Claude model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Route path. Default: /_agent-native/agent-chat */
  path?: string;
  /** Custom mention providers for @-tagging template entities */
  mentionProviders?:
    | Record<string, MentionProvider>
    | (() =>
        | Record<string, MentionProvider>
        | Promise<Record<string, MentionProvider>>);
  /** App ID used to exclude self from agent discovery (e.g., "mail", "calendar") */
  appId?: string;
  /**
   * Optional callback to resolve the org ID for the current request.
   * When provided, the resolved value is set as AGENT_ORG_ID env var so
   * that db-query/db-exec automatically scope by org_id in addition to
   * owner_email.
   *
   * If not provided, the framework automatically uses `session.orgId` from
   * Better Auth's active organization. Only provide this callback when you
   * need custom org resolution logic (e.g., Atlassian org mapping).
   */
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
}

/**
 * Framework-level instructions injected into every agent's system prompt.
 * This is the single source of truth for the core philosophy, rules, and patterns.
 * Template AGENTS.md resources only need template-specific content.
 */
/**
 * Framework instructions shared across both modes. The mode-specific
 * preamble is prepended by the prompt composition below.
 */
const FRAMEWORK_CORE = `
### Core Rules

1. **Data lives in SQL** — All app state is in a SQL database (could be SQLite, Postgres, Turso, or Cloudflare D1 — never assume which). Use the available database tools.
2. **Context awareness** — The user's current screen state is automatically included in each message as a \`<current-screen>\` block. Use it to understand what the user is looking at. You can still call \`view-screen\` for a more detailed snapshot if needed, but you should NOT need to call it before every action.
3. **Navigate the UI** — Use the \`navigate\` tool to switch views, open items, or focus elements for the user.
4. **Application state** — Ephemeral UI state (drafts, selections, navigation) lives in \`application_state\`. Use \`readAppState\`/\`writeAppState\` to read and write it. When you write state, the UI updates automatically.
5. **Resources for memory** — Use the Resources system for persistent notes and context. Update LEARNINGS.md when you learn user preferences or corrections. Update the shared AGENTS.md for instructions that should apply to all users.

### Resources

You have access to a Resources system for persistent notes, learnings, and context files.
Use resource-list, resource-read, resource-write, and resource-delete to manage resources.
Resources can be personal (per-user) or shared (team-wide). By default, resources are personal.

When you learn something important (user corrections, preferences, patterns), update the "LEARNINGS.md" resource. Keep it tidy — revise, consolidate, and remove outdated entries rather than only appending.
When the user gives instructions that should apply to all users/sessions, update the shared "AGENTS.md" resource instead.

### Navigation Rule

When the user says "show me", "go to", "open", "switch to", or similar navigation language, ALWAYS use the \`navigate\` action to update the UI. The user expects to SEE the result in the main app, not just read it in chat. Navigate first, then fetch/display data.

### Chat History

You can search and restore previous chat conversations:
- \`search-chats\` — Search or list past chat threads by keyword
- \`open-chat\` — Open a chat thread in the UI as a new tab and focus it

When the user asks to find a previous conversation, use \`search-chats\` first to find matching threads, then \`open-chat\` to restore the one they want.

### Agent Teams — Orchestration

You are an orchestrator. For complex or multi-step tasks, delegate to sub-agents:
- \`spawn-task\` — Spawn a sub-agent for a task. It runs in its own thread while you stay available. A live preview card appears in the chat.
- \`task-status\` — Check the progress of a running sub-agent.
- \`read-task-result\` — Read the result when a sub-agent finishes.

**When to delegate vs do directly:**
- **Delegate** when the task involves multiple tool calls, research, content generation, or anything that takes more than a few seconds. Examples: "create a deck about X", "analyze the data and write a report", "look up Y and draft an email about it".
- **Do directly** for quick single-step tasks like navigation, reading state, or answering simple questions.
- **Spawn multiple sub-agents** when the user asks for multiple independent things — they'll run in parallel.

**How to orchestrate:**
1. When the user asks for something complex, spawn a sub-agent with a clear task description.
2. Tell the user what you've started ("I'm having a sub-agent research that for you").
3. You can keep chatting — sub-agents run independently.
4. Use \`read-task-result\` to check results when needed, or the user can see live progress in the card.
5. If the user's request has multiple steps, you can spawn one sub-agent per step, or chain them.

The sub-agent has the same tools you do. Give it a specific, actionable task description — it will figure out which tools to use.

### Recurring Jobs

You can create recurring jobs that run on a cron schedule. Jobs are resource files under \`jobs/\`. Each job has a cron schedule and instructions that the agent executes automatically.

- \`create-job\` — Create a new recurring job with a cron schedule and instructions
- \`list-jobs\` — List all recurring jobs and their status (schedule, last run, next run, errors)
- \`update-job\` — Update a job's schedule, instructions, or toggle enabled/disabled
- Delete a job with \`resource-delete --path jobs/<name>.md\`

When the user asks for something recurring ("every morning", "daily at 9am", "weekly on Mondays"), create a job. Convert natural language to 5-field cron format:
- "every morning" / "daily at 9am" → \`0 9 * * *\`
- "every weekday at 9am" → \`0 9 * * 1-5\`
- "every hour" → \`0 * * * *\`
- "every 30 minutes" → \`*/30 * * * *\`
- "every monday at 9am" → \`0 9 * * 1\`
- "twice a day" / "morning and evening" → \`0 9,17 * * *\`

Job instructions should be self-contained — include which actions to call, what conditions to check, and what to do with results. The agent executing the job has access to all the same tools you do.

### Auto-Memory

Proactively update \`LEARNINGS.md\` when you learn something important during conversations:
- User corrects your approach → capture the correct way
- User shares preferences (tone, style, workflow) → capture them
- You discover a non-obvious pattern or gotcha → capture it
- User provides personal context (contacts, team info, domain knowledge) → capture it

**Don't ask permission — just save it.** Keep entries concise (one line each, grouped by category). Don't save things that are obvious from reading the code or that are temporary.
`;

const PROD_FRAMEWORK_PROMPT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Code Changes Not Available

When the user asks you to change the UI, modify code, add features, fix bugs in the app itself, change styles, or do anything that requires editing source files — you MUST respond with this exact message (replacing APP_NAME with the current app name from the URL hostname):

> This app is running in hosted mode and I can't make code changes here. To customize this app:
>
> **Option 1:** Connect to [Builder.io](https://www.builder.io/m/agent-native) for a full development environment
>
> **Option 2:** Clone and run locally:
> \`\`\`
> npx agent-native create APP_NAME
> \`\`\`

Do NOT attempt to work around this limitation. Do NOT say "I can't do that" without providing the options above. Always include both the Builder.io link and the CLI command.
${FRAMEWORK_CORE}`;

const DEV_FRAMEWORK_PROMPT = `## Agent-Native Framework — Development Mode

You are an AI agent in an agent-native application, running in **development mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via tools/scripts, and vice versa. They share the same SQL database and stay in sync automatically.

**In development mode, you have UNRESTRICTED access.** You can:
- Run ANY shell command via the \`shell\` tool (bash, node, curl, pnpm, etc.)
- Execute arbitrary code: \`shell({ command: 'node -e "console.log(1+1)"' })\`
- Read/write any file on the filesystem
- Query and modify the database
- Call external APIs (via shell with curl, or via scripts)
- Edit source code, install packages, modify the app

**There are NO restrictions in dev mode.** If a dedicated tool/action doesn't exist for what you need, use \`shell\` to run any command. For example: \`shell({ command: 'curl -s https://api.example.com/data' })\`

When editing code, follow the agent-native architecture:
- Every feature needs all four areas: UI + scripts + skills/instructions + application-state sync
- All SQL must be dialect-agnostic (works on SQLite and Postgres)
- No Node.js-specific APIs in server routes (must work on Cloudflare Workers, etc.)
- Use shadcn/ui components and Tabler Icons for all UI work
${FRAMEWORK_CORE}`;

const DEFAULT_SYSTEM_PROMPT = PROD_FRAMEWORK_PROMPT;

/**
 * Pre-load AGENTS.md and LEARNINGS.md (personal + shared) and append to the system prompt.
 * This ensures the agent always has the user's context without needing to call tools first.
 */
async function loadResourcesForPrompt(owner: string): Promise<string> {
  await ensurePersonalDefaults(owner);

  const resourceNames = ["AGENTS.md", "LEARNINGS.md"];
  const sections: string[] = [];

  for (const name of resourceNames) {
    // Read shared
    try {
      const shared = await resourceGetByPath(SHARED_OWNER, name);
      if (shared?.content?.trim()) {
        sections.push(
          `<resource name="${name}" scope="shared">\n${shared.content.trim()}\n</resource>`,
        );
      }
    } catch {}

    // Read personal (skip if owner is the shared sentinel)
    if (owner !== SHARED_OWNER) {
      try {
        const personal = await resourceGetByPath(owner, name);
        if (personal?.content?.trim()) {
          sections.push(
            `<resource name="${name}" scope="personal">\n${personal.content.trim()}\n</resource>`,
          );
        }
      } catch {}
    }
  }

  if (sections.length === 0) return "";
  return (
    "\n\nThe following resources contain template-specific instructions and user context. Use the information in them to help the user.\n\n" +
    sections.join("\n\n")
  );
}

/** @deprecated Kept for backward compat — dev prompt is now part of DEV_FRAMEWORK_PROMPT */
const DEFAULT_DEV_PROMPT = "";

/**
 * Generates a system prompt section describing registered template actions.
 * This helps the agent prefer template-specific actions over raw db-query/db-exec.
 */
function generateActionsPrompt(registry: Record<string, ActionEntry>): string {
  if (!registry || Object.keys(registry).length === 0) return "";

  const lines = Object.entries(registry).map(([name, entry]) => {
    const desc = entry.tool.description;
    const params = entry.tool.parameters?.properties;
    if (params) {
      const paramList = Object.entries(params)
        .map(([k, v]) => `--${k}${v.description ? ` (${v.description})` : ""}`)
        .join(", ");
      return `- \`${name}\` — ${desc} Args: ${paramList}`;
    }
    return `- \`${name}\` — ${desc}`;
  });

  return `\n\n## Available Actions\n\nThese are your registered template actions. ALWAYS prefer these over raw db-query/db-exec when a matching action exists:\n\n${lines.join("\n")}`;
}

/**
 * Creates a Nitro plugin that mounts the agent chat endpoint.
 *
 * In dev mode (NODE_ENV !== "production"), automatically includes
 * file system, shell, and database tools alongside any template-specific actions.
 *
 * Usage in templates:
 * ```ts
 * // server/plugins/agent-chat.ts
 * import { readBody, createAgentChatPlugin } from "@agent-native/core/server";
 * import { scriptRegistry } from "../../scripts/registry.js";
 *
 * export default createAgentChatPlugin({
 *   scripts: scriptRegistry,
 *   systemPrompt: "You are an email assistant...",
 * });
 * ```
 */
async function collectFiles(
  dir: string,
  prefix: string,
  depth: number,
  results: Array<{ path: string; name: string; type: "file" | "folder" }>,
): Promise<void> {
  if (depth > 4 || results.length >= 500) return;
  const skip = new Set([
    "node_modules",
    ".git",
    ".next",
    ".output",
    "dist",
    ".cache",
    ".turbo",
    "data",
  ]);
  let entries: import("fs").Dirent[];
  try {
    const fs = await lazyFs();
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= 500) return;
    if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();
    results.push({
      path: relPath,
      name: entry.name,
      type: isDir ? "folder" : "file",
    });
    if (isDir)
      await collectFiles(
        nodePath.join(dir, entry.name),
        relPath,
        depth + 1,
        results,
      );
  }
}

function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = match[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

function isLocalhost(event: any): boolean {
  try {
    const host =
      event.node?.req?.headers?.host || event.headers?.get?.("host") || "";
    const hostname = host.split(":")[0];
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function createAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return async (nitroApp: any) => {
    // Wait for default framework plugins (auth, core-routes, integrations, ...)
    // to finish mounting their middleware before we register our own. Without
    // this, requests can race ahead of the bootstrap and hit the SSR catch-all.
    const { awaitBootstrap } = await import("./framework-request-handler.js");
    await awaitBootstrap(nitroApp);

    const env = process.env.NODE_ENV;
    // AGENT_MODE=production forces production agent constraints even in dev
    const canToggle =
      (env === "development" || env === "test") &&
      process.env.AGENT_MODE !== "production";
    const routePath = options?.path ?? "/_agent-native/agent-chat";

    // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
    const rawActions = options?.actions ?? options?.scripts;
    const templateScripts =
      typeof rawActions === "function"
        ? await rawActions()
        : (rawActions ?? {});

    // Resource, chat, and cross-agent scripts are available in both prod and dev modes
    const resourceScripts = await createResourceScriptEntries();
    const chatScripts = await createChatScriptEntries();
    const callAgentScript = await createCallAgentScriptEntry();

    // Auto-mount A2A protocol endpoints so every app is discoverable
    // and callable by other agents via the standard protocol.
    // In dev mode, include dev scripts (filesystem-discovered) so the A2A agent
    // has access to the same tools as the interactive agent.
    let devScriptsForA2A: Record<string, ActionEntry> = {};
    let discoveredActions: Record<string, ActionEntry> = {};
    if (canToggle) {
      try {
        const { createDevScriptRegistry } =
          await import("../scripts/dev/index.js");
        devScriptsForA2A = await createDevScriptRegistry();
      } catch {}

      // Auto-discover template action files and register as shell-based tools.
      // This ensures templates without a custom agent-chat plugin (e.g., analytics)
      // still have their domain actions available as tools.
      try {
        const fs = await import("fs");
        const pathMod = await import("path");
        const cwd = process.cwd();
        const skipFiles = new Set([
          "helpers",
          "run",
          "registry",
          "_utils",
          "db-connect",
          "db-status",
        ]);

        for (const dir of ["actions", "scripts"]) {
          const actionsDir = pathMod.join(cwd, dir);
          const _fs = await lazyFs();
          if (!_fs.existsSync(actionsDir)) continue;
          const files = _fs
            .readdirSync(actionsDir)
            .filter(
              (f: string) =>
                f.endsWith(".ts") &&
                !f.startsWith("_") &&
                !skipFiles.has(f.replace(/\.ts$/, "")),
            );
          for (const file of files) {
            const name = file.replace(/\.ts$/, "");
            if (templateScripts[name] || devScriptsForA2A[name]) continue;

            // Try to load the action module directly so we get the real
            // run function (not a shell wrapper). This makes HTTP endpoints
            // work correctly. Only fall back to shell wrapper if the import
            // fails (e.g., CLI-style scripts that throw at top level).
            const filePath = pathMod.join(actionsDir, file);
            try {
              const mod = await import(/* @vite-ignore */ filePath);
              const def =
                mod.default && typeof mod.default === "object"
                  ? mod.default
                  : mod;
              if (def?.tool && typeof def.run === "function") {
                discoveredActions[name] = {
                  tool: def.tool,
                  run: def.run,
                  ...(def.http !== undefined ? { http: def.http } : {}),
                };
                continue;
              }
            } catch {
              // Fall through to shell wrapper for CLI-style scripts
            }

            // Fallback: shell-based wrapper for CLI-style scripts
            discoveredActions[name] = {
              tool: {
                description: `Run the ${name} action. Use: pnpm action ${name} --arg=value`,
                parameters: {
                  type: "object",
                  properties: {
                    args: {
                      type: "string",
                      description:
                        "CLI arguments as a string (e.g., --metrics=sessions --days=7)",
                    },
                  },
                },
              },
              run: async (input: Record<string, string>) => {
                const shellEntry = devScriptsForA2A["shell"];
                if (!shellEntry) return "Error: shell not available";
                return shellEntry.run({
                  command: `pnpm action ${name} ${input.args || ""}`.trim(),
                });
              },
            };
          }
        }
        if (Object.keys(discoveredActions).length > 0 && process.env.DEBUG)
          console.log(
            `[agent-chat] Auto-discovered ${Object.keys(discoveredActions).length} action(s): ${Object.keys(discoveredActions).join(", ")}`,
          );
      } catch {}
    }
    const allScripts = {
      ...discoveredActions,
      ...templateScripts,
      ...resourceScripts,
      ...chatScripts,
      ...callAgentScript,
      ...devScriptsForA2A,
    };

    const { mountA2A } = await import("../a2a/server.js");
    mountA2A(nitroApp, {
      name: options?.appId
        ? options.appId.charAt(0).toUpperCase() + options.appId.slice(1)
        : "Agent",
      description: `Agent-native ${options?.appId ?? "app"} agent`,
      skills: Object.entries(allScripts).map(([name, entry]) => ({
        id: name,
        name,
        description: entry.tool.description,
      })),
      streaming: true,
      handler: async function* (message, context) {
        // Resolve the caller's identity for user-scoped data access.
        const isDev = process.env.NODE_ENV !== "production";
        let userEmail: string | undefined;

        if (isDev) {
          userEmail = (context.metadata?.userEmail as string) || undefined;
          if (!userEmail) {
            try {
              const { getDbExec } = await import("../db/client.js");
              const db = getDbExec();
              const { rows } = await db.execute({
                sql: "SELECT email FROM sessions ORDER BY created_at DESC LIMIT 1",
                args: [],
              });
              if (rows[0]) userEmail = rows[0].email as string;
            } catch {}
          }
        } else {
          const googleToken = context.metadata?.googleToken as string;
          if (googleToken) {
            try {
              const res = await fetch(
                `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`,
              );
              if (res.ok) {
                const info = (await res.json()) as {
                  email?: string;
                  email_verified?: string;
                };
                if (info.email && info.email_verified === "true") {
                  userEmail = info.email;
                }
              }
            } catch {}
          }
        }

        if (userEmail) {
          process.env.AGENT_USER_EMAIL = userEmail;
        }

        const text = message.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");

        if (!text) {
          yield {
            role: "agent" as const,
            parts: [
              { type: "text" as const, text: "No text content in message" },
            ],
          };
          return;
        }

        // Use the SAME agent setup as the interactive chat — identical tools,
        // prompt, and capabilities. The A2A agent IS the app's agent.
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          yield {
            role: "agent" as const,
            parts: [
              {
                type: "text" as const,
                text: "Anthropic API key is not configured. Set ANTHROPIC_API_KEY in .env.",
              },
            ],
          };
          return;
        }

        // Use the same handler (dev or prod) that the interactive chat uses
        const handler = canToggle && devHandler ? devHandler : prodHandler;

        // Build the same system prompt the interactive agent uses
        const owner = userEmail || "local@localhost";
        const resources = await loadResourcesForPrompt(owner);
        const systemPrompt = canToggle
          ? devPrompt + resources
          : basePrompt + resources;

        const a2aClient = new Anthropic({ apiKey });
        const model =
          options?.model ??
          (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

        // Build tools — same as interactive handler but WITHOUT call-agent
        // to prevent infinite recursive A2A loops (agent calling itself).
        const a2aActions = canToggle
          ? {
              ...discoveredActions,
              ...templateScripts,
              ...resourceScripts,
              ...chatScripts,
              ...devScriptsForA2A,
            }
          : { ...templateScripts, ...resourceScripts, ...chatScripts };

        const tools: any[] = Object.entries(a2aActions).map(
          ([name, entry]) => ({
            name,
            description: entry.tool.description,
            input_schema: entry.tool.parameters ?? {
              type: "object" as const,
              properties: {},
            },
          }),
        );

        const messages: any[] = [{ role: "user", content: text }];

        // Run the SAME agent loop, collect text events, yield as A2A messages
        let accumulatedText = "";
        const controller = new AbortController();

        console.log(
          `[A2A] Starting agent loop: ${tools.length} tools, prompt ${systemPrompt.length} chars`,
        );

        await runAgentLoop({
          client: a2aClient,
          model,
          systemPrompt,
          tools,
          messages,
          actions: a2aActions,
          send: (event) => {
            if (event.type === "text") {
              accumulatedText += event.text;
            } else if (event.type === "tool_start") {
              console.log(`[A2A] Tool call: ${event.tool}`);
            } else if (event.type === "error") {
              console.error(`[A2A] Error: ${event.error}`);
            } else if (event.type === "done") {
              console.log(
                `[A2A] Done. Response: ${accumulatedText.length} chars`,
              );
            }
          },
          signal: controller.signal,
        });

        console.log(
          `[A2A] Loop complete. Text: ${accumulatedText.slice(0, 100)}...`,
        );

        // Yield the final accumulated text
        yield {
          role: "agent" as const,
          parts: [
            {
              type: "text" as const,
              text: accumulatedText || "(no response)",
            },
          ],
        };
      },
    });

    // Generate an "Available Actions" section from template-specific actions
    // so the agent knows to use them instead of raw SQL
    const actionsPrompt = generateActionsPrompt(templateScripts);

    // Build system prompts — dynamic functions that pre-load resources per-request.
    // Production gets PROD_FRAMEWORK_PROMPT, dev gets DEV_FRAMEWORK_PROMPT.
    // Custom systemPrompt from options overrides the framework default entirely.
    const prodPrompt =
      (options?.systemPrompt ?? PROD_FRAMEWORK_PROMPT) + actionsPrompt;
    const devPrompt =
      (options?.devSystemPrompt
        ? options.devSystemPrompt +
          (options?.systemPrompt ?? PROD_FRAMEWORK_PROMPT)
        : DEV_FRAMEWORK_PROMPT) + actionsPrompt;
    // Keep legacy names for the composition below
    const basePrompt = prodPrompt;
    const devPrefix = options?.devSystemPrompt ?? DEFAULT_DEV_PROMPT;

    // Mount MCP remote server — same action registry as A2A + agent chat
    const { mountMCP } = await import("../mcp/server.js");
    mountMCP(nitroApp, {
      name: options?.appId
        ? options.appId.charAt(0).toUpperCase() + options.appId.slice(1)
        : "Agent",
      description: `Agent-native ${options?.appId ?? "app"} agent`,
      actions: allScripts,
      askAgent: async (message: string) => {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return "Anthropic API key is not configured.";

        const client = new Anthropic({ apiKey });
        const model =
          options?.model ??
          (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

        // Same actions as A2A — without call-agent to prevent loops
        const mcpActions = canToggle
          ? {
              ...discoveredActions,
              ...templateScripts,
              ...resourceScripts,
              ...chatScripts,
              ...devScriptsForA2A,
            }
          : { ...templateScripts, ...resourceScripts, ...chatScripts };

        const tools: any[] = Object.entries(mcpActions).map(
          ([name, entry]) => ({
            name,
            description: entry.tool.description,
            input_schema: entry.tool.parameters ?? {
              type: "object" as const,
              properties: {},
            },
          }),
        );

        const resources = await loadResourcesForPrompt("local@localhost");
        const systemPrompt = canToggle
          ? devPrompt + resources
          : basePrompt + resources;

        let accumulatedText = "";
        const controller = new AbortController();

        await runAgentLoop({
          client,
          model,
          systemPrompt,
          tools,
          messages: [{ role: "user", content: message }],
          actions: mcpActions,
          send: (event) => {
            if (event.type === "text") accumulatedText += event.text;
          },
          signal: controller.signal,
        });

        return accumulatedText || "(no response)";
      },
    });

    // Resolve owner from the H3 event's session — matches how resources are created
    const getOwnerFromEvent = async (event: any): Promise<string> => {
      try {
        const session = await getSession(event);
        return session?.email || "local@localhost";
      } catch {
        return "local@localhost";
      }
    };

    // Auto-mount template actions as HTTP endpoints under /_agent-native/actions/
    // Only template actions (discoveredActions + templateScripts) are exposed — not
    // built-in resource/chat/dev tools.
    const httpActions = { ...discoveredActions, ...templateScripts };
    if (Object.keys(httpActions).length > 0) {
      const { mountActionRoutes } = await import("./action-routes.js");
      mountActionRoutes(nitroApp, httpActions, {
        getOwnerFromEvent,
        resolveOrgId: options?.resolveOrgId,
      });
    }

    // Callback to persist agent response when run finishes (even if client disconnected).
    // Reconstructs the assistant message from buffered events and appends to thread_data.
    const onRunComplete = async (run: any, threadId: string | undefined) => {
      if (!threadId) return;
      try {
        const thread = await getThread(threadId);
        if (!thread) return;

        const assistantMsg = buildAssistantMessage(run.events ?? [], run.runId);
        if (!assistantMsg) {
          // No content produced — just bump timestamp
          await updateThreadData(
            threadId,
            thread.threadData,
            thread.title,
            thread.preview,
            thread.messageCount,
          );
          return;
        }

        // Parse existing thread_data, append assistant message only if
        // the frontend hasn't already saved it (avoids duplicates when
        // the client is still connected during a normal flow).
        let repo: any;
        try {
          repo = JSON.parse(thread.threadData || "{}");
        } catch {
          repo = {};
        }
        if (!Array.isArray(repo.messages)) repo.messages = [];

        const lastMsg = repo.messages[repo.messages.length - 1];
        // Check both wrapped ({ message: { role } }) and unwrapped ({ role }) formats
        const lastRole = lastMsg?.message?.role ?? lastMsg?.role;
        if (lastRole === "assistant") {
          // Frontend already saved the assistant response — just bump timestamp
          await updateThreadData(
            threadId,
            thread.threadData,
            thread.title,
            thread.preview,
            thread.messageCount,
          );
          return;
        }

        // Determine if repo uses wrapped format ({ message, parentId }) or flat format
        const isWrapped = lastMsg && "message" in lastMsg;
        if (isWrapped) {
          const parentId =
            repo.messages.length > 0
              ? (repo.messages[repo.messages.length - 1].message?.id ?? null)
              : null;
          repo.messages.push({ message: assistantMsg, parentId });
        } else {
          repo.messages.push(assistantMsg);
        }

        const meta = extractThreadMeta(repo);
        await updateThreadData(
          threadId,
          JSON.stringify(repo),
          meta.title || thread.title,
          meta.preview || thread.preview,
          repo.messages.length,
        );
      } catch {
        // Best-effort — don't break cleanup
      }
    };

    // ─── Agent Teams: per-run send reference ─────────────────────────
    // Team tools need to emit events to the parent chat's SSE stream.
    // Each run gets its own send function, keyed by threadId so concurrent
    // requests for different threads don't clobber each other.
    const _runSendByThread = new Map<
      string,
      (event: import("../agent/types.js").AgentChatEvent) => void
    >();
    let _currentRunOwner = "local@localhost";
    let _currentRunThreadId = "";
    let _currentRunSystemPrompt = basePrompt;
    // Default to Haiku in production mode to manage costs for hosted apps
    const resolvedModel =
      options?.model ??
      (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

    const teamTools = createTeamTools({
      getOwner: () => _currentRunOwner,
      getSystemPrompt: () => _currentRunSystemPrompt,
      getActions: () => ({
        ...templateScripts,
        ...resourceScripts,
        ...chatScripts,
      }),
      getApiKey: () => options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      getModel: () => resolvedModel,
      getParentThreadId: () => _currentRunThreadId,
      getSend: () => {
        // Return the send for the current run's thread
        const send = _runSendByThread.get(_currentRunThreadId);
        return send ?? null;
      },
    });

    // Hook into the run lifecycle to set/clear the send reference.
    // Job management tools (create-job, list-jobs, update-job)
    let jobTools: Record<string, ActionEntry> = {};
    try {
      const { createJobTools } = await import("../jobs/tools.js");
      jobTools = createJobTools();
    } catch {}

    const prodActions = {
      ...templateScripts,
      ...resourceScripts,
      ...chatScripts,
      ...callAgentScript,
      ...teamTools,
      ...jobTools,
    };

    // Always build the production handler (includes resource tools + call-agent + team tools)
    // In production mode (!canToggle), enable usage tracking and limits
    const isHostedProd = !canToggle;
    const prodHandler = createProductionAgentHandler({
      actions: prodActions,
      systemPrompt: async (event: any) => {
        const owner = await getOwnerFromEvent(event);
        _currentRunOwner = owner;
        const resources = await loadResourcesForPrompt(owner);
        _currentRunSystemPrompt = basePrompt + resources;
        return _currentRunSystemPrompt;
      },
      model:
        options?.model ??
        (isHostedProd ? "claude-haiku-4-5-20251001" : undefined),
      apiKey: options?.apiKey,
      onRunStart: (
        send: (event: import("../agent/types.js").AgentChatEvent) => void,
        threadId: string,
      ) => {
        _runSendByThread.set(threadId, send);
        _currentRunThreadId = threadId;
      },
      onRunComplete: async (run: any, threadId: string | undefined) => {
        if (threadId) _runSendByThread.delete(threadId);
        await onRunComplete(run, threadId);
      },
      // Usage tracking for hosted production deployments
      trackUsage: isHostedProd,
      resolveOwnerEmail: isHostedProd ? getOwnerFromEvent : undefined,
    });

    // Build the dev handler (with filesystem/shell/db tools) if environment allows toggling
    let devHandler: ReturnType<typeof createProductionAgentHandler> | null =
      null;
    if (canToggle) {
      const { createDevScriptRegistry } =
        await import("../scripts/dev/index.js");
      const devActions = {
        ...discoveredActions,
        ...templateScripts,
        ...resourceScripts,
        ...chatScripts,
        ...callAgentScript,
        ...teamTools,
        ...jobTools,
        ...(await createDevScriptRegistry()),
      };
      devHandler = createProductionAgentHandler({
        actions: devActions,
        systemPrompt: async (event: any) => {
          const owner = await getOwnerFromEvent(event);
          _currentRunOwner = owner;
          const resources = await loadResourcesForPrompt(owner);
          _currentRunSystemPrompt = devPrompt + resources;
          return _currentRunSystemPrompt;
        },
        model: options?.model,
        apiKey: options?.apiKey,
        onRunStart: (
          send: (event: import("../agent/types.js").AgentChatEvent) => void,
          threadId: string,
        ) => {
          _runSendByThread.set(threadId, send);
          _currentRunThreadId = threadId;
        },
        onRunComplete: async (run: any, threadId: string | undefined) => {
          if (threadId) _runSendByThread.delete(threadId);
          await onRunComplete(run, threadId);
        },
      });
    }

    // Resolve mention providers
    const rawProviders = options?.mentionProviders;
    const mentionProviders: Record<string, MentionProvider> =
      typeof rawProviders === "function"
        ? await rawProviders()
        : (rawProviders ?? {});

    // Mutable mode flag — starts in dev if environment allows
    let currentDevMode = canToggle;

    // Mount mode endpoint — GET returns current mode, POST toggles it (localhost only)
    getH3App(nitroApp).use(
      `${routePath}/mode`,
      defineEventHandler(async (event) => {
        if (getMethod(event) === "POST") {
          if (!canToggle) {
            setResponseStatus(event, 403);
            return { error: "Mode switching not available in production" };
          }
          if (!isLocalhost(event)) {
            setResponseStatus(event, 403);
            return { error: "Mode switching only available on localhost" };
          }
          const body = await readBody(event);
          if (typeof body?.devMode === "boolean") {
            currentDevMode = body.devMode;
          } else {
            currentDevMode = !currentDevMode;
          }
          return { devMode: currentDevMode, canToggle };
        }
        return { devMode: currentDevMode, canToggle };
      }),
    );

    // Mount save-key BEFORE the prefix handler so it isn't shadowed
    // Only functional in Node.js environments (writes to .env file)
    getH3App(nitroApp).use(
      `${routePath}/save-key`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const body = await readBody(event);
        const { key } = body as { key?: string };

        if (!key || typeof key !== "string" || !key.trim()) {
          setResponseStatus(event, 400);
          return { error: "API key is required" };
        }

        const trimmedKey = key.trim();

        try {
          const path = await import("path");
          const { upsertEnvFile } = await import("./create-server.js");
          const envPath = path.join(process.cwd(), ".env");
          await upsertEnvFile(envPath, [
            { key: "ANTHROPIC_API_KEY", value: trimmedKey },
          ]);
        } catch {
          // Edge runtime — can't write .env, but can still update process.env
        }

        // Update process.env so the agent works immediately
        process.env.ANTHROPIC_API_KEY = trimmedKey;

        return { ok: true };
      }),
    );

    // Mount file search endpoint
    getH3App(nitroApp).use(
      `${routePath}/files`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const query = getQuery(event);
        const q = typeof query.q === "string" ? query.q.toLowerCase() : "";

        const files: Array<{
          path: string;
          name: string;
          source: "codebase" | "resource";
          type: string;
        }> = [];
        const seen = new Set<string>();

        // In dev mode, walk the filesystem
        if (currentDevMode) {
          const codebaseFiles: Array<{
            path: string;
            name: string;
            type: "file" | "folder";
          }> = [];
          try {
            await collectFiles(process.cwd(), "", 0, codebaseFiles);
          } catch {
            // Filesystem access failed — skip
          }
          for (const f of codebaseFiles) {
            if (!seen.has(f.path)) {
              seen.add(f.path);
              files.push({
                path: f.path,
                name: f.name,
                source: "codebase",
                type: f.type,
              });
            }
          }
        }

        // Query resources
        try {
          const resources = currentDevMode
            ? await resourceListAccessible("local@localhost")
            : await resourceList(SHARED_OWNER);
          for (const r of resources) {
            if (!seen.has(r.path)) {
              seen.add(r.path);
              files.push({
                path: r.path,
                name: r.path.split("/").pop() || r.path,
                source: "resource",
                type: "file",
              });
            }
          }
        } catch {
          // Resources not available — skip
        }

        // Filter by query and limit
        const filtered = q
          ? files.filter((f) => f.path.toLowerCase().includes(q))
          : files;

        return { files: filtered.slice(0, 30) };
      }),
    );

    // Mount skills listing endpoint
    getH3App(nitroApp).use(
      `${routePath}/skills`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const skills: Array<{
          name: string;
          description?: string;
          path: string;
          source: "codebase" | "resource";
        }> = [];
        const seenNames = new Set<string>();

        // In dev mode, scan .agents/skills/ directory
        if (currentDevMode) {
          try {
            const _fs = await lazyFs();
            const skillsDir = nodePath.join(process.cwd(), ".agents", "skills");
            const entries = _fs.readdirSync(skillsDir, {
              withFileTypes: true,
            });
            for (const entry of entries) {
              // Support both flat .md files and subdirectory-based skills (dir/SKILL.md)
              let skillFilePath: string;
              let skillRelPath: string;

              if (entry.isDirectory()) {
                // Subdirectory layout: .agents/skills/<name>/SKILL.md
                const candidate = nodePath.join(
                  skillsDir,
                  entry.name,
                  "SKILL.md",
                );
                if (!_fs.existsSync(candidate)) continue;
                skillFilePath = candidate;
                skillRelPath = `.agents/skills/${entry.name}/SKILL.md`;
              } else if (entry.isFile() && entry.name.endsWith(".md")) {
                // Flat layout: .agents/skills/<name>.md
                skillFilePath = nodePath.join(skillsDir, entry.name);
                skillRelPath = `.agents/skills/${entry.name}`;
              } else {
                continue;
              }

              try {
                const content = _fs.readFileSync(skillFilePath, "utf-8");
                const fm = parseSkillFrontmatter(content);
                const skillName = fm.name || entry.name.replace(/\.md$/, "");
                if (!seenNames.has(skillName)) {
                  seenNames.add(skillName);
                  skills.push({
                    name: skillName,
                    description: fm.description,
                    path: skillRelPath,
                    source: "codebase",
                  });
                }
              } catch {
                // Could not read individual skill file — skip
              }
            }
          } catch {
            // .agents/skills/ directory doesn't exist or not readable — skip
          }
        }

        // Query resources with skills/ prefix
        try {
          const resourceSkills = currentDevMode
            ? await resourceListAccessible("local@localhost", "skills/")
            : await resourceList(SHARED_OWNER, "skills/");
          for (const r of resourceSkills) {
            // Try to get content to parse frontmatter
            let skillName =
              r.path.split("/").pop()?.replace(/\.md$/, "") || r.path;
            let description: string | undefined;
            try {
              const full = await resourceGet(r.id);
              if (full) {
                const fm = parseSkillFrontmatter(full.content);
                if (fm.name) skillName = fm.name;
                description = fm.description;
              }
            } catch {
              // Could not read resource content — use path-based name
            }
            if (!seenNames.has(skillName)) {
              seenNames.add(skillName);
              skills.push({
                name: skillName,
                description,
                path: r.path,
                source: "resource",
              });
            }
          }
        } catch {
          // Resources not available — skip
        }

        const result: {
          skills: typeof skills;
          hint?: string;
        } = { skills };

        if (skills.length === 0) {
          result.hint =
            "No skills found. Add skill files under skills/ in Resources. Learn more: https://agent-native.com/docs/resources#skills";
        }

        return result;
      }),
    );

    // Mount unified mentions endpoint (files + resources + custom providers)
    getH3App(nitroApp).use(
      `${routePath}/mentions`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const query = getQuery(event);
        const q = typeof query.q === "string" ? query.q.toLowerCase() : "";

        interface MentionItemResponse {
          id: string;
          label: string;
          description?: string;
          icon?: string;
          source: string;
          refType: string;
          refPath?: string;
          refId?: string;
          section?: string;
        }

        const matchesQuery = (item: MentionItemResponse) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          (item.description?.toLowerCase().includes(q) ?? false);

        const enc = new TextEncoder();

        // Stream NDJSON — each source flushes its batch as soon as it's ready.
        setResponseHeader(event, "Content-Type", "application/x-ndjson");
        setResponseHeader(event, "Cache-Control", "no-cache");

        const stream = new ReadableStream({
          async start(controller) {
            const MAX_RESULTS = 50;
            let totalSent = 0;
            let cancelled = false;

            const flush = (batch: MentionItemResponse[]) => {
              if (cancelled) return;
              const filtered = batch.filter(matchesQuery);
              if (filtered.length === 0) return;
              const remaining = MAX_RESULTS - totalSent;
              const toSend = filtered.slice(0, remaining);
              if (toSend.length > 0) {
                totalSent += toSend.length;
                try {
                  controller.enqueue(
                    enc.encode(JSON.stringify({ items: toSend }) + "\n"),
                  );
                } catch {
                  // Stream was closed by client
                  cancelled = true;
                }
              }
            };

            // All sources run in parallel; each flushes independently.
            const sources: Promise<void>[] = [];

            // 1. Resources from SQL (fast — flush first)
            sources.push(
              (async () => {
                try {
                  const resources = currentDevMode
                    ? await resourceListAccessible("local@localhost")
                    : await resourceList(SHARED_OWNER);
                  flush(
                    resources.map((r) => {
                      const isShared = r.owner === SHARED_OWNER;
                      return {
                        id: `resource:${r.path}`,
                        label: r.path.split("/").pop() || r.path,
                        description: r.path,
                        icon: "file",
                        source: isShared
                          ? "resource:shared"
                          : "resource:private",
                        refType: "file",
                        refPath: r.path,
                        section: "Files",
                      };
                    }),
                  );
                } catch {}
              })(),
            );

            // 2. Codebase files (dev mode only — can be slow on large repos)
            if (currentDevMode) {
              sources.push(
                (async () => {
                  const codebaseFiles: Array<{
                    path: string;
                    name: string;
                    type: "file" | "folder";
                  }> = [];
                  try {
                    await collectFiles(process.cwd(), "", 0, codebaseFiles);
                  } catch {}
                  flush(
                    codebaseFiles.map((f) => ({
                      id: `codebase:${f.path}`,
                      label: f.name,
                      description: f.path !== f.name ? f.path : undefined,
                      icon: f.type,
                      source: "codebase",
                      refType: "file",
                      refPath: f.path,
                      section: "Files",
                    })),
                  );
                })(),
              );
            }

            // 3. Custom mention providers (each flushes independently)
            for (const [key, provider] of Object.entries(mentionProviders)) {
              sources.push(
                (async () => {
                  try {
                    const providerItems = await provider.search(q, event);
                    flush(
                      providerItems.map((item) => ({
                        id: item.id,
                        label: item.label,
                        description: item.description,
                        icon: item.icon || provider.icon || "file",
                        source: key,
                        refType: item.refType,
                        refPath: item.refPath,
                        refId: item.refId,
                        section: provider.label,
                      })),
                    );
                  } catch (e) {
                    console.error(
                      `[agent-native] Mention provider "${key}" failed:`,
                      e,
                    );
                  }
                })(),
              );
            }

            // 4. Peer agent discovery (network call — often slowest)
            sources.push(
              (async () => {
                try {
                  const agents = await discoverAgents(options?.appId);
                  flush(
                    agents.map((agent) => ({
                      id: `agent:${agent.id}`,
                      label: agent.name,
                      description: agent.description,
                      icon: "agent",
                      source: "agent",
                      refType: "agent",
                      refPath: agent.url,
                      refId: agent.id,
                      section: "Agents",
                    })),
                  );
                } catch (e) {
                  console.error("[agent-native] Agent discovery failed:", e);
                }
              })(),
            );

            await Promise.all(sources);
            if (!cancelled) controller.close();
          },
          cancel() {
            // Client disconnected — stop enqueuing
          },
        });

        return stream;
      }),
    );

    // ─── Generate thread title ──────────────────────────────────────────
    getH3App(nitroApp).use(
      `${routePath}/generate-title`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        await getOwnerFromEvent(event);
        const body = await readBody(event);
        const message = body?.message;
        if (!message || typeof message !== "string") {
          setResponseStatus(event, 400);
          return { error: "message is required" };
        }
        // Strip mention markup: @[Name|type] → @Name
        const cleanMessage = message.replace(/@\[([^\]|]+)\|[^\]]*\]/g, "@$1");
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          // Fallback: truncate the message
          return { title: cleanMessage.trim().slice(0, 60) };
        }
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 30,
              messages: [
                {
                  role: "user",
                  content: `Generate a very short title (3-6 words, no quotes) for a chat that starts with this message:\n\n${cleanMessage.slice(0, 500)}`,
                },
              ],
            }),
          });
          if (!res.ok) {
            return { title: cleanMessage.trim().slice(0, 60) };
          }
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text = data.content?.[0]?.text?.trim();
          return { title: text || cleanMessage.trim().slice(0, 60) };
        } catch {
          return { title: cleanMessage.trim().slice(0, 60) };
        }
      }),
    );

    // ─── Run management endpoints (for hot-reload resilience) ─────────────

    // GET /runs/active?threadId=X — check if there's an active run for a thread
    getH3App(nitroApp).use(
      `${routePath}/runs`,
      defineEventHandler(async (event) => {
        // Auth check — ensure the user is authenticated
        await getOwnerFromEvent(event);

        const method = getMethod(event);
        const url = event.node?.req?.url || event.path || "";

        // Route: POST /runs/:id/abort
        // Match both full URL (/runs/{id}/abort) and h3 prefix-stripped (/{id}/abort)
        const abortMatch =
          url.match(/\/runs\/([^/?]+)\/abort/) ||
          url.match(/^\/([^/?]+)\/abort/);
        if (abortMatch && method === "POST") {
          const runId = decodeURIComponent(abortMatch[1]);
          abortRun(runId); // Aborts in-memory + marks aborted in SQL
          return { ok: true };
        }

        // Route: GET /runs/:id/events?after=N
        // Match both full URL (/runs/{id}/events) and h3 prefix-stripped (/{id}/events)
        const eventsMatch =
          url.match(/\/runs\/([^/?]+)\/events/) ||
          url.match(/^\/([^/?]+)\/events/);
        if (eventsMatch && method === "GET") {
          const runId = decodeURIComponent(eventsMatch[1]);
          const query = getQuery(event);
          const after = parseInt(String(query.after ?? "0"), 10) || 0;

          const stream = subscribeToRun(runId, after);
          if (!stream) {
            setResponseStatus(event, 404);
            return { error: "Run not found" };
          }

          setResponseHeader(event, "Content-Type", "text/event-stream");
          setResponseHeader(event, "Cache-Control", "no-cache");
          setResponseHeader(event, "Connection", "keep-alive");
          return stream;
        }

        // Route: GET /runs/active?threadId=X
        if (method === "GET") {
          const query = getQuery(event);
          const threadId = query.threadId ? String(query.threadId) : null;
          if (!threadId) {
            setResponseStatus(event, 400);
            return { error: "threadId query parameter is required" };
          }

          // Check in-memory first, then SQL (cross-isolate on Workers)
          const run = await getActiveRunForThreadAsync(threadId);
          if (!run) {
            setResponseStatus(event, 404);
            return { error: "No active run for this thread" };
          }

          return {
            runId: run.runId,
            threadId: run.threadId,
            status: run.status,
          };
        }

        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );

    // ─── Thread management endpoints ──────────────────────────────────────
    // Single handler for /threads and /threads/:id — h3's use() does prefix
    // matching so we can't reliably split them into separate handlers.
    getH3App(nitroApp).use(
      `${routePath}/threads`,
      defineEventHandler(async (event) => {
        const owner = await getOwnerFromEvent(event);
        const method = getMethod(event);

        // Determine if this is a specific-thread request.
        // h3's use() strips the mount prefix, so event.path contains
        // only the remainder after /threads — e.g., "/thread-abc" or "/".
        // We also check the original URL as a fallback.
        const remainder = (event.path || "").replace(/^\/+/, "");
        const fromUrl = (event.node?.req?.url || "").match(
          /\/threads\/([^/?]+)/,
        );
        const threadId = remainder
          ? decodeURIComponent(remainder.split("?")[0].split("/")[0])
          : fromUrl
            ? decodeURIComponent(fromUrl[1])
            : null;

        // ── Specific thread: GET/PUT/DELETE /threads/:id ──
        if (threadId) {
          if (method === "GET") {
            const thread = await getThread(threadId);
            if (!thread || thread.ownerEmail !== owner) {
              setResponseStatus(event, 404);
              return { error: "Thread not found" };
            }
            return thread;
          }

          if (method === "PUT") {
            const thread = await getThread(threadId);
            if (!thread || thread.ownerEmail !== owner) {
              setResponseStatus(event, 404);
              return { error: "Thread not found" };
            }
            const body = await readBody(event);
            await updateThreadData(
              threadId,
              body.threadData || thread.threadData,
              body.title ?? thread.title,
              body.preview ?? thread.preview,
              body.messageCount || thread.messageCount,
            );
            return { ok: true };
          }

          if (method === "DELETE") {
            const thread = await getThread(threadId);
            if (!thread || thread.ownerEmail !== owner) {
              setResponseStatus(event, 404);
              return { error: "Thread not found" };
            }
            await deleteThread(threadId);
            return { ok: true };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        // ── Thread list: GET/POST /threads ──
        if (method === "GET") {
          const query = getQuery(event);
          const limit = Math.min(
            parseInt(String(query.limit ?? "50"), 10) || 50,
            200,
          );
          const q = query.q ? String(query.q).trim() : "";
          if (q) {
            const threads = await searchThreads(owner, q, limit);
            return { threads };
          }
          const offset = parseInt(String(query.offset ?? "0"), 10) || 0;
          const threads = await listThreads(owner, limit, offset);
          return { threads };
        }

        if (method === "POST") {
          const body = await readBody(event);
          const thread = await createThread(owner, {
            id: body?.id,
            title: body?.title ?? "",
          });
          return thread;
        }

        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );

    // Mount the main chat handler — delegates to dev or prod handler based on current mode.
    // This is mounted last because h3's use() is prefix-based, meaning /_agent-native/agent-chat
    // also matches /_agent-native/agent-chat/threads/... — we skip sub-path requests here so the
    // earlier-mounted handlers (mode, save-key, files, skills, mentions, threads) handle them.
    getH3App(nitroApp).use(
      routePath,
      defineEventHandler(async (event) => {
        // Skip sub-path requests — they're handled by earlier-mounted handlers
        const url = event.node?.req?.url || event.path || "";
        const afterBase = url.slice(url.indexOf(routePath) + routePath.length);
        if (afterBase && afterBase !== "/" && !afterBase.startsWith("?")) {
          // Not for us — return 404 so h3 doesn't swallow the request
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }

        // Set AGENT_USER_EMAIL so scripts resolve the same owner as the session.
        // Without this, scripts default to "local@localhost" and miss resources
        // created by users who authenticated via OAuth (e.g., Gmail).
        const owner = await getOwnerFromEvent(event);
        process.env.AGENT_USER_EMAIL = owner;

        // Set AGENT_ORG_ID so db-query/db-exec scope by org_id when applicable.
        // Priority: explicit resolveOrgId callback > session.orgId from Better Auth
        let resolvedOrgId: string | null = null;
        if (options?.resolveOrgId) {
          resolvedOrgId = await options.resolveOrgId(event);
        } else {
          try {
            const session = await getSession(event);
            resolvedOrgId = session?.orgId ?? null;
          } catch {
            // Session not available
          }
        }
        if (resolvedOrgId) {
          process.env.AGENT_ORG_ID = resolvedOrgId;
        } else {
          delete process.env.AGENT_ORG_ID;
        }

        const handler = currentDevMode && devHandler ? devHandler : prodHandler;
        return handler(event);
      }),
    );

    // ─── Recurring Jobs Scheduler ──────────────────────────────────────
    // Poll every 60 seconds for due recurring jobs and execute them.
    // Uses setInterval so it works in all deployment environments without
    // requiring Nitro experimental tasks configuration.
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const { processRecurringJobs } = await import("../jobs/scheduler.js");

        const schedulerDeps = {
          getActions: () => ({
            ...templateScripts,
            ...resourceScripts,
            ...chatScripts,
            ...jobTools,
          }),
          getSystemPrompt: async (owner: string) => {
            const resources = await loadResourcesForPrompt(owner);
            return basePrompt + resources;
          },
          getTools: (actions: Record<string, ActionEntry>) =>
            Object.entries(actions).map(([name, entry]) => ({
              name,
              description: entry.tool.description,
              input_schema: entry.tool.parameters ?? {
                type: "object" as const,
                properties: {},
              },
            })),
          apiKey,
          model: resolvedModel,
        };

        // Start after a 10-second delay to let the server fully initialize
        setTimeout(() => {
          setInterval(() => {
            processRecurringJobs(schedulerDeps).catch((err) => {
              console.error("[recurring-jobs] Scheduler error:", err?.message);
            });
          }, 60_000);
          if (process.env.DEBUG)
            console.log("[recurring-jobs] Scheduler started (60s interval)");
        }, 10_000);
      } catch (err) {
        // Jobs module not available — skip silently
      }
    }
  };
}

/**
 * Default agent chat plugin with no template-specific actions.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();
