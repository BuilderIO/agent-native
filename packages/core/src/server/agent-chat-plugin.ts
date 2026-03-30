import {
  createProductionAgentHandler,
  type ScriptEntry,
} from "../agent/production-agent.js";
import type {
  ScriptTool,
  MentionProvider,
  MentionProviderItem,
} from "../agent/types.js";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
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
 * Wraps a core CLI script (that writes to console.log) as a ScriptEntry
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
  /** Custom mention providers for @-tagging template entities */
  mentionProviders?:
    | Record<string, MentionProvider>
    | (() =>
        | Record<string, MentionProvider>
        | Promise<Record<string, MentionProvider>>);
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for this application. You can help users by running available tools and answering questions.

Be concise and helpful. Use the available tools to read data, make changes, and assist the user.

You have access to a Resources system for persistent notes, learnings, and context files.
Use resource-list, resource-read, resource-write, and resource-delete to manage resources.
Resources can be personal (per-user) or shared (team-wide). By default, resources are personal.

When you learn something important (user corrections, preferences, patterns), update the "LEARNINGS.md" resource. Keep it tidy — revise, consolidate, and remove outdated entries rather than only appending. The file should stay concise and scannable.
When the user gives instructions that should apply to all users/sessions, update the shared "AGENTS.md" resource instead.`;

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
    "\n\nThe following resources were pre-loaded for context. Use the information in them to help the user (e.g., contacts, preferences, instructions). You can update them with resource-write if needed.\n\n" +
    sections.join("\n\n")
  );
}

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
    const routePath = options?.path ?? "/api/agent-chat";

    // Resolve scripts — supports lazy loading to avoid import issues with Vite SSR
    const rawScripts = options?.scripts;
    const templateScripts =
      typeof rawScripts === "function"
        ? await rawScripts()
        : (rawScripts ?? {});

    // Resource scripts are available in both prod and dev modes
    const resourceScripts = await createResourceScriptEntries();

    // Build system prompts — dynamic functions that pre-load resources per-request
    const basePrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
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

    // Always build the production handler (includes resource tools)
    const prodHandler = createProductionAgentHandler({
      scripts: { ...templateScripts, ...resourceScripts },
      systemPrompt: async (event: any) => {
        const owner = await getOwnerFromEvent(event);
        const resources = await loadResourcesForPrompt(owner);
        return basePrompt + resources;
      },
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
        systemPrompt: async (event: any) => {
          const owner = await getOwnerFromEvent(event);
          const resources = await loadResourcesForPrompt(owner);
          return devPrefix + basePrompt + resources;
        },
        model: options?.model,
        apiKey: options?.apiKey,
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
              if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
              try {
                const content = fs.readFileSync(
                  nodePath.join(skillsDir, entry.name),
                  "utf-8",
                );
                const fm = parseSkillFrontmatter(content);
                const skillName = fm.name || entry.name.replace(/\.md$/, "");
                if (!seenNames.has(skillName)) {
                  seenNames.add(skillName);
                  skills.push({
                    name: skillName,
                    description: fm.description,
                    path: `.agents/skills/${entry.name}`,
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
              }));
            } catch {
              return [];
            }
          }),
        );
        for (const batch of providerResults) {
          items.push(...batch);
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
              body.messageCount ?? thread.messageCount,
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
    // This is mounted last because h3's use() is prefix-based, meaning /api/agent-chat
    // also matches /api/agent-chat/threads/... — we skip sub-path requests here so the
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
 * Default agent chat plugin with no template-specific scripts.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();
