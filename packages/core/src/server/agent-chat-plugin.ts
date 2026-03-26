import {
  createProductionAgentHandler,
  type ScriptEntry,
} from "../agent/production-agent.js";
import type { ScriptTool } from "../agent/types.js";
import { defineEventHandler, readBody, setResponseStatus, getMethod } from "h3";
import { agentEnv } from "../shared/agent-env.js";

/**
 * Wraps a core CLI script (that writes to console.log) as a ScriptEntry
 * by capturing stdout.
 */
function wrapCliScript(
  tool: ScriptTool,
  cliDefault: (args: string[]) => Promise<void>,
): ScriptEntry {
  return {
    tool,
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        cliArgs.push(`--${k}`, v);
      }
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };
      try {
        await cliDefault(cliArgs);
      } catch (err: any) {
        logs.push(`Error: ${err?.message ?? String(err)}`);
      } finally {
        console.log = origLog;
      }
      return logs.join("\n") || "(no output)";
    },
  };
}

/**
 * Creates resource ScriptEntries available in both prod and dev modes.
 */
async function createResourceScriptEntries(): Promise<
  Record<string, ScriptEntry>
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
                  "Resource path (e.g. 'learnings.md', 'notes/ideas.md')",
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
                  "Resource path (e.g. 'learnings.md', 'notes/ideas.md')",
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

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  /** Template-specific scripts (email ops, booking ops, etc.) */
  scripts?:
    | Record<string, ScriptEntry>
    | (() =>
        | Record<string, ScriptEntry>
        | Promise<Record<string, ScriptEntry>>);
  /** System prompt for the agent. A sensible default is provided. */
  systemPrompt?: string;
  /** Additional system prompt prepended in dev mode */
  devSystemPrompt?: string;
  /** Claude model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Route path. Default: /api/agent-chat */
  path?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for this application. You can help users by running available tools and answering questions.

Be concise and helpful. Use the available tools to read data, make changes, and assist the user.

You have access to a Resources system for persistent notes, learnings, and context files.
Use resource-list, resource-read, resource-write, and resource-delete to manage resources.
Resources can be personal (per-user) or shared (team-wide). By default, resources are personal.
At the start of conversations, read the "learnings.md" resource for user preferences and context.
When you learn something important (user corrections, preferences, patterns), update the "learnings.md" resource.`;

const DEFAULT_DEV_PROMPT = `You are a development assistant with full access to the project filesystem, shell, and database.

You can:
- Read, write, and edit any file in the project (read-file, write-file)
- List and search files (list-files, search-files)
- Run shell commands (shell) — use for git, build, install, etc.
- Query and modify the database (db-schema, db-query, db-exec)
- Plus all application-specific tools

When editing code, maintain existing patterns and conventions. After writing files, mention what you changed. Use read-file before write-file to understand existing content.

`;

/**
 * Creates a Nitro plugin that mounts the agent chat endpoint.
 *
 * In dev mode (NODE_ENV !== "production"), automatically includes
 * file system, shell, and database tools alongside any template-specific scripts.
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
    const routePath = options?.path ?? "/api/agent-chat";

    // Resolve scripts — supports lazy loading to avoid import issues with Vite SSR
    const rawScripts = options?.scripts;
    const templateScripts =
      typeof rawScripts === "function"
        ? await rawScripts()
        : (rawScripts ?? {});

    // Resource scripts are available in both prod and dev modes
    const resourceScripts = await createResourceScriptEntries();

    // Build system prompts
    const basePrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const devPrefix = options?.devSystemPrompt ?? DEFAULT_DEV_PROMPT;

    // Always build the production handler (includes resource tools)
    const prodHandler = createProductionAgentHandler({
      scripts: { ...templateScripts, ...resourceScripts },
      systemPrompt: basePrompt,
      model: options?.model,
      apiKey: options?.apiKey,
    });

    // Build the dev handler (with filesystem/shell/db tools) if environment allows toggling
    let devHandler: ReturnType<typeof createProductionAgentHandler> | null =
      null;
    if (canToggle) {
      const { createDevScriptRegistry } =
        await import("../scripts/dev/index.js");
      const devScripts = {
        ...templateScripts,
        ...resourceScripts,
        ...(await createDevScriptRegistry()),
      };
      devHandler = createProductionAgentHandler({
        scripts: devScripts,
        systemPrompt: devPrefix + basePrompt,
        model: options?.model,
        apiKey: options?.apiKey,
      });
    }

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

    // Mount the main chat handler — delegates to dev or prod handler based on current mode
    nitroApp.h3App.use(
      routePath,
      defineEventHandler((event) => {
        const handler = currentDevMode && devHandler ? devHandler : prodHandler;
        return handler(event);
      }),
    );
  };
}

/**
 * Default agent chat plugin with no template-specific scripts.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();
