import {
  createProductionAgentHandler,
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
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import {
  defineEventHandler,
  readBody,
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
import fs from "node:fs";
import nodePath from "node:path";

/**
 * Wraps a core CLI script (that writes to console.log) as a ActionEntry
 * by capturing stdout.
 */
/** Sentinel thrown by our process.exit interceptor */
class ExitIntercepted extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

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
      const origExit = process.exit;
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
      // Intercept process.exit so scripts don't kill the server
      process.exit = ((code?: number) => {
        throw new ExitIntercepted(code ?? 0);
      }) as never;
      try {
        await cliDefault(cliArgs);
      } catch (err: any) {
        if (!(err instanceof ExitIntercepted)) {
          logs.push(`Error: ${err?.message ?? String(err)}`);
        }
      } finally {
        console.log = origLog;
        console.error = origError;
        process.stdout.write = origStdoutWrite;
        process.exit = origExit;
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
2. **Context awareness** — Before taking action, understand what the user is looking at. Use the \`view-screen\` tool if available — it returns the current UI state (which page, which item is focused, what's selected).
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
`;

const PROD_FRAMEWORK_PROMPT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.
${FRAMEWORK_CORE}`;

const DEV_FRAMEWORK_PROMPT = `## Agent-Native Framework — Development Mode

You are an AI agent in an agent-native application, running in **development mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via tools/scripts, and vice versa. They share the same SQL database and stay in sync automatically.

**In development mode, you have full access to the project filesystem, shell, and database** — in addition to all the app's production tools. You can edit source code, run commands, install packages, and modify the app directly.

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
 * import { createAgentChatPlugin } from "@agent-native/core/server";
 * import { scriptRegistry } from "../../scripts/registry.js";
 *
 * export default createAgentChatPlugin({
 *   scripts: scriptRegistry,
 *   systemPrompt: "You are an email assistant...",
 * });
 * ```
 */
function collectFiles(
  dir: string,
  prefix: string,
  depth: number,
  results: Array<{ path: string; name: string; type: "file" | "folder" }>,
): void {
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
  let entries: fs.Dirent[];
  try {
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
      collectFiles(nodePath.join(dir, entry.name), relPath, depth + 1, results);
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

    // Resource and cross-agent scripts are available in both prod and dev modes
    const resourceScripts = await createResourceScriptEntries();
    const callAgentScript = await createCallAgentScriptEntry();

    // Auto-mount A2A protocol endpoints so every app is discoverable
    // and callable by other agents via the standard protocol.
    // The custom handler calls the local agent-chat endpoint to process
    // A2A messages using the same production agent pipeline.
    const allScripts = {
      ...templateScripts,
      ...resourceScripts,
      ...callAgentScript,
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
      handler: async (message) => {
        const text = message.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");

        if (!text) {
          return {
            message: {
              role: "agent" as const,
              parts: [
                { type: "text" as const, text: "No text content in message" },
              ],
            },
          };
        }

        // Run a lean agent loop for A2A — minimal prompt, only template scripts.
        // Full resources/framework prompt would blow up the payload and hit rate limits.
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return {
            message: {
              role: "agent" as const,
              parts: [
                {
                  type: "text" as const,
                  text: "Anthropic API key is not configured. Set ANTHROPIC_API_KEY in .env.",
                },
              ],
            },
          };
        }
        const client = new Anthropic({ apiKey });
        const model = options?.model ?? "claude-sonnet-4-6";
        const a2aSystemPrompt = `You are the ${options?.appId ?? "app"} agent responding to a request from another agent. Be concise and helpful. Use your tools to look up data or take actions as needed.`;

        // Only include template scripts (not resource/call-agent meta-scripts) to keep payload small
        const tools: any[] = Object.entries(templateScripts).map(
          ([name, entry]) => ({
            name,
            description: entry.tool.description,
            input_schema: entry.tool.parameters ?? {
              type: "object" as const,
              properties: {},
            },
          }),
        );

        console.log(
          `[A2A Handler] System prompt: ${a2aSystemPrompt.length} chars, ${tools.length} tools`,
        );

        const msgs: any[] = [{ role: "user", content: text }];
        const textParts: string[] = [];

        for (let i = 0; i < 10; i++) {
          const response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: a2aSystemPrompt,
            tools: tools.length > 0 ? tools : undefined,
            messages: msgs,
          });

          const toolUseBlocks: any[] = [];
          for (const block of response.content) {
            if (block.type === "text") textParts.push(block.text);
            if (block.type === "tool_use") toolUseBlocks.push(block);
          }

          if (
            toolUseBlocks.length === 0 ||
            response.stop_reason !== "tool_use"
          ) {
            break;
          }

          msgs.push({ role: "assistant", content: response.content });
          const toolResults = [];
          for (const tb of toolUseBlocks) {
            const script = allScripts[tb.name];
            let result = `Unknown tool: ${tb.name}`;
            if (script) {
              try {
                result = await script.run(tb.input as Record<string, string>);
              } catch (err: any) {
                result = `Error: ${err?.message}`;
              }
            }
            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: tb.id,
              content: result,
            });
          }
          msgs.push({ role: "user", content: toolResults });
        }

        return {
          message: {
            role: "agent" as const,
            parts: [
              {
                type: "text" as const,
                text: textParts.join("") || "(no response)",
              },
            ],
          },
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

    // Resolve owner from the H3 event's session — matches how resources are created
    const getOwnerFromEvent = async (event: any): Promise<string> => {
      try {
        const session = await getSession(event);
        return session?.email || "local@localhost";
      } catch {
        return "local@localhost";
      }
    };

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
        if (lastMsg?.role === "assistant") {
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

        repo.messages.push(assistantMsg);

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

    // Always build the production handler (includes resource tools + call-agent)
    const prodHandler = createProductionAgentHandler({
      actions: { ...templateScripts, ...resourceScripts, ...callAgentScript },
      systemPrompt: async (event: any) => {
        const owner = await getOwnerFromEvent(event);
        const resources = await loadResourcesForPrompt(owner);
        return basePrompt + resources;
      },
      model: options?.model,
      apiKey: options?.apiKey,
      onRunComplete,
    });

    // Build the dev handler (with filesystem/shell/db tools) if environment allows toggling
    let devHandler: ReturnType<typeof createProductionAgentHandler> | null =
      null;
    if (canToggle) {
      const { createDevScriptRegistry } =
        await import("../scripts/dev/index.js");
      const devActions = {
        ...templateScripts,
        ...resourceScripts,
        ...callAgentScript,
        ...(await createDevScriptRegistry()),
      };
      devHandler = createProductionAgentHandler({
        actions: devActions,
        systemPrompt: async (event: any) => {
          const owner = await getOwnerFromEvent(event);
          const resources = await loadResourcesForPrompt(owner);
          return devPrompt + resources;
        },
        model: options?.model,
        apiKey: options?.apiKey,
        onRunComplete,
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
    nitroApp.h3App.use(
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
    nitroApp.h3App.use(
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
          upsertEnvFile(envPath, [
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
    nitroApp.h3App.use(
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
            collectFiles(process.cwd(), "", 0, codebaseFiles);
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
    nitroApp.h3App.use(
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
            const skillsDir = nodePath.join(process.cwd(), ".agents", "skills");
            const entries = fs.readdirSync(skillsDir, {
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
                if (!fs.existsSync(candidate)) continue;
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
                const content = fs.readFileSync(skillFilePath, "utf-8");
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
    nitroApp.h3App.use(
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

        const items: MentionItemResponse[] = [];

        // 1. Built-in: files from codebase (dev mode only)
        if (currentDevMode) {
          const codebaseFiles: Array<{
            path: string;
            name: string;
            type: "file" | "folder";
          }> = [];
          try {
            collectFiles(process.cwd(), "", 0, codebaseFiles);
          } catch {}
          for (const f of codebaseFiles) {
            items.push({
              id: `codebase:${f.path}`,
              label: f.name,
              description: f.path !== f.name ? f.path : undefined,
              icon: f.type,
              source: "codebase",
              refType: "file",
              refPath: f.path,
              section: "Files",
            });
          }
        }

        // 2. Built-in: resources from SQL
        try {
          const resources = currentDevMode
            ? await resourceListAccessible("local@localhost")
            : await resourceList(SHARED_OWNER);
          for (const r of resources) {
            const isShared = r.owner === SHARED_OWNER;
            items.push({
              id: `resource:${r.path}`,
              label: r.path.split("/").pop() || r.path,
              description: r.path,
              icon: "file",
              source: isShared ? "resource:shared" : "resource:private",
              refType: "file",
              refPath: r.path,
              section: "Files",
            });
          }
        } catch {}

        // 3. Custom mention providers
        const providerResults = await Promise.all(
          Object.entries(mentionProviders).map(async ([key, provider]) => {
            try {
              const providerItems = await provider.search(q);
              return providerItems.map((item) => ({
                id: item.id,
                label: item.label,
                description: item.description,
                icon: item.icon || provider.icon || "file",
                source: key,
                refType: item.refType,
                refPath: item.refPath,
                refId: item.refId,
                section: provider.label,
              }));
            } catch {
              return [];
            }
          }),
        );
        for (const batch of providerResults) {
          items.push(...batch);
        }

        // 4. Discovered peer agents
        try {
          const { discoverAgents } = await import("./agent-discovery.js");
          const agents = discoverAgents(options?.appId);
          for (const agent of agents) {
            items.push({
              id: `agent:${agent.id}`,
              label: agent.name,
              description: agent.description,
              icon: "agent",
              source: "agent",
              refType: "agent",
              refPath: agent.url,
              refId: agent.id,
              section: "Agents",
            });
          }
        } catch {
          // Agent discovery not available — skip
        }

        // Filter by query and limit
        const filtered = q
          ? items.filter(
              (item) =>
                item.label.toLowerCase().includes(q) ||
                (item.description?.toLowerCase().includes(q) ?? false),
            )
          : items;

        return { items: filtered.slice(0, 30) };
      }),
    );

    // ─── Generate thread title ──────────────────────────────────────────
    nitroApp.h3App.use(
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
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          // Fallback: truncate the message
          return { title: message.trim().slice(0, 60) };
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
                  content: `Generate a very short title (3-6 words, no quotes) for a chat that starts with this message:\n\n${message.slice(0, 500)}`,
                },
              ],
            }),
          });
          if (!res.ok) {
            return { title: message.trim().slice(0, 60) };
          }
          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text = data.content?.[0]?.text?.trim();
          return { title: text || message.trim().slice(0, 60) };
        } catch {
          return { title: message.trim().slice(0, 60) };
        }
      }),
    );

    // ─── Run management endpoints (for hot-reload resilience) ─────────────

    // GET /runs/active?threadId=X — check if there's an active run for a thread
    nitroApp.h3App.use(
      `${routePath}/runs`,
      defineEventHandler(async (event) => {
        // Auth check — ensure the user is authenticated
        await getOwnerFromEvent(event);

        const method = getMethod(event);
        const url = event.node?.req?.url || event.path || "";

        // Route: POST /runs/:id/abort
        const abortMatch = url.match(/\/runs\/([^/?]+)\/abort/);
        if (abortMatch && method === "POST") {
          const runId = decodeURIComponent(abortMatch[1]);
          abortRun(runId); // Aborts in-memory + marks aborted in SQL
          return { ok: true };
        }

        // Route: GET /runs/:id/events?after=N
        const eventsMatch = url.match(/\/runs\/([^/?]+)\/events/);
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
    nitroApp.h3App.use(
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
    nitroApp.h3App.use(
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

        const handler = currentDevMode && devHandler ? devHandler : prodHandler;
        return handler(event);
      }),
    );
  };
}

/**
 * Default agent chat plugin with no template-specific actions.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();
