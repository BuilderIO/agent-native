import {
  createProductionAgentHandler,
  type ScriptEntry,
} from "../agent/production-agent.js";
import { createDevScriptRegistry } from "../scripts/dev/index.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  /** Template-specific scripts (email ops, booking ops, etc.) */
  scripts?: Record<string, ScriptEntry>;
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

Be concise and helpful. Use the available tools to read data, make changes, and assist the user.`;

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
export function createAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return (nitroApp: any) => {
    const isDev = process.env.NODE_ENV !== "production";
    const routePath = options?.path ?? "/api/agent-chat";

    // Merge template scripts with dev tools when in development
    const templateScripts = options?.scripts ?? {};
    const scripts = isDev
      ? { ...templateScripts, ...createDevScriptRegistry() }
      : templateScripts;

    // Build system prompt
    const basePrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const devPrefix = options?.devSystemPrompt ?? DEFAULT_DEV_PROMPT;
    const systemPrompt = isDev ? devPrefix + basePrompt : basePrompt;

    const handler = createProductionAgentHandler({
      scripts,
      systemPrompt,
      model: options?.model,
      apiKey: options?.apiKey,
    });

    // Mount the handler directly — it already handles method checks and SSE streaming
    nitroApp.h3App.use(routePath, handler);
  };
}

/**
 * Default agent chat plugin with no template-specific scripts.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();
