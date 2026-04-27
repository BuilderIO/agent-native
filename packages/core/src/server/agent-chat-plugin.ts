import { runWithRequestContext, getRequestOrgId } from "./request-context.js";
import { getSetting, putSetting } from "../settings/store.js";
import { getH3App, trackPluginInit } from "./framework-request-handler.js";
import {
  createProductionAgentHandler,
  runAgentLoop,
  actionsToEngineTools,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  subscribeToRun,
  type ActionEntry,
} from "../agent/production-agent.js";
import type { AgentEngine, EngineMessage } from "../agent/engine/types.js";
import { resolveEngine, createAnthropicEngine } from "../agent/engine/index.js";
import type {
  ActionTool,
  MentionProvider,
  MentionProviderItem,
} from "../agent/types.js";
import type { ActionHttpConfig } from "../action.js";
import {
  McpClientManager,
  loadMcpConfig,
  autoDetectMcpConfig,
  mcpToolsToActionEntries,
  syncMcpActionEntries,
  mountMcpServersRoutes,
  mountMcpHubRoutes,
  buildMergedConfig,
  getHubStatus,
  isHubServeEnabled,
} from "../mcp-client/index.js";
import { discoverAgents } from "./agent-discovery.js";
import { loadSchemaPromptBlock } from "./schema-prompt.js";
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
  getHeader,
} from "h3";
import { agentEnv } from "../shared/agent-env.js";
import { getSession } from "./auth.js";
import { getOrigin } from "./google-oauth.js";
import {
  createThread,
  forkThread,
  getThread,
  listThreads,
  searchThreads,
  updateThreadData,
  withThreadDataLock,
  deleteThread,
  setThreadQueuedMessages,
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
import { getBuilderBrowserConnectUrl } from "./builder-browser.js";

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
  opts?: { readOnly?: boolean },
): ActionEntry {
  return {
    tool,
    ...(opts?.readOnly ? { readOnly: true as const } : {}),
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
 * Creates the `get-framework-context` tool. Returns detailed instructions
 * for framework capabilities that are summarized in the compact prompt.
 * The agent calls this on-demand when it needs specifics about embeds,
 * agent teams, recurring jobs, etc.
 */
function createFrameworkContextEntry(): Record<string, ActionEntry> {
  const topicList = Object.keys(FRAMEWORK_CONTEXT_SECTIONS).join(", ");
  return {
    "get-framework-context": {
      tool: {
        description: `Read detailed framework instructions for a specific capability. Available topics: ${topicList}. Call with topic="all" to get everything.`,
        parameters: {
          type: "object" as const,
          properties: {
            topic: {
              type: "string",
              description: `Topic to read. One of: ${topicList}, or "all" for everything.`,
            },
          },
          required: ["topic"],
        },
      },
      run: async (args: Record<string, string>) => {
        const topic = String(args.topic ?? "all").toLowerCase();
        if (topic === "all") {
          return Object.values(FRAMEWORK_CONTEXT_SECTIONS).join("\n\n");
        }
        const section = FRAMEWORK_CONTEXT_SECTIONS[topic];
        if (!section) {
          return `Unknown topic "${topic}". Available: ${topicList}`;
        }
        return section;
      },
      readOnly: true,
    },
  };
}

/**
 * Creates the `refresh-screen` tool. Writes a bump to `application_state`
 * under a well-known key; the client's `useDbSync` watches for this and
 * invalidates react-query caches so the on-screen UI re-fetches its data
 * without a full page reload.
 *
 * This is the standard way for the agent to say "the data on the screen
 * just changed, please refresh it" — e.g. after editing a dashboard config,
 * updating a form schema, or mutating a row that the current view renders.
 */
function createRefreshScreenEntry(): Record<string, ActionEntry> {
  return {
    "refresh-screen": {
      // Writes __screen_refresh__ to application_state, which emits its own
      // distinct `screen-refresh` poll event. Don't double-emit a generic
      // `action` event on top of that.
      readOnly: true,
      tool: {
        description:
          "Manually refresh the user's current screen. The framework ALREADY auto-refreshes after any successful mutating action tool call (template actions, db-exec, db-patch) — you do NOT need to call this after a normal action. Use it only when (a) you mutated data via a path the framework can't detect (e.g. a direct write to an external system the app mirrors), or (b) you want to pass a `scope` hint so the UI narrows which queries to refetch. The UI re-fetches its queries without a full page reload.",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description:
                "Optional hint describing what changed (e.g. 'dashboard', 'form', 'settings'). Templates may use it to narrow which queries to invalidate; if omitted, all queries are invalidated.",
            },
          },
        },
      },
      run: async (args) => {
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        const nonce = Date.now();
        const scope = typeof args?.scope === "string" ? args.scope : undefined;
        await writeAppState(SCREEN_REFRESH_KEY, {
          nonce,
          ...(scope ? { scope } : {}),
        });
        return `refreshed${scope ? ` (scope: ${scope})` : ""}`;
      },
    },
  };
}

/** Well-known application-state key used by the refresh-screen tool. */
const SCREEN_REFRESH_KEY = "__screen_refresh__";

/**
 * Creates the `set-search-params` / `set-url-path` tools. Writes a one-shot
 * URL command to application_state; the client's URLSync component applies
 * it via react-router (no full page reload) and then deletes the command.
 *
 * This is how the agent edits URL state — filter query params, route
 * changes, hash — without needing a per-template navigate action. The
 * current URL is visible to the agent via the auto-injected `<current-url>`
 * block, which includes parsed search params.
 */
function createUrlTools(): Record<string, ActionEntry> {
  return {
    "set-search-params": {
      // Writes __set_url__ to application_state, which the app-state watcher
      // already surfaces as a poll event. No need to double-emit.
      readOnly: true,
      tool: {
        description:
          "Update the URL query string on the user's current page. Use this to change dashboard/list filters, search terms, or any other state the app stores in `?foo=bar` style query params. One-shot — the UI applies it in ~1s without a page reload. See the current URL + parsed search params in the auto-injected `<current-url>` block. Keys are the exact query param names as they appear in the URL (e.g. `f_pubDateStart`, not just `pubDateStart`). Set a value to null or empty string to clear that param. By default merges over existing params — pass `merge: false` to replace them all.",
        parameters: {
          type: "object",
          properties: {
            params: {
              type: "object",
              description:
                'Map of query param → value. Each value is a string, or null/"" to clear. Example: {"f_pubDateStart": null, "f_cadence": "MONTH"}.',
            },
            merge: {
              type: "string",
              description:
                '"true" (default) merges over existing params; "false" replaces them entirely.',
              enum: ["true", "false"],
            },
          },
          required: ["params"],
        },
      },
      run: async (args) => {
        const params = (args?.params ?? {}) as unknown as Record<
          string,
          string | null
        >;
        const merge = (args as any)?.merge !== "false";
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        await writeAppState("__set_url__", {
          searchParams: params,
          mergeSearchParams: merge,
        });
        const keys = Object.keys(params);
        return `set-search-params: ${keys.length} key${keys.length === 1 ? "" : "s"}${merge ? "" : " (replace)"}`;
      },
    },
    "set-url-path": {
      // Same as set-search-params — writes application_state, already emits
      // via the app-state watcher.
      readOnly: true,
      tool: {
        description:
          "Navigate the user to a different pathname, optionally also setting search params. For most template-specific routing prefer the template's `navigate` action if it exists — this is the generic fallback. One-shot, applied by the client without a page reload.",
        parameters: {
          type: "object",
          properties: {
            pathname: {
              type: "string",
              description: "New URL pathname (e.g. '/adhoc/weekly').",
            },
            params: {
              type: "object",
              description:
                'Optional query params to set alongside the path change. String values set, null/"" clears.',
            },
            merge: {
              type: "string",
              description:
                '"true" (default) merges over existing params; "false" starts fresh.',
              enum: ["true", "false"],
            },
          },
          required: ["pathname"],
        },
      },
      run: async (args) => {
        const pathname = String(args?.pathname ?? "");
        if (!pathname.startsWith("/")) {
          return "Error: pathname must start with '/'.";
        }
        const params = (args?.params ?? {}) as unknown as Record<
          string,
          string | null
        >;
        const merge = (args as any)?.merge !== "false";
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        await writeAppState("__set_url__", {
          pathname,
          searchParams: params,
          mergeSearchParams: merge,
        });
        return `set-url-path: ${pathname}`;
      },
    },
  };
}

/**
 * Creates db-* tools (db-query, db-exec, db-patch, db-schema) as native tools.
 * These let the agent read and write the app's own SQL database. Scoping to
 * the current user/org is enforced automatically in production via temp views.
 *
 * In dev mode template actions are invoked via shell and the agent can call
 * `pnpm action db-query ...` — but in production there is no shell, so these
 * must be registered as native tools for the agent to reach the app DB at all.
 */
async function createDbScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const [schemaMod, queryMod, execMod, patchMod] = await Promise.all([
      import("../scripts/db/schema.js"),
      import("../scripts/db/query.js"),
      import("../scripts/db/exec.js"),
      import("../scripts/db/patch.js"),
    ]);

    return {
      "db-schema": wrapCliScript(
        {
          description:
            "Show the app's SQL schema — all tables, columns, types, indexes, and foreign keys. Use this to understand the data model before querying.",
          parameters: {
            type: "object",
            properties: {
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        schemaMod.default,
        { readOnly: true },
      ),
      "db-query": wrapCliScript(
        {
          description:
            "Read from the app's own SQL database ONLY. Runs a SELECT against the app's internal tables (settings, application_state, template tables). Results are auto-scoped to the current user/org. IMPORTANT: This tool CANNOT access external data sources like BigQuery, HubSpot, Jira, GA4, etc. For those, use the appropriate template action (e.g. `bigquery` for warehouse tables, `ga4-report` for Google Analytics). If a table isn't in the app schema, don't try db-query — use the data-source-specific action.",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "SELECT query to run, e.g. \"SELECT key, value FROM settings WHERE key LIKE 'sql-dashboard-%'\"",
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
              limit: {
                type: "string",
                description:
                  "Append LIMIT N if the query doesn't already have one",
              },
            },
            required: ["sql"],
          },
        },
        queryMod.default,
        { readOnly: true },
      ),
      "db-exec": wrapCliScript(
        {
          description:
            "Write to the app's own SQL database ONLY. Runs INSERT / UPDATE / DELETE against the app's internal tables. Writes are auto-scoped to the current user/org, and `owner_email` / `org_id` are auto-injected on INSERT. IMPORTANT: This tool CANNOT write to external data sources like BigQuery, HubSpot, etc. For external services, use the appropriate template action.",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "INSERT / UPDATE / DELETE statement. Use parameterized placeholders (?) if possible.",
              },
            },
            required: ["sql"],
          },
        },
        execMod.default,
      ),
      "db-patch": wrapCliScript(
        {
          description:
            "Surgical patch on a large text/JSON column in the app's SQL database. Two modes: (1) text find/replace via `find`/`replace`/`edits` — best for small edits to documents, slide HTML, etc. (2) structural JSON ops via `json-ops` — STRONGLY PREFERRED when the column is JSON (dashboard configs, form schemas, slide decks) because it avoids all the brace/quote/comma surgery that text find/replace requires. Use `json-ops` to set/remove values at a JSON Pointer path, or to move/insert array items — e.g. reorder dashboard panels, add a filter, rename a field. Targets exactly one row (narrow `where` by primary key). Same per-user/org scoping as db-exec.",
          parameters: {
            type: "object",
            properties: {
              table: {
                type: "string",
                description: "Table name (e.g. 'settings')",
              },
              column: {
                type: "string",
                description:
                  "Text/JSON column to patch (e.g. 'value' for settings)",
              },
              where: {
                type: "string",
                description:
                  "WHERE clause that matches exactly one row (e.g. \"key = 'o:org1:sql-dashboard-foo'\")",
              },
              find: {
                type: "string",
                description:
                  "Text mode: substring to find. Must match EXACTLY ONE occurrence by default (like Claude Code's Edit tool). If 0 matches, you get 'NOT FOUND'. If >1 matches, you get surrounding context for each match — widen `find` with unique context and retry. Use `all: \"true\"` to replace every occurrence.",
              },
              replace: {
                type: "string",
                description: "Text mode: replacement substring",
              },
              edits: {
                type: "string",
                description:
                  'Text mode batch: JSON array of {find, replace} pairs. Same uniqueness rule applies to each `find`. Example: \'[{"find":"a","replace":"b"}]\'',
              },
              "json-ops": {
                type: "string",
                description:
                  'JSON mode: JSON array of structural ops. Each op is {op, path, value?, from?}. `op` is one of "set", "remove", "insert", "move", "move-before". `path` / `from` use JSON Pointer ("/panels/3/title"). Examples — reorder: \'[{"op":"move","from":"/panels/7","path":"/panels/1"}]\'; edit field: \'[{"op":"set","path":"/panels/0/title","value":"New"}]\'; delete filter: \'[{"op":"remove","path":"/filters/2"}]\'; add panel: \'[{"op":"insert","path":"/panels/0","value":{"id":"p","title":"..."}}]\'. Much safer than text find/replace for JSON columns.',
              },
              all: {
                type: "string",
                description:
                  'Text mode: set to "true" to replace every occurrence of each `find` (default requires exactly one match)',
                enum: ["true"],
              },
            },
            required: ["table", "column", "where"],
          },
        },
        patchMod.default,
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Creates the docs-search tool so agents can look up framework documentation.
 * Docs are bundled in @agent-native/core and read via fs at runtime.
 */
async function createDocsScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const mod = await import("../scripts/docs/search.js");
    return {
      "docs-search": wrapCliScript(
        {
          description:
            "Search and read agent-native framework documentation. Use --list to see all pages, --query to search, --slug to read a specific page.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search term to find relevant docs (e.g. 'actions', 'authentication', 'database')",
              },
              slug: {
                type: "string",
                description:
                  "Read a specific doc page by slug (e.g. 'actions', 'authentication', 'database')",
              },
              list: {
                type: "string",
                description: 'Set to "true" to list all available doc pages',
                enum: ["true"],
              },
            },
          },
        },
        mod.default,
        { readOnly: true },
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Creates resource ScriptEntries available in both prod and dev modes.
 */
async function createResourceScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const [list, read, write, del, saveMem, delMem] = await Promise.all([
      import("../scripts/resources/list.js"),
      import("../scripts/resources/read.js"),
      import("../scripts/resources/write.js"),
      import("../scripts/resources/delete.js"),
      import("../scripts/resources/save-memory.js"),
      import("../scripts/resources/delete-memory.js"),
    ]);

    // Wrap each CLI runner so it captures stdout and converts args properly
    const listEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      list.default,
      { readOnly: true },
    );
    const readEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      read.default,
      { readOnly: true },
    );
    const writeEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      write.default,
    );
    const deleteEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      del.default,
    );

    return {
      resources: {
        tool: {
          description:
            'Manage persistent user files and notes. Actions: "list" (browse), "read" (get contents), "write" (create/update), "delete" (remove).',
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: ["list", "read", "write", "delete"],
              },
              path: {
                type: "string",
                description:
                  "Resource path (e.g. 'LEARNINGS.md', 'notes/ideas.md'). Required for read/write/delete.",
              },
              content: {
                type: "string",
                description: "Content to write. Required for write.",
              },
              scope: {
                type: "string",
                description:
                  "personal, shared, or all (default varies by action)",
                enum: ["personal", "shared", "all"],
              },
              prefix: {
                type: "string",
                description:
                  "Filter by path prefix when listing (e.g. 'notes/')",
              },
              mime: {
                type: "string",
                description:
                  "MIME type for write (default: inferred from extension)",
              },
              format: {
                type: "string",
                description:
                  'Output format for list: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
            required: ["action"],
          },
        },
        run: async (args: Record<string, string>) => {
          const { action: a, ...rest } = args;
          if (a === "list") return listEntry.run(rest);
          if (a === "read") {
            if (!rest.path) return "Error: path is required for read";
            return readEntry.run(rest);
          }
          if (a === "write") {
            if (!rest.path || !rest.content)
              return "Error: path and content are required for write";
            return writeEntry.run(rest);
          }
          if (a === "delete") {
            if (!rest.path) return "Error: path is required for delete";
            return deleteEntry.run(rest);
          }
          return `Error: unknown action "${a}". Use: list, read, write, delete`;
        },
      },
      "save-memory": wrapCliScript(
        {
          description:
            "Save a memory for future conversations. Creates or updates a memory file and its index entry. Use proactively when you learn preferences, corrections, project context, or references.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Short kebab-case identifier (e.g. 'coding-style', 'deploy-process'). Used as the filename.",
              },
              type: {
                type: "string",
                description: "Memory category",
                enum: ["user", "feedback", "project", "reference"],
              },
              description: {
                type: "string",
                description:
                  "One-line summary shown in the memory index (keep under 80 chars)",
              },
              content: {
                type: "string",
                description:
                  "The memory content in markdown. For updates, read first and provide full updated content.",
              },
            },
            required: ["name", "type", "description", "content"],
          },
        },
        saveMem.default,
      ),
      "delete-memory": wrapCliScript(
        {
          description:
            "Delete a memory entry and remove it from the memory index.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The memory name to delete (e.g. 'coding-style')",
              },
            },
            required: ["name"],
          },
        },
        delMem.default,
      ),
    };
  } catch {
    // Resources not available — skip silently
    return {};
  }
}

/**
 * Creates a unified chat-history ActionEntry that dispatches to search or open.
 */
async function createChatScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const [searchMod, openMod] = await Promise.all([
      import("../scripts/chat/search-chats.js"),
      import("../scripts/chat/open-chat.js"),
    ]);

    const searchEntry = wrapCliScript(
      {
        description: "Search or list past agent chat threads.",
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
    );

    const openEntry = wrapCliScript(
      {
        description: "Open a chat thread in the UI.",
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
    );

    return {
      "chat-history": {
        tool: {
          description:
            "Manage past agent chat threads. Use action 'search' to find previous conversations by keyword, or 'open' to open a thread in the UI.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: ["search", "open"],
              },
              query: {
                type: "string",
                description:
                  "(search) Search term to find chats by title, preview, or content",
              },
              limit: {
                type: "string",
                description: "(search) Max number of results (default: 20)",
              },
              format: {
                type: "string",
                description: "(search) Output format",
                enum: ["json", "text"],
              },
              id: {
                type: "string",
                description: "(open) The chat thread ID to open",
              },
            },
            required: ["action"],
          },
        },
        run: async (args) => {
          if (args?.action === "open") {
            return openEntry.run(args);
          }
          return searchEntry.run(args);
        },
      },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the consolidated manage-agent-engine tool (list / set / test).
 * Let the agent inspect and configure the active LLM engine.
 */
async function createAgentEngineScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const mod = await import("../scripts/agent-engines/manage-agent-engine.js");

    return {
      "manage-agent-engine": { tool: mod.tool, run: mod.run },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the call-agent ActionEntry for cross-agent A2A communication.
 * Binds selfAppId so the agent cannot call itself via call-agent.
 */
async function createCallAgentScriptEntry(
  selfAppId?: string,
): Promise<Record<string, ActionEntry>> {
  try {
    const mod = await import("../scripts/call-agent.js");
    return {
      "call-agent": {
        tool: mod.tool,
        run: (args, context) => mod.run(args, context, selfAppId),
      },
    };
  } catch {
    return {};
  }
}

function createBuilderBrowserTool(deps: {
  getOrigin: () => string;
}): Record<string, ActionEntry> {
  return {
    "connect-builder": {
      tool: {
        description:
          "Render a Builder.io card inline in the chat. Call this IMMEDIATELY — no exploration, no planning — whenever (a) the user asks to add a feature, change the UI, edit code, create a component, add a route, add an integration, fix a bug in the app itself, or anything else that requires source-file edits while in hosted/production mode, OR (b) the user needs Builder for LLM access, browser automation, or any other Builder-gated capability. If Builder is already connected, the card shows a 'Send to Builder' button that hands the work off to Builder's cloud agent and returns a branch URL. When you call this for a code-change request, pass the user's request verbatim as the `prompt` arg so the card can forward it to Builder unchanged.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The user's feature / change request, verbatim. Forwarded to Builder's cloud agent when the user clicks Send. Omit only for generic 'connect Builder' requests that aren't tied to a specific code change.",
            },
          },
        },
      },
      run: async (args) => {
        const { resolveBuilderCredentials } =
          await import("./credential-provider.js");
        const creds = await resolveBuilderCredentials();
        const configured = !!(creds.privateKey && creds.publicKey);
        const prompt = typeof args?.prompt === "string" ? args.prompt : "";
        return JSON.stringify({
          kind: "connect-builder-card",
          configured,
          connectUrl: getBuilderBrowserConnectUrl(deps.getOrigin()),
          orgName: creds.orgName || null,
          prompt,
        });
      },
    },
  };
}

/**
 * Creates the unified `agent-teams` tool that consolidates all sub-agent
 * orchestration behind a single tool with an `action` parameter.
 */
function createTeamTools(deps: {
  getOwner: () => string;
  getSystemPrompt: () => string;
  getActions: () => Record<string, ActionEntry>;
  getEngine: () => AgentEngine;
  getModel: () => string;
  getParentThreadId: () => string;
  getSend: () =>
    | ((event: import("../agent/types.js").AgentChatEvent) => void)
    | null;
}): Record<string, ActionEntry> {
  return {
    "agent-teams": {
      tool: {
        description:
          "Manage sub-agent tasks. Use action 'spawn' to start a new sub-agent, 'status' to check progress, 'read-result' to get a finished task's output, 'send' to message a running sub-agent, or 'list' to see all tasks.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["spawn", "status", "read-result", "send", "list"],
              description: "The operation to perform",
            },
            task: {
              type: "string",
              description:
                "(spawn) Clear description of what the sub-agent should accomplish",
            },
            instructions: {
              type: "string",
              description:
                "(spawn) Optional additional instructions or context for the sub-agent",
            },
            name: {
              type: "string",
              description:
                "(spawn) Short name for the sub-agent tab (e.g. 'Research', 'Draft email'). If omitted, derived from the task.",
            },
            agent: {
              type: "string",
              description:
                "(spawn) Optional custom agent profile from agents/*.md to use for this task.",
            },
            taskId: {
              type: "string",
              description:
                "(status, read-result, send) The task ID returned by a previous spawn",
            },
            message: {
              type: "string",
              description: "(send) Message to send to the sub-agent",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, string>) => {
        const action = args.action;

        // ── spawn ──────────────────────────────────────────────
        if (action === "spawn") {
          if (!args.task) throw new Error("'task' is required for spawn");
          // Capture the send function NOW (at spawn time) so that
          // concurrent runs don't clobber each other's send reference.
          const capturedSend = deps.getSend();
          const { spawnTask } = await import("./agent-teams.js");
          // Filter out the team tool so sub-agents can't spawn sub-agents
          const subAgentActions = Object.fromEntries(
            Object.entries(deps.getActions()).filter(
              ([name]) => name !== "agent-teams",
            ),
          );
          let instructions = args.instructions;
          let selectedModel = deps.getModel();
          let selectedName = args.name || "";
          if (args.agent) {
            const { findAccessibleCustomAgent } =
              await import("../resources/agents.js");
            const profile = await findAccessibleCustomAgent(
              deps.getOwner(),
              args.agent,
            );
            if (!profile) {
              throw new Error(`Custom agent not found: ${args.agent}`);
            }
            const profileInstructions =
              `## Custom Agent Profile: ${profile.name}\n\n` +
              (profile.description ? `${profile.description}\n\n` : "") +
              profile.instructions;
            instructions = instructions
              ? `${profileInstructions}\n\n## Extra Task Context\n\n${instructions}`
              : profileInstructions;
            selectedModel = profile.model ?? selectedModel;
            selectedName = selectedName || profile.name;
          }
          const task = await spawnTask({
            description: args.task,
            instructions,
            ownerEmail: deps.getOwner(),
            systemPrompt: deps.getSystemPrompt(),
            actions: subAgentActions,
            engine: deps.getEngine(),
            model: selectedModel,
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
            name: selectedName,
          });
        }

        // ── status ─────────────────────────────────────────────
        if (action === "status") {
          if (!args.taskId) throw new Error("'taskId' is required for status");
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
        }

        // ── read-result ────────────────────────────────────────
        if (action === "read-result") {
          if (!args.taskId)
            throw new Error("'taskId' is required for read-result");
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
        }

        // ── send ───────────────────────────────────────────────
        if (action === "send") {
          if (!args.taskId) throw new Error("'taskId' is required for send");
          if (!args.message) throw new Error("'message' is required for send");
          const { sendToTask } = await import("./agent-teams.js");
          const result = await sendToTask(args.taskId, args.message);
          return JSON.stringify(result);
        }

        // ── list ───────────────────────────────────────────────
        if (action === "list") {
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
        }

        throw new Error(
          `Unknown action '${action}'. Use one of: spawn, status, read-result, send, list`,
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
  /**
   * Agent engine to use. Can be a pre-constructed AgentEngine, a registered
   * engine name (e.g. "anthropic", "ai-sdk:openai"), or an object with name
   * and config. Defaults to the "anthropic" engine using ANTHROPIC_API_KEY.
   */
  engine?:
    | import("../agent/engine/types.js").AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
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
  /**
   * Optional callback to append template-specific context to the system
   * prompt on each request. Runs after AGENTS.md / skills / memory are
   * loaded and before the schema block — use it to inject dynamic SQL
   * context like a data dictionary, active feature flags, or whatever
   * the agent should know about *right now* for this user/org.
   *
   * Return `null` or an empty string to skip. The string you return is
   * appended verbatim, so wrap it in your own XML tags (e.g.
   * `<data-dictionary>…</data-dictionary>`) to keep the prompt scannable.
   *
   * Called on every request in every prompt variant (lean, lazy, full).
   * Templates that want to suppress it in a particular mode should return
   * `null` from the callback based on their own logic.
   */
  extraContext?: (
    event: any,
    owner: string,
  ) => string | null | Promise<string | null>;
  /**
   * Use ONLY the template's `systemPrompt` and the actions list — skip the
   * framework prompt wrapper, resource loading (AGENTS.md/LEARNINGS.md/
   * memory), the SQL schema block, and the workspace files/skills/agents
   * inventory. Intended for minimal or voice-first apps where a long,
   * generic preamble adds latency and iteration noise without adding value.
   *
   * When set, the same lean prompt is used in both dev and prod modes. In
   * dev mode the tool registry is ALSO swapped to the template's actions
   * (same set as prod) — the dev-only shell/db-exec/file-system tools
   * and the resource/docs/chat/team/job/browser scripts are dropped. The
   * lean system prompt has no shell-usage guidance, so routing actions
   * through shell would break. If you need the full dev tool surface,
   * leave this off.
   */
  leanPrompt?: boolean;
  /**
   * Use a compact system prompt with on-demand context loading. The system
   * prompt includes essential behavioral rules and action signatures, but
   * defers verbose framework details, SQL schema, skills, learnings, and
   * memory behind tools (`get-framework-context`, `db-schema`,
   * `resources` (action: read)). The agent fetches these on-demand when needed.
   *
   * This reduces the system prompt by ~60-70%, significantly improving
   * time-to-first-token and reducing "thinking" time. The agent retains
   * all capabilities — it just loads context lazily instead of upfront.
   *
   * Defaults to `true`. Set to `false` to use the original full prompt.
   * Ignored when `leanPrompt` is set (lean mode is even more minimal).
   */
  lazyContext?: boolean;
  /**
   * In dev mode, register the template's actions as native tools the agent
   * can call directly with structured JSON args — skipping the default
   * `shell(command="pnpm action <name> ...")` indirection.
   *
   * The default dev behavior shells out because it "mirrors how Claude Code
   * works locally" and reduces empty-object tool calls for templates with
   * simple string args. But templates whose actions take structured data
   * (objects, arrays, nested JSON) can't round-trip those cleanly through
   * the CLI parser — stringified JSON on the way in, loss of type fidelity
   * on the way out.
   *
   * Set to `true` to get the same tool surface in dev that production uses.
   * `leanPrompt: true` implies this already (lean mode has no shell-usage
   * guidance, so actions must be native). Set this flag without
   * `leanPrompt` when you want native actions AND the full system prompt.
   *
   * Defaults to `false`.
   */
  nativeActionsInDev?: boolean;
}

/**
 * Framework-level instructions injected into every agent's system prompt.
 * This is the single source of truth for the core philosophy, rules, and patterns.
 * Template AGENTS.md resources only need template-specific content.
 */

/**
 * Compact framework instructions for lazy-context mode. Keeps the critical
 * behavioral rules but defers verbose details (chat history, agent teams,
 * recurring jobs, builder.io, browser, A2A, structured memory) behind the
 * `get-framework-context` tool.
 */
const FRAMEWORK_CORE_COMPACT = `
### Core Rules

1. **Data lives in SQL** — All app state is in a SQL database. Use the available database tools. Call \`db-schema\` to see the full schema when needed.
2. **Context awareness** — The user's current screen state is in \`<current-screen>\`, current URL in \`<current-url>\`. Use both to understand what the user is looking at. To change URL state, use \`set-search-params\` or \`set-url-path\`.
3. **Navigate the UI** — Use the \`navigate\` tool to switch views, open items, or focus elements.
4. **Application state** — Ephemeral UI state lives in \`application_state\`. Use \`readAppState\`/\`writeAppState\`.
5. **Screen refresh is automatic** — The framework auto-refreshes after mutating tool calls. Only call \`refresh-screen\` when you mutated data via a path the framework can't detect.
6. **Memory** — Use \`save-memory\` proactively when you learn preferences, corrections, or project context.
7. **Security** — Always use parameterized queries. Never \`dangerouslySetInnerHTML\`, \`innerHTML\`, or \`eval()\`.

### Resources

Use resource-list, resource-read, resource-write, resource-delete for persistent notes and context files.
Resources are NOT an agent scratchpad — never create executable scripts, task plans, or work-in-progress files.

### Navigation Rule

When the user says "show me", "go to", "open", etc., ALWAYS use \`navigate\` first.

### Extended Capabilities

You also have tools for: inline embeds, chat history search, agent teams/sub-agents, recurring jobs, A2A cross-app calls, structured memory, and browser access. Call \`get-framework-context\` to read detailed instructions for any of these when needed.
`;

/**
 * Verbose framework sections returned by the `get-framework-context` tool.
 * Keyed by topic so the agent can request specific sections.
 */
const FRAMEWORK_CONTEXT_SECTIONS: Record<string, string> = {
  embeds: `### Inline Embeds

You can embed an interactive view inline in your chat reply by writing an \`embed\` fenced code block. The chat renderer swaps the fence for a sandboxed iframe pointing at a route inside this app.

Syntax:

\`\`\`\`
\`\`\`embed
src: /some/path?param=value
aspect: 16/9
title: Optional label
\`\`\`
\`\`\`\`

Keys:
- \`src\` (required) — **must be a same-origin path starting with \`/\`**. Cross-origin URLs are blocked. No \`javascript:\` or \`data:\` URLs.
- \`aspect\` (optional) — one of \`16/9\` (default), \`4/3\`, \`3/2\`, \`2/1\`, \`21/9\`, \`1/1\`.
- \`title\` (optional) — accessible label / hover tooltip.
- \`height\` (optional) — fixed pixel height when aspect ratio isn't a good fit.

Use for charts, visualizations, previews. Don't use for simple text/tables or external sites.`,

  "chat-history": `### Chat History

You can search and restore previous chat conversations using \`chat-history\`:
- \`chat-history\` (action: "search") — Search or list past chat threads by keyword
- \`chat-history\` (action: "open") — Open a chat thread in the UI as a new tab and focus it

When the user asks to find a previous conversation, use \`chat-history\` with action "search" first to find matching threads, then action "open" to restore the one they want.`,

  "agent-teams": `### Agent Teams — Orchestration

You are an orchestrator. For complex or multi-step tasks, delegate to sub-agents using the \`agent-teams\` tool:
- \`agent-teams\` (action: "spawn") — Spawn a sub-agent for a task. It runs in its own thread while you stay available.
- \`agent-teams\` (action: "status") — Check the progress of a running sub-agent.
- \`agent-teams\` (action: "read-result") — Read the result when a sub-agent finishes.
- \`agent-teams\` (action: "send") — Send a message to a running sub-agent.
- \`agent-teams\` (action: "list") — List all sub-agent tasks.

**When to delegate vs do directly:**
- **Delegate** when the task involves multiple tool calls, research, content generation, or anything that takes more than a few seconds.
- **Do directly** for quick single-step tasks like navigation, reading state, or answering simple questions.
- **Spawn multiple sub-agents** when the user asks for multiple independent things — they'll run in parallel.

Sub-agents have access to all template tools but **cannot spawn sub-agents themselves**.`,

  "recurring-jobs": `### Recurring Jobs

You can create recurring jobs that run on a cron schedule. Jobs are resource files under \`jobs/\`.

- \`manage-jobs\` (action: "create") — Create a new recurring job with a cron schedule and instructions
- \`manage-jobs\` (action: "list") — List all recurring jobs and their status
- \`manage-jobs\` (action: "update") — Update a job's schedule, instructions, or toggle enabled/disabled
- Delete a job with \`resource-delete --path jobs/<name>.md\`

Convert natural language to 5-field cron format:
- "every morning" / "daily at 9am" → \`0 9 * * *\`
- "every weekday at 9am" → \`0 9 * * 1-5\`
- "every hour" → \`0 * * * *\`
- "every monday at 9am" → \`0 9 * * 1\``,

  builder: `### Connecting Builder.io

When the user asks to connect Builder.io or you hit a "Builder not configured" error, call the \`connect-builder\` tool. It renders a one-click Connect card inline — do NOT write out multi-step setup instructions yourself.`,

  browser: `### Browser Access

Use \`connect-builder\` when you need browser access backed by Builder. It renders a Connect card that provisions a browser session.

- If Builder is not configured, the card will guide the user through setup.`,

  "call-agent": `### call-agent — External Apps Only

The \`call-agent\` tool sends a message to a DIFFERENT, separately-deployed app's agent (A2A protocol). It is **not** for calling actions within the current app.

**NEVER use \`call-agent\` to:**
- Call your own app by name
- Perform tasks you can accomplish with your own registered tools

**ONLY use \`call-agent\` when:**
- The user explicitly asks you to communicate with a different app
- You need data that only another deployed app can provide`,

  memory: `### Structured Memory

Your memory index (\`memory/MEMORY.md\`) is loaded at the start of every conversation.

**Tools:**
- \`save-memory\` — Create or update a memory (name, type, description, content)
- \`delete-memory\` — Remove a memory and its index entry
- \`resource-read --path memory/<name>.md\` — Read the full content of a specific memory

**Memory types:** user, feedback, project, reference

**When to save (proactively):**
- User corrects your approach → \`feedback\`
- User shares preferences → \`user\`
- Non-obvious pattern or gotcha → \`feedback\`
- Personal context (contacts, team) → \`user\`
- Project context to track → \`project\`

**Rules:**
- Don't save things obvious from code or standard framework behavior
- When updating, read first and merge — don't overwrite
- Keep descriptions concise
- One memory per logical topic`,

  "sql-tools": `### SQL Tools

- \`db-schema\` — refresh the full schema with indexes and foreign keys
- \`db-query\` — run a SELECT (read-only; results already filtered to the current user/org)
- \`db-exec\` — run INSERT / UPDATE / DELETE (writes already scoped; owner_email and org_id are auto-injected on INSERT)
- \`db-patch\` — surgical search-and-replace on a large text column. Use for edits to large fields instead of re-sending multi-kilobyte strings.

### When to pick which SQL tool
- Set a short column outright, update multiple columns, or do computed updates → \`db-exec UPDATE\`
- Change a small slice of a large text/JSON column → \`db-patch\`
- A template-specific action exists for the table → use that action (it encodes business rules and pushes live Yjs updates)
- Read data → \`db-query\`. Never re-add \`WHERE owner_email = ...\` — scoping already applies it.

### External data sources vs the app database
The \`db-*\` tools ONLY query the app's own SQL database. They do NOT reach external data warehouses. If the user asks about tables NOT in the schema, use the appropriate template action instead.`,
};

/**
 * Full framework instructions shared across both modes. The mode-specific
 * preamble is prepended by the prompt composition below.
 */
const FRAMEWORK_CORE = `
### Core Rules

1. **Data lives in SQL** — All app state is in a SQL database (could be SQLite, Postgres, Turso, or Cloudflare D1 — never assume which). Use the available database tools.
2. **Context awareness** — The user's current screen state is automatically included in each message as a \`<current-screen>\` block, and the current URL (path + search params) as a \`<current-url>\` block. Use both to understand what the user is looking at — filters, search terms, and other URL-driven state live in \`<current-url>\`'s \`searchParams\`, NOT in the settings table. To change URL state (e.g. toggle a filter, clear a query string), use the \`set-search-params\` or \`set-url-path\` tools — never try to edit URL state by writing to settings or application_state directly.
3. **Navigate the UI** — Use the \`navigate\` tool to switch views, open items, or focus elements for the user.
4. **Application state** — Ephemeral UI state (drafts, selections, navigation) lives in \`application_state\`. Use \`readAppState\`/\`writeAppState\` to read and write it. When you write state, the UI updates automatically.
5. **Screen refresh is automatic after action calls** — The framework auto-emits a refresh event after any successful mutating tool call (template actions like \`log-meal\`, \`update-form\`, \`edit-document\`, and the \`db-exec\` / \`db-patch\` tools). The UI re-fetches its queries without a full page reload. You do NOT need to call \`refresh-screen\` after an action — it's already handled. Only call \`refresh-screen\` explicitly when (a) you mutated data via a path the framework can't detect (e.g. writing directly to an external system whose results the app mirrors), or (b) you want to pass a \`scope\` hint so the UI narrows which queries to refetch. Do NOT tell the user to reload the page.
6. **Memory** — Use the structured memory system to persist knowledge across sessions. Use \`save-memory\` proactively when you learn preferences, corrections, or project context. Update shared AGENTS.md for instructions that should apply to all users.
7. **Security** — Always use \`defineAction\` with a Zod \`schema:\` for input validation. Never construct SQL with string concatenation — use parameterized queries via db-query/db-exec. Never use \`dangerouslySetInnerHTML\`, \`innerHTML\`, or \`eval()\`. Never expose secrets in responses or source code. Every table with user data must have \`owner_email\`.

### Resources

You have access to a Resources system for persistent notes and context files.
Use resource-list, resource-read, resource-write, resource-delete to manage resources.
Resources can be personal (per-user) or shared (team-wide). By default, resources are personal.

When the user gives instructions that should apply to all users/sessions, update the shared "AGENTS.md" resource.

**Resources are NOT an agent scratchpad.** Never use \`resource-write\` to store executable scripts, task plans, retry notes, or work-in-progress files you're writing to yourself. Specifically, do NOT create resources under \`scripts/\` or \`tasks/\` unless the user explicitly asked for a file at that path, or a tool (like \`manage-jobs\` or \`agent-teams\`) writes there as part of its contract. If you can't complete a task with the tools you have, say so — don't improvise by leaving behind \`FINAL-*.md\`, \`EXECUTE-NOW-*.js\`, or similar artifacts. Resources are visible to the user in the workspace sidebar; every file you write is something they'll see and have to clean up.

### Navigation Rule

When the user says "show me", "go to", "open", "switch to", or similar navigation language, ALWAYS use the \`navigate\` action to update the UI. The user expects to SEE the result in the main app, not just read it in chat. Navigate first, then fetch/display data.

### Inline Embeds

You can embed an interactive view inline in your chat reply by writing an \`embed\` fenced code block. The chat renderer swaps the fence for a sandboxed iframe pointing at a route inside this app.

Syntax:

\`\`\`\`
\`\`\`embed
src: /some/path?param=value
aspect: 16/9
title: Optional label
\`\`\`
\`\`\`\`

Keys:
- \`src\` (required) — **must be a same-origin path starting with \`/\`**. Cross-origin URLs are blocked by the renderer. No \`javascript:\` or \`data:\` URLs.
- \`aspect\` (optional) — one of \`16/9\` (default), \`4/3\`, \`3/2\`, \`2/1\`, \`21/9\`, \`1/1\`.
- \`title\` (optional) — accessible label / hover tooltip.
- \`height\` (optional) — fixed pixel height when aspect ratio isn't a good fit.

**When to reach for it:**
- Showing a chart, visualization, or map that benefits from being live/interactive.
- Previewing a specific item (a thread, a doc, a record) inline with your explanation.
- Anything where a screenshot-sized static image would undersell the result.

**When NOT to use it:**
- For simple prose answers, tables, or plain data — those should stay as markdown.
- For external sites — the renderer blocks cross-origin iframes.

Which routes are renderable as embeds is template-specific — the app's \`AGENTS.md\` will list them. If no embeddable routes exist in this template, don't emit \`embed\` fences.

### Chat History

You can search and restore previous chat conversations using \`chat-history\`:
- \`chat-history\` (action: "search") — Search or list past chat threads by keyword
- \`chat-history\` (action: "open") — Open a chat thread in the UI as a new tab and focus it

When the user asks to find a previous conversation, use \`chat-history\` with action "search" first to find matching threads, then action "open" to restore the one they want.

### Agent Teams — Orchestration

You are an orchestrator. For complex or multi-step tasks, delegate to sub-agents using the \`agent-teams\` tool:
- \`agent-teams\` (action: "spawn") — Spawn a sub-agent for a task. It runs in its own thread while you stay available. A live preview card appears in the chat. You can optionally choose a custom agent profile from \`agents/*.md\`.
- \`agent-teams\` (action: "status") — Check the progress of a running sub-agent.
- \`agent-teams\` (action: "read-result") — Read the result when a sub-agent finishes.
- \`agent-teams\` (action: "send") — Send a message to a running sub-agent.
- \`agent-teams\` (action: "list") — List all sub-agent tasks.

**When to delegate vs do directly:**
- **Delegate** when the task involves multiple tool calls, research, content generation, or anything that takes more than a few seconds. Examples: "create a deck about X", "analyze the data and write a report", "look up Y and draft an email about it".
- **Do directly** for quick single-step tasks like navigation, reading state, or answering simple questions.
- **Spawn multiple sub-agents** when the user asks for multiple independent things — they'll run in parallel.

**How to orchestrate:**
1. When the user asks for something complex, spawn a sub-agent with a clear task description.
2. Tell the user what you've started ("I'm having a sub-agent research that for you").
3. You can keep chatting — sub-agents run independently.
4. Use \`agent-teams\` (action: "read-result") to check results when needed, or the user can see live progress in the card.
5. If the user's request has multiple steps, you can spawn one sub-agent per step, or chain them.

Sub-agents have access to all template tools but **cannot spawn sub-agents themselves** — only you (the orchestrator) can do that. Give the sub-agent a specific, actionable task description — it will figure out which tools to use. If a matching custom agent profile exists, pass it via the \`agent\` parameter on \`agent-teams\` (action: "spawn").

### Recurring Jobs

You can create recurring jobs that run on a cron schedule. Jobs are resource files under \`jobs/\`. Each job has a cron schedule and instructions that the agent executes automatically.

- \`manage-jobs\` (action: "create") — Create a new recurring job with a cron schedule and instructions
- \`manage-jobs\` (action: "list") — List all recurring jobs and their status (schedule, last run, next run, errors)
- \`manage-jobs\` (action: "update") — Update a job's schedule, instructions, or toggle enabled/disabled
- Delete a job with \`resource-delete --path jobs/<name>.md\`

When the user asks for something recurring ("every morning", "daily at 9am", "weekly on Mondays"), create a job. Convert natural language to 5-field cron format:
- "every morning" / "daily at 9am" → \`0 9 * * *\`
- "every weekday at 9am" → \`0 9 * * 1-5\`
- "every hour" → \`0 * * * *\`
- "every 30 minutes" → \`*/30 * * * *\`
- "every monday at 9am" → \`0 9 * * 1\`
- "twice a day" / "morning and evening" → \`0 9,17 * * *\`

Job instructions should be self-contained — include which actions to call, what conditions to check, and what to do with results. The agent executing the job has access to all the same tools you do.

### Connecting Builder.io

When the user asks to connect Builder.io, needs Builder for LLM access / browser automation, or you hit a "Builder not configured" error, call the \`connect-builder\` tool. It renders a one-click Connect card inline in the chat — do NOT write out multi-step setup instructions yourself (no "Option 1 / Option 2", no terminal commands). Just call the tool and let the card handle the rest.

### Browser Access

Use \`connect-builder\` when you need browser access backed by Builder. It renders a Connect card that provisions a browser session.

- If Builder is not configured, the card will guide the user through setup.

### call-agent — External Apps Only

The \`call-agent\` tool sends a message to a DIFFERENT, separately-deployed app's agent (A2A protocol). It is **not** for calling actions within the current app.

**NEVER use \`call-agent\` to:**
- Call your own app by name (if you are the "macros" agent, never do \`call-agent(agent="macros")\`)
- Perform tasks you can accomplish with your own registered tools
- Wrap your own actions in an A2A round-trip

**ONLY use \`call-agent\` when:**
- The user explicitly asks you to communicate with a different app (e.g., "ask the mail agent to...")
- You need data that only another deployed app can provide
- You are coordinating across genuinely separate apps

If \`call-agent\` returns an error saying the agent is yourself — stop and use your own tools instead.

### Structured Memory

You have a structured memory system. Your memory index (\`memory/MEMORY.md\`) is loaded at the start of every conversation (shown above). Individual memories are stored as separate files under \`memory/\`.

**Tools:**
- \`save-memory\` — Create or update a memory. Provide name, type, description, and content. Atomically updates both the memory file and the index.
- \`delete-memory\` — Remove a memory and its index entry.
- \`resource-read --path memory/<name>.md\` — Read the full content of a specific memory when you need details beyond the index.

**Memory types:**
- \`user\` — Preferences, role, personal context, contacts
- \`feedback\` — Corrections ("don't do X, do Y instead"), confirmed approaches
- \`project\` — Ongoing work context, decisions, status
- \`reference\` — Pointers to external systems, URLs, API details

**When to save (do it proactively, don't ask permission):**
- User corrects your approach → save as \`feedback\`
- User shares preferences (tone, style, workflow) → save as \`user\`
- You discover a non-obvious pattern or gotcha → save as \`feedback\`
- User provides personal context (contacts, team, domain) → save as \`user\`
- A project gains enough context to track → save as \`project\`

**Rules:**
- Don't save things obvious from the code or standard framework behavior
- When updating an existing memory, read it first and merge — don't overwrite blindly
- Keep descriptions concise — the index is loaded every message
- One memory per logical topic (e.g. 'coding-style', 'project-alpha')
- Don't save temporary debugging notes or ephemeral task details
`;

const PROD_FRAMEWORK_PROMPT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Code Changes Not Available — Call \`connect-builder\` Immediately

When the user asks you to change the UI, modify code, add a feature, fix a bug in the app itself, change styles, add a hook, create a component, add a route, add an integration, or anything else that requires editing source files — you MUST take exactly these steps, in order:

1. Call the \`connect-builder\` tool, passing the user's full request verbatim as the \`prompt\` argument. This renders an inline card. If Builder is connected, the card hands the prompt off to Builder's cloud agent on one click and returns a branch URL; otherwise it shows a connect / waitlist flow. Either way, Builder writes the code — no local setup, no clone, no install.
2. After the card renders, write a single short sentence telling the user to click Connect Builder to have this built for them in the cloud, and mention they can also clone the app locally with \`npx agent-native create <app-name>\` if they'd rather work offline.

**Hard rules — do NOT break these:**
- Do NOT read source files, list directories, or explore the codebase. You have no filesystem tools and don't need to look at code to recommend Builder.
- Do NOT write an implementation plan. Do NOT write code in your response. Do NOT describe which files to create or modify. Builder will figure that out in its sandbox.
- Do NOT save plans, specs, or code to \`resource-write\`. Resources are for app data, not implementation plans the user didn't ask for.
- Do NOT spawn sub-agents (\`agent-teams\`) to design, plan, or research the feature. The answer is always: call \`connect-builder\`, say one sentence, stop. Sub-agents inherit these same rules and have no code-editing tools either.
- Do NOT say "I don't have a request-code-change tool" or list what tools you lack. Just call \`connect-builder\`.
- Do NOT wait for the user to ask "how" — call \`connect-builder\` the moment a code change is requested.

Builder.io is the recommended path because it's one-click and runs in the cloud. Local dev is a fallback for users who want to work offline.
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

**Template-specific actions are invoked via shell, NOT as direct tools.** In dev mode, the only tools registered as native tool calls are framework-level utilities (shell, file ops, resources, chat, teams, jobs). Anything from the template's \`actions/\` directory must be run through shell: \`shell({ command: 'pnpm action <name> --arg value' })\`. The "Available Actions" section below shows the exact CLI syntax for each one — copy that command verbatim and pass it to \`shell\`. Do not try to call template actions by name as if they were tools; they will not appear in your tool list.

When editing code, follow the agent-native architecture:
- Every feature needs all four areas: UI + scripts + skills/instructions + application-state sync
- All SQL must be dialect-agnostic (works on SQLite and Postgres)
- No Node.js-specific APIs in server routes (must work on Cloudflare Workers, etc.)
- Use shadcn/ui components and Tabler Icons for all UI work
${FRAMEWORK_CORE}`;

const PROD_FRAMEWORK_PROMPT_COMPACT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Code Changes — Call \`connect-builder\`

When the user asks to change the UI, modify code, add a feature, or fix a bug in the app itself — call \`connect-builder\` immediately, passing the user's request as the \`prompt\`. Do NOT write code, list files, make plans, or spawn sub-agents for code changes. Builder handles it in the cloud. Mention \`npx agent-native create <app-name>\` as an offline fallback.
${FRAMEWORK_CORE_COMPACT}`;

const DEV_FRAMEWORK_PROMPT_COMPACT = `## Agent-Native Framework — Development Mode

You are an AI agent in an agent-native application, running in **development mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via tools/scripts, and vice versa. They share the same SQL database and stay in sync automatically.

**In development mode, you have UNRESTRICTED access.** You can run any shell command, read/write files, query the database, call external APIs, edit source code, and install packages.

**Template-specific actions are invoked via shell, NOT as direct tools.** Run them with: \`shell({ command: 'pnpm action <name> --arg value' })\`. See the "Available Actions" section below for CLI syntax.

When editing code, follow the agent-native architecture:
- Every feature needs all four areas: UI + scripts + skills/instructions + application-state sync
- All SQL must be dialect-agnostic (works on SQLite and Postgres)
- No Node.js-specific APIs in server routes (must work on Cloudflare Workers, etc.)
- Use shadcn/ui components and Tabler Icons for all UI work
${FRAMEWORK_CORE_COMPACT}`;

const DEFAULT_SYSTEM_PROMPT = PROD_FRAMEWORK_PROMPT;

/**
 * Pre-load the agent's context: AGENTS.md (template instructions), the skills
 * index, shared LEARNINGS.md (team notes), and memory/MEMORY.md (personal
 * structured memory index). These all get appended to the system prompt so
 * the agent has everything it needs from the first turn.
 *
 * Four sources are layered:
 *
 *   1. `<workspace>` — AGENTS.md from the enterprise workspace core.
 *   2. `<template>` — AGENTS.md + skills index from the Vite plugin bundle.
 *   3. `<shared>` — LEARNINGS.md from the SQL shared scope. Team-level notes.
 *   4. `<personal>` — memory/MEMORY.md from the SQL personal scope. The
 *      current user's structured memory index.
 *
 * Each source is read independently — no copying between them. Editing
 * AGENTS.md and restarting the server is all it takes; Vite HMR invalidates
 * the bundle in dev so changes land instantly.
 */
async function loadResourcesForPrompt(
  owner: string,
  compact = false,
): Promise<string> {
  await ensurePersonalDefaults(owner);

  const sections: string[] = [];

  // 1. Workspace AGENTS.md + skills merged into the template bundle.
  try {
    const { loadAgentsBundle, generateSkillsPromptBlock } =
      await import("./agents-bundle.js");
    const bundle = await loadAgentsBundle();

    // Workspace-core AGENTS.md (enterprise-wide instructions), if present.
    if (bundle.workspaceAgentsMd && bundle.workspaceAgentsMd.trim()) {
      sections.push(
        `<resource name="AGENTS.md" scope="workspace">\n${bundle.workspaceAgentsMd.trim()}\n</resource>`,
      );
    }

    // 2. Template AGENTS.md — always included (critical template instructions).
    if (bundle.agentsMd.trim()) {
      sections.push(
        `<resource name="AGENTS.md" scope="template">\n${bundle.agentsMd.trim()}\n</resource>`,
      );
    }

    // In compact mode, skip the full skills block — the agent can use
    // `docs-search` to find skills when it needs them.
    if (!compact) {
      const skillsBlock = generateSkillsPromptBlock(bundle);
      if (skillsBlock) sections.push(skillsBlock);
    } else if (Object.keys(bundle.skills).length > 0) {
      const names = Object.values(bundle.skills)
        .map((s) => s.meta.name)
        .join(", ");
      sections.push(
        `<skills-summary>\nSkills available in .agents/skills/: ${names}. Use \`docs-search\` to read a skill before starting a task it applies to.\n</skills-summary>`,
      );
    }
  } catch {}

  if (compact) {
    // In compact mode, skip learnings and memory in the prompt.
    // The agent can access them via resource-read when needed.
    // Add a brief pointer so the agent knows they exist.
    sections.push(
      `<context-note>Shared learnings (LEARNINGS.md) and your personal memory (memory/MEMORY.md) are available via \`resource-read\`. Check them when making decisions that might benefit from prior context.</context-note>`,
    );
  } else {
    // LEARNINGS.md from SQL (template-level instructions are in AGENTS.md above).
    // 2. Shared SQL scope
    try {
      const shared = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");
      if (shared?.content?.trim()) {
        sections.push(
          `<resource name="LEARNINGS.md" scope="shared">\n${shared.content.trim()}\n</resource>`,
        );
      }
    } catch {}

    // 3. Personal memory index (skip if owner is the shared sentinel)
    if (owner !== SHARED_OWNER) {
      try {
        const memoryIndex = await resourceGetByPath(owner, "memory/MEMORY.md");
        if (memoryIndex?.content?.trim()) {
          sections.push(
            `<resource name="memory/MEMORY.md" scope="personal">\n${memoryIndex.content.trim()}\n</resource>`,
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

/**
 * Build the per-request SQL-schema context block. Reads AGENT_ORG_ID live
 * from the environment so scheduler/A2A/HTTP call sites all see whatever
 * org was just resolved for this request.
 */
async function buildSchemaBlock(
  owner: string,
  _legacyHasRawDbTools?: boolean,
): Promise<string> {
  // db-* tools are always registered (see createDbScriptEntries), in both dev
  // and prod. The legacy boolean is kept for call-site compatibility but
  // ignored — always advertise the tools to the agent.
  try {
    return await loadSchemaPromptBlock({
      owner,
      orgId: getRequestOrgId() ?? null,
      hasRawDbTools: true,
    });
  } catch {
    return "";
  }
}

/** @deprecated Kept for backward compat — dev prompt is now part of DEV_FRAMEWORK_PROMPT */
const DEFAULT_DEV_PROMPT = "";

/**
 * Generates a system prompt section describing registered template actions.
 * This helps the agent prefer template-specific actions over raw db-query/db-exec.
 *
 * Two output modes:
 *
 *   - `"tool"` — used in production, where template actions are registered
 *     as native Anthropic tools. Output reads `name(arg*: type; ...) — desc`.
 *   - `"cli"` — used in dev, where template actions are NOT registered as
 *     native tools and must be invoked via `shell(command="pnpm action ...")`.
 *     Output reads `pnpm action name --arg <type> [--opt <type>] — desc`.
 */
function generateActionsPrompt(
  registry: Record<string, ActionEntry>,
  mode: "cli" | "tool" = "tool",
): string {
  if (!registry || Object.keys(registry).length === 0) return "";

  const lines = Object.entries(registry).map(([name, entry]) => {
    const desc = entry.tool.description;
    const params = entry.tool.parameters?.properties;
    const requiredFields = new Set(entry.tool.parameters?.required ?? []);

    if (mode === "cli") {
      // CLI mode: emit `pnpm action <name> --required <type> [--optional <type>]`
      if (!params || Object.keys(params).length === 0) {
        return `- \`pnpm action ${name}\` — ${desc}`;
      }
      const entries = Object.entries(params);
      // Required first (alphabetical), then optional (alphabetical)
      entries.sort(([a], [b]) => {
        const ar = requiredFields.has(a) ? 0 : 1;
        const br = requiredFields.has(b) ? 0 : 1;
        if (ar !== br) return ar - br;
        return a.localeCompare(b);
      });
      const required: string[] = [];
      const optional: string[] = [];
      const requiredNames: string[] = [];
      for (const [k, v] of entries) {
        const type = (v as { type?: string }).type ?? "any";
        const flag = `--${k} <${type}>`;
        if (requiredFields.has(k)) {
          required.push(flag);
          requiredNames.push(`--${k}`);
        } else {
          optional.push(`[${flag}]`);
        }
      }
      const cmd = ["pnpm action " + name, ...required, ...optional].join(" ");
      const requiredNote =
        requiredNames.length > 0
          ? ` Required: ${requiredNames.join(", ")}.`
          : "";
      return `- \`${cmd}\` — ${desc}.${requiredNote}`;
    }

    // tool mode (production / native tool calls)
    if (params) {
      // Order required params first, then optional. Mark required with "*"
      // and include type + description so the agent knows exactly how to call.
      const entries = Object.entries(params);
      entries.sort(([a], [b]) => {
        const ar = requiredFields.has(a) ? 0 : 1;
        const br = requiredFields.has(b) ? 0 : 1;
        if (ar !== br) return ar - br;
        return a.localeCompare(b);
      });
      const paramList = entries
        .map(([k, v]) => {
          const isRequired = requiredFields.has(k);
          const type = (v as { type?: string }).type ?? "any";
          const marker = isRequired ? "*" : "?";
          const descPart = v.description ? ` — ${v.description}` : "";
          return `${k}${marker}: ${type}${descPart}`;
        })
        .join("; ");
      return `- \`${name}\`(${paramList}) — ${desc}`;
    }
    return `- \`${name}\`() — ${desc}`;
  });

  if (mode === "cli") {
    return `\n\n## Available Actions

**These template actions are NOT exposed as direct tools in dev mode. To run any of them, use the \`shell\` tool with the exact command shown below.** Example: \`shell(command="pnpm action add-slide --deckId abc --content 'Hello'")\`.

Do NOT try to call these by name as if they were tools — they will not exist in your tool list. Always go through \`shell\`.

${lines.join("\n")}`;
  }

  return `\n\n## Available Actions

**Use these actions directly as tool calls.** They are your primary tools — they handle database access, validation, and business logic internally. Prefer these over lower-level tools like \`web-request\` or \`db-query\`.

Parameter notation: \`name*\` = required, \`name?\` = optional. Pass parameters as a JSON object.

${lines.join("\n")}`;
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
  return (nitroApp: any) => {
    // Nitro v3 calls plugins synchronously and doesn't await async return
    // values. We track the async init so the framework's readiness gate
    // holds /_agent-native requests until routes are registered.
    const initPromise = (async () => {
      const { awaitBootstrap } = await import("./framework-request-handler.js");
      await awaitBootstrap(nitroApp);

      // Reap phantom runs left over from the previous process (HMR restart,
      // process crash, isolate eviction). Any run whose heartbeat is already
      // stale by startup time had a dead producer; mark it errored so the
      // next /runs/active check returns a terminal status and reconnecting
      // clients don't spin on "Thinking...". Runs owned by OTHER live
      // isolates are protected by their fresh heartbeats.
      try {
        const { reapAllStaleRuns } = await import("../agent/run-store.js");
        const reaped = await reapAllStaleRuns();
        if (reaped > 0) {
          console.log(`[agent-chat] reaped ${reaped} stale run(s) on startup`);
        }
      } catch {
        // Best effort — don't block plugin init if SQL isn't ready yet.
      }

      const env = process.env.NODE_ENV;
      // AGENT_MODE=production forces production agent constraints even in dev
      const canToggle =
        (env === "development" || env === "test") &&
        process.env.AGENT_MODE !== "production";
      const routePath = options?.path ?? "/_agent-native/agent-chat";

      // Mutable mode flag — persisted to the `settings` table so a user who
      // toggles to "Production" stays in prod mode across server restarts.
      // Hoisted here (before any tool-registry / handler closures are built)
      // so every runtime decision point can close over it and see live changes
      // when the user toggles the Environment dropdown.
      const AGENT_MODE_SETTING_KEY = "agent-chat.mode";
      let currentDevMode = canToggle;
      if (canToggle) {
        try {
          const persisted = await getSetting(AGENT_MODE_SETTING_KEY);
          if (persisted && typeof persisted.devMode === "boolean") {
            currentDevMode = persisted.devMode;
          }
        } catch {
          // Settings table may not be ready yet — fall back to default.
        }
      }
      // Every closure that picks between dev/prod tools, prompts, or handlers
      // at request time should call this getter instead of reading `canToggle`.
      // `canToggle` means "this environment allows toggling" (static); this
      // function means "the user currently has dev mode ON" (live).
      const isDevMode = () => currentDevMode;

      // Initialize MCP client. Merges file/env config + auto-detected binaries
      // + any remote servers users have added through the settings UI (persisted
      // in the settings table, scanned across all scopes so we never drop
      // another user's entries). Graceful-degrade: any failure yields zero MCP
      // tools and agent-chat keeps working as before.
      let mcpConfig = await buildMergedConfig().catch((err) => {
        console.warn(
          `[mcp-client] buildMergedConfig failed: ${err?.message ?? err}`,
        );
        return null;
      });
      if (!mcpConfig) {
        const fileOrEnv = loadMcpConfig() ?? autoDetectMcpConfig();
        mcpConfig = fileOrEnv;
        if (mcpConfig?.source) {
          console.log(
            `[mcp-client] loaded config from ${mcpConfig.source} (${Object.keys(mcpConfig.servers).length} server(s))`,
          );
        } else if (process.env.DEBUG) {
          console.log(
            "[mcp-client] no configured MCP servers — skipping MCP tools",
          );
        }
      } else if (mcpConfig.source) {
        console.log(
          `[mcp-client] merged config (${Object.keys(mcpConfig.servers).length} server(s), source: ${mcpConfig.source})`,
        );
      }
      const mcpManager = new McpClientManager(mcpConfig);
      try {
        await mcpManager.start();
      } catch (err: any) {
        console.warn(
          `[mcp-client] start() failed: ${err?.message ?? err}. Continuing without MCP tools.`,
        );
      }
      setGlobalMcpManager(mcpManager);
      const mcpActionEntries = mcpToolsToActionEntries(mcpManager);

      // Mount status + management routes so the settings UI can list / add /
      // remove remote MCP servers and hot-reload the running manager.
      mountMcpStatusRoute(nitroApp, mcpManager);
      mountMcpServersRoutes(nitroApp, mcpManager);
      // Hub-serve: expose org-scope servers to other agent-native apps in the
      // workspace when `AGENT_NATIVE_MCP_HUB_TOKEN` is set (dispatch, by
      // convention). Gated by the env var so mounting is a no-op otherwise.
      if (isHubServeEnabled()) {
        mountMcpHubRoutes(nitroApp);
        console.log(
          "[mcp-client] hub serve enabled — other apps can pull org servers via /_agent-native/mcp/hub/servers",
        );
      }
      const hubStatus = getHubStatus();
      if (hubStatus.consuming) {
        console.log(
          `[mcp-client] hub consume enabled — pulling from ${hubStatus.hubUrl}`,
        );
      }
      mountMcpHubStatusRoute(nitroApp);

      // Ensure we tear down child processes if the host shuts down cleanly.
      if (
        typeof process !== "undefined" &&
        typeof process.once === "function" &&
        !(globalThis as any).__agentNativeMcpExitHooked
      ) {
        (globalThis as any).__agentNativeMcpExitHooked = true;
        const stop = () => {
          const mgr = getGlobalMcpManager();
          if (mgr) void mgr.stop();
        };
        process.once("exit", stop);
        process.once("SIGTERM", stop);
        process.once("SIGINT", stop);
      }

      // Resolve actions — prefer explicit `actions`, fall back to deprecated
      // `scripts`. When neither is provided, auto-discover from the filesystem
      // so templates that forget to pass `actions` still work in non-serverless
      // deployments (serverless bundles need explicit imports).
      const rawActions = options?.actions ?? options?.scripts;
      let templateScripts: Record<string, ActionEntry> =
        typeof rawActions === "function"
          ? await rawActions()
          : (rawActions ?? {});
      if (!rawActions && Object.keys(templateScripts).length === 0) {
        try {
          const { autoDiscoverActions } = await import("./action-discovery.js");
          templateScripts = await autoDiscoverActions(process.cwd());
        } catch {
          // Filesystem discovery unavailable (serverless bundle) — skip.
        }
      }

      // Resource, chat, docs, db, and cross-agent scripts are available in both prod and dev modes
      const resourceScripts = await createResourceScriptEntries();
      const docsScripts = await createDocsScriptEntries();
      const dbScripts = await createDbScriptEntries();
      const refreshScreenTool = createRefreshScreenEntry();
      const frameworkContextTool = createFrameworkContextEntry();
      const leanPrompt = options?.leanPrompt === true;
      const lazyContext = options?.lazyContext !== false && !leanPrompt;
      const urlTools = createUrlTools();
      const engineScripts = await createAgentEngineScriptEntries();
      const chatScripts = {
        ...(await createChatScriptEntries()),
        ...engineScripts,
      };
      const callAgentScript = await createCallAgentScriptEntry(options?.appId);
      let _currentRequestOrigin = "http://localhost:3000";
      const browserTools = createBuilderBrowserTool({
        getOrigin: () => _currentRequestOrigin,
      });

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
                // (and .ts files Node can't parse natively).
              }

              // Static-parse the source for `http: false` or
              // `http: { method: "GET" }` so the shell-wrapper fallback still
              // mounts HTTP routes with the correct method. We can't load the
              // .ts module to read the real defineAction object in this Node
              // context, so this regex sniff is the best we can do until the
              // discovery is moved into a Vite-aware codepath.
              let httpConfig: ActionHttpConfig | false | undefined;
              try {
                const src = _fs.readFileSync(filePath, "utf-8");
                if (/\bhttp\s*:\s*false\b/.test(src)) {
                  httpConfig = false;
                } else {
                  const httpStart = src.search(/\bhttp\s*:\s*\{/);
                  if (httpStart >= 0) {
                    const window = src.slice(httpStart, httpStart + 200);
                    const m = window.match(
                      /method\s*:\s*['"`](GET|POST|PUT|DELETE)['"`]/,
                    );
                    const p = window.match(/path\s*:\s*['"`]([^'"`]+)['"`]/);
                    if (m || p) {
                      httpConfig = {
                        ...(m
                          ? {
                              method: m[1] as "GET" | "POST" | "PUT" | "DELETE",
                            }
                          : {}),
                        ...(p ? { path: p[1] } : {}),
                      };
                    }
                  }
                }
              } catch {
                // File read failed — leave httpConfig undefined (default POST)
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
                ...(httpConfig !== undefined ? { http: httpConfig } : {}),
              };
            }
          }
          if (Object.keys(discoveredActions).length > 0 && process.env.DEBUG)
            console.log(
              `[agent-chat] Auto-discovered ${Object.keys(discoveredActions).length} action(s): ${Object.keys(discoveredActions).join(", ")}`,
            );
        } catch {}
      }
      // Mutable owner — set per-request by the production handler, read by
      // automation tools and fetch tool via closure. Declared here (before
      // allScripts) so the tools are in scope when allScripts is built.
      let _currentRunOwner = "local@localhost";

      // Automation tools + fetch tool — depend on _currentRunOwner via callback
      let automationTools: Record<string, ActionEntry> = {};
      try {
        const { createAutomationToolEntries } =
          await import("../triggers/actions.js");
        automationTools = createAutomationToolEntries(() => _currentRunOwner);
      } catch {}
      let notificationTools: Record<string, ActionEntry> = {};
      try {
        const { createNotificationToolEntries } =
          await import("../notifications/actions.js");
        notificationTools = createNotificationToolEntries(
          () => _currentRunOwner,
        );
      } catch {}
      let progressTools: Record<string, ActionEntry> = {};
      try {
        const { createProgressToolEntries } =
          await import("../progress/actions.js");
        progressTools = createProgressToolEntries(() => _currentRunOwner);
      } catch {}
      let fetchTool: Record<string, ActionEntry> = {};
      try {
        const { createFetchToolEntry } = await import("../tools/fetch-tool.js");
        const { resolveKeyReferences, validateUrlAllowlist, getKeyAllowlist } =
          await import("../secrets/substitution.js");
        fetchTool = createFetchToolEntry({
          resolveKeys: async (text) =>
            resolveKeyReferences(text, "user", _currentRunOwner),
          validateUrl: async (url, usedKeys) => {
            for (const keyName of usedKeys) {
              const allowlist = await getKeyAllowlist(
                keyName,
                "user",
                _currentRunOwner,
              );
              if (allowlist && !validateUrlAllowlist(url, allowlist)) {
                return false;
              }
            }
            return true;
          },
        });
      } catch {}

      // In dev mode, template actions (templateScripts and discoveredActions) are
      // NOT registered as native tools — the agent invokes them via shell instead.
      // This avoids degenerate empty-object tool calls that Anthropic models
      // sometimes emit for actions with complex schemas. Production keeps the
      // native registration since it has no shell access.
      const allScripts = canToggle
        ? {
            ...resourceScripts,
            ...docsScripts,
            ...(lazyContext ? frameworkContextTool : {}),
            ...chatScripts,
            ...callAgentScript,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
            ...browserTools,
            ...devScriptsForA2A,
          }
        : {
            ...discoveredActions,
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...dbScripts,
            ...refreshScreenTool,
            ...(lazyContext ? frameworkContextTool : {}),
            ...urlTools,
            ...chatScripts,
            ...callAgentScript,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
            ...browserTools,
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
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )
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
          const a2aEngine = await resolveEngine({
            engineOption: options?.engine,
            apiKey: options?.apiKey,
          });

          // Use the same handler (dev or prod) that the interactive chat uses
          const devActive = isDevMode();
          const handler = devActive && devHandler ? devHandler : prodHandler;

          // Build the same system prompt the interactive agent uses
          const owner = userEmail || "local@localhost";
          const resources = await loadResourcesForPrompt(owner, lazyContext);
          const schemaBlock = lazyContext
            ? ""
            : await buildSchemaBlock(owner, devActive);
          const systemPrompt = devActive
            ? devPrompt + resources + schemaBlock
            : basePrompt + resources + schemaBlock;

          const model =
            options?.model ??
            (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

          // Build tools — same as interactive handler but WITHOUT call-agent
          // to prevent infinite recursive A2A loops (agent calling itself).
          // In dev mode, template actions are invoked via shell (not native tools),
          // so they're omitted from the tool registry — see allScripts comment.
          const a2aActions = devActive
            ? {
                ...resourceScripts,
                ...docsScripts,
                ...(lazyContext ? frameworkContextTool : {}),
                ...chatScripts,
                ...browserTools,
                ...devScriptsForA2A,
              }
            : {
                ...templateScripts,
                ...resourceScripts,
                ...docsScripts,
                ...dbScripts,
                ...refreshScreenTool,
                ...(lazyContext ? frameworkContextTool : {}),
                ...urlTools,
                ...chatScripts,
                ...browserTools,
              };

          const a2aTools = actionsToEngineTools(a2aActions);

          const a2aMessages: EngineMessage[] = [
            { role: "user", content: [{ type: "text", text }] },
          ];

          // Run the SAME agent loop, collect text events, yield as A2A messages
          let accumulatedText = "";
          const controller = new AbortController();

          console.log(
            `[A2A] Starting agent loop: ${a2aTools.length} tools, prompt ${systemPrompt.length} chars`,
          );

          await runAgentLoop({
            engine: a2aEngine,
            model,
            systemPrompt,
            tools: a2aTools,
            messages: a2aMessages,
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
      // so the agent knows to use them instead of raw SQL.
      //
      // Production: actions are native tools — emit `name(arg*: type) — desc`
      // Dev: actions are invoked via shell — emit `pnpm action name --arg <type>`
      //      and include discoveredActions too, since those are also missing
      //      from the dev tool registry.
      const prodActionsPrompt = generateActionsPrompt(templateScripts, "tool");
      const devActionsPrompt = generateActionsPrompt(
        { ...discoveredActions, ...templateScripts },
        "cli",
      );

      // Build system prompts — dynamic functions that pre-load resources per-request.
      // Production gets PROD_FRAMEWORK_PROMPT, dev gets DEV_FRAMEWORK_PROMPT.
      // Custom systemPrompt from options overrides the framework default entirely.
      const prodPrompt =
        (options?.systemPrompt ??
          (lazyContext
            ? PROD_FRAMEWORK_PROMPT_COMPACT
            : PROD_FRAMEWORK_PROMPT)) + prodActionsPrompt;
      // When template actions are registered as native tools in dev (via
      // `nativeActionsInDev` or `leanPrompt`), the dev prompt's "invoke
      // template actions via shell" guidance is wrong — use the prod prompt
      // + tool-format action list instead, same as production.
      const devNative = options?.nativeActionsInDev === true || leanPrompt;
      const devPrompt = devNative
        ? prodPrompt
        : (options?.devSystemPrompt
            ? options.devSystemPrompt +
              (options?.systemPrompt ??
                (lazyContext
                  ? PROD_FRAMEWORK_PROMPT_COMPACT
                  : PROD_FRAMEWORK_PROMPT))
            : lazyContext
              ? DEV_FRAMEWORK_PROMPT_COMPACT
              : DEV_FRAMEWORK_PROMPT) + devActionsPrompt;
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
          const mcpEngine = await resolveEngine({
            engineOption: options?.engine,
            apiKey: options?.apiKey,
          });
          const model =
            options?.model ??
            (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

          // Same actions as A2A — without call-agent to prevent loops.
          // In dev mode, template actions go through shell, not native tools.
          const devActiveMcp = isDevMode();
          const mcpActions = devActiveMcp
            ? {
                ...resourceScripts,
                ...docsScripts,
                ...(lazyContext ? frameworkContextTool : {}),
                ...chatScripts,
                ...devScriptsForA2A,
              }
            : {
                ...templateScripts,
                ...resourceScripts,
                ...docsScripts,
                ...dbScripts,
                ...refreshScreenTool,
                ...(lazyContext ? frameworkContextTool : {}),
                ...urlTools,
                ...chatScripts,
              };

          const mcpTools = actionsToEngineTools(mcpActions);

          const resources = await loadResourcesForPrompt(
            "local@localhost",
            lazyContext,
          );
          const schemaBlock = lazyContext
            ? ""
            : await buildSchemaBlock("local@localhost", devActiveMcp);
          // Build the MCP handler's own prompt — always use the shell-based
          // dev prompt in dev mode because mcpActions routes template actions
          // through shell (`devScriptsForA2A`), regardless of `nativeActionsInDev`.
          const mcpDevPrompt =
            (options?.devSystemPrompt
              ? options.devSystemPrompt +
                (options?.systemPrompt ??
                  (lazyContext
                    ? PROD_FRAMEWORK_PROMPT_COMPACT
                    : PROD_FRAMEWORK_PROMPT))
              : lazyContext
                ? DEV_FRAMEWORK_PROMPT_COMPACT
                : DEV_FRAMEWORK_PROMPT) + devActionsPrompt;
          const systemPrompt = devActiveMcp
            ? mcpDevPrompt + resources + schemaBlock
            : basePrompt + resources + schemaBlock;

          let accumulatedText = "";
          const controller = new AbortController();

          await runAgentLoop({
            engine: mcpEngine,
            model,
            systemPrompt,
            tools: mcpTools,
            messages: [
              { role: "user", content: [{ type: "text", text: message }] },
            ],
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
      // Include engine management script so the UI can call manage-agent-engine.
      const httpActions: Record<string, ActionEntry> = {
        ...discoveredActions,
        ...templateScripts,
        ...engineScripts,
      };
      // Framework-level sharing actions — merged with skipExisting semantics so
      // any template that provides a same-named action wins. When templates use
      // `loadActionsFromStaticRegistry`, `autoDiscoverActions` never runs, so
      // this is the single point that guarantees share-resource, unshare-resource,
      // list-resource-shares, and set-resource-visibility are always mounted.
      try {
        const { mergeCoreSharingActions } =
          await import("./action-discovery.js");
        await mergeCoreSharingActions(httpActions);
      } catch {
        // Ignore — templates without sharing still work.
      }
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
        // Serialize the read-modify-write against the same thread's other
        // `thread_data` writers (setThreadQueuedMessages, setThreadEngineMeta,
        // the frontend-triggered saves below). Without the lock, a concurrent
        // queued-message save can clobber the assistant message we just
        // appended here, or vice versa.
        await withThreadDataLock(threadId, async () => {
          try {
            const thread = await getThread(threadId);
            if (!thread) return;

            const assistantMsg = buildAssistantMessage(
              run.events ?? [],
              run.runId,
            );
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
            const lastContent = lastMsg?.message?.content ?? lastMsg?.content;
            const lastContentIsEmpty = Array.isArray(lastContent)
              ? lastContent.length === 0
              : lastContent == null || lastContent === "";
            if (lastRole === "assistant" && !lastContentIsEmpty) {
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
            if (lastRole === "assistant" && lastContentIsEmpty) {
              // The frontend wrote an empty assistant placeholder before the stream
              // had any content (common when the user reloads mid-run, and the 5s
              // periodic save raced with the first text chunk). Replace it with
              // the server's reconstructed message so the turn isn't lost.
              repo.messages.pop();
            }

            // Determine if repo uses wrapped format ({ message, parentId }) or flat format
            const isWrapped = lastMsg && "message" in lastMsg;
            if (isWrapped) {
              const parentId =
                repo.messages.length > 0
                  ? (repo.messages[repo.messages.length - 1].message?.id ??
                    null)
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
        });

        // Emit agent.turn.completed for automation triggers
        try {
          const { emit } = await import("../event-bus/index.js");
          emit("agent.turn.completed", {
            threadId,
            model: resolvedModel,
          });
        } catch {
          // Event bus not available — skip
        }

        // Auto-checkpoint in dev mode after file-modifying agent turns
        if (isDevMode()) {
          try {
            const {
              createCheckpoint: gitCheckpoint,
              isGitRepo,
              hasUncommittedChanges,
              getChangedFileNames,
            } = await import("../checkpoints/service.js");
            const cwd = process.cwd();
            if (isGitRepo(cwd) && hasUncommittedChanges(cwd)) {
              let summary = "";

              // Try to extract the first sentence of the assistant's text response
              let assistantText = "";
              for (const { event } of run.events ?? []) {
                if (event.type === "text" && typeof event.text === "string") {
                  assistantText += event.text;
                }
              }
              assistantText = assistantText.trim();
              if (assistantText) {
                const firstSentence = assistantText
                  .split(/(?<=[.!?\n])\s/)[0]
                  ?.replace(/\n/g, " ")
                  .trim();
                if (firstSentence && firstSentence.length <= 120) {
                  summary = firstSentence;
                } else if (firstSentence) {
                  summary = firstSentence.slice(0, 117) + "...";
                }
              }

              // Fall back to listing changed files
              if (!summary) {
                const files = getChangedFileNames(cwd);
                if (files.length > 0) {
                  summary = `Update ${files.join(", ")}`;
                }
              }

              if (!summary) summary = "Agent turn";
              if (summary.length > 120) summary = summary.slice(0, 117) + "...";

              const sha = gitCheckpoint(cwd, summary);
              if (sha) {
                const { insertCheckpoint } =
                  await import("../checkpoints/store.js");
                const cpId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                await insertCheckpoint(cpId, threadId, run.runId, sha, summary);
              }
            }
          } catch {
            // Checkpointing is best-effort — never break the run
          }
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
      let _currentRunUserApiKey: string | undefined;
      let _currentRunThreadId = "";
      let _currentRunSystemPrompt = basePrompt;
      // Populated by onEngineResolved per request so sub-agents inherit
      // whichever provider + model the user configured (OpenRouter, Groq, …)
      // instead of silently falling back to Anthropic + Claude.
      let _currentRunEngine: AgentEngine | undefined;
      let _currentRunModel: string | undefined;
      // Default to Haiku in production mode to manage costs for hosted apps
      const resolvedModel =
        options?.model ??
        (canToggle ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

      const teamTools = createTeamTools({
        getOwner: () => _currentRunOwner,
        getSystemPrompt: () => _currentRunSystemPrompt,
        getActions: () =>
          isDevMode()
            ? {
                // Sub-agents spawned in dev mode also invoke template actions
                // via shell, so omit them from the native tool registry.
                ...resourceScripts,
                ...docsScripts,
                ...(lazyContext ? frameworkContextTool : {}),
                ...chatScripts,
                ...devScriptsForA2A,
              }
            : {
                ...templateScripts,
                ...resourceScripts,
                ...docsScripts,
                ...dbScripts,
                ...refreshScreenTool,
                ...(lazyContext ? frameworkContextTool : {}),
                ...urlTools,
                ...chatScripts,
              },
        getEngine: () =>
          _currentRunEngine ??
          createAnthropicEngine({
            // Sub-agents must inherit the parent run's resolved key so a
            // BYO-key user can't bypass the free-tier check on the parent
            // run and then have agent-teams spawn delegations bill the platform key.
            apiKey:
              _currentRunUserApiKey ??
              options?.apiKey ??
              process.env.ANTHROPIC_API_KEY,
          }),
        getModel: () => _currentRunModel ?? resolvedModel,
        getParentThreadId: () => _currentRunThreadId,
        getSend: () => {
          // Return the send for the current run's thread
          const send = _runSendByThread.get(_currentRunThreadId);
          return send ?? null;
        },
      });

      // Hook into the run lifecycle to set/clear the send reference.
      // Job management tool (manage-jobs)
      let jobTools: Record<string, ActionEntry> = {};
      try {
        const { createJobTools } = await import("../jobs/tools.js");
        jobTools = createJobTools();
      } catch {}

      const prodActions = {
        ...templateScripts,
        ...resourceScripts,
        ...docsScripts,
        ...dbScripts,
        ...refreshScreenTool,
        ...(lazyContext ? frameworkContextTool : {}),
        ...urlTools,
        ...chatScripts,
        ...callAgentScript,
        ...teamTools,
        ...jobTools,
        ...automationTools,
        ...notificationTools,
        ...progressTools,
        ...fetchTool,
        ...browserTools,
        ...mcpActionEntries,
      };

      // Keep the prod action dict's MCP entries in sync when the manager's
      // server set changes at runtime (e.g. a user adds a remote MCP server
      // through the settings UI). getEngineTools() in production-agent re-reads
      // the registry per request, so updates here propagate without restart.
      mcpManager.onChange(() => {
        syncMcpActionEntries(mcpManager, prodActions);
      });

      // Always build the production handler (includes resource tools + call-agent + team tools)
      // In production mode (!canToggle), enable usage tracking and limits
      const isHostedProd = !canToggle;
      const resolveExtraContext = async (
        event: any,
        owner: string,
      ): Promise<string> => {
        if (!options?.extraContext) return "";
        try {
          const extra = await options.extraContext(event, owner);
          return extra ? `\n\n${extra}` : "";
        } catch (err) {
          console.warn(
            "[agent-chat] extraContext threw:",
            err instanceof Error ? err.message : err,
          );
          return "";
        }
      };

      // Lean mode: use only the template's systemPrompt + actions list.
      // Skip resource loading and schema block — those add DB round-trips
      // and tokens that minimal/voice apps don't need.
      const leanBasePrompt = (options?.systemPrompt ?? "") + prodActionsPrompt;

      // Per-request preamble shared by both prod and dev handlers. Resolves
      // owner + user API key (stashed on the closure so downstream tools can
      // reach them) and the template-authored `extraContext`. `extraContext`
      // runs in every prompt variant (lean, lazy, full) — if a template
      // defined it, they opted in; framework-provided content is what the
      // token-saving modes strip.
      const prepareRun = async (event: any) => {
        _currentRequestOrigin = getOrigin(event);
        const owner = await getOwnerFromEvent(event);
        _currentRunOwner = owner;
        const { getOwnerActiveApiKey } =
          await import("../agent/production-agent.js");
        _currentRunUserApiKey = await getOwnerActiveApiKey(owner);
        const extra = await resolveExtraContext(event, owner);
        return { owner, extra };
      };

      const prodHandler = createProductionAgentHandler({
        actions: prodActions,
        systemPrompt: async (event: any) => {
          const { owner, extra } = await prepareRun(event);
          if (leanPrompt) {
            _currentRunSystemPrompt = leanBasePrompt + extra;
            return _currentRunSystemPrompt;
          }
          const resources = await loadResourcesForPrompt(owner, lazyContext);
          // In lazy context mode, skip embedding the full schema — the agent
          // calls `db-schema` on demand. This saves ~1-2K tokens per request.
          const schemaBlock = lazyContext
            ? ""
            : await buildSchemaBlock(owner, false);
          _currentRunSystemPrompt =
            basePrompt + resources + schemaBlock + extra;
          return _currentRunSystemPrompt;
        },
        model:
          options?.model ??
          (isHostedProd ? "claude-haiku-4-5-20251001" : undefined),
        apiKey: options?.apiKey,
        skipFilesContext: leanPrompt,
        onEngineResolved: (engine, model) => {
          _currentRunEngine = engine;
          _currentRunModel = model;
        },
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
        // Dev mode: template actions (templateScripts and discoveredActions) are
        // intentionally OMITTED from the native tool registry. The agent invokes
        // them via `shell(command="pnpm action <name> ...")` instead. This mirrors
        // how Claude Code works locally and dramatically reduces the rate of
        // degenerate empty-object tool calls. The CLI syntax for each action is
        // listed in the dev system prompt's "Available Actions" section.
        // In lean mode — or when `nativeActionsInDev` is set — expose the
        // template's actions as native tools instead of routing through shell.
        // Templates with structured-arg actions (objects/arrays) need this to
        // avoid round-tripping JSON through the CLI parser.
        const devActions = devNative
          ? prodActions
          : {
              ...resourceScripts,
              ...docsScripts,
              ...(lazyContext ? frameworkContextTool : {}),
              ...chatScripts,
              ...callAgentScript,
              ...teamTools,
              ...jobTools,
              ...automationTools,
              ...notificationTools,
              ...progressTools,
              ...fetchTool,
              ...browserTools,
              ...mcpActionEntries,
              ...(await createDevScriptRegistry()),
            };
        // Keep dev action dict in sync with runtime MCP additions. When
        // native-actions mode is on (lean or `nativeActionsInDev`), devActions
        // === prodActions so the prod listener already covers it.
        if (devActions !== prodActions) {
          mcpManager.onChange(() => {
            syncMcpActionEntries(mcpManager, devActions);
          });
        }
        devHandler = createProductionAgentHandler({
          actions: devActions,
          systemPrompt: async (event: any) => {
            const { owner, extra } = await prepareRun(event);
            if (leanPrompt) {
              _currentRunSystemPrompt = leanBasePrompt + extra;
              return _currentRunSystemPrompt;
            }
            const resources = await loadResourcesForPrompt(owner, lazyContext);
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, true);
            _currentRunSystemPrompt =
              devPrompt + resources + schemaBlock + extra;
            return _currentRunSystemPrompt;
          },
          model: options?.model,
          apiKey: options?.apiKey,
          skipFilesContext: leanPrompt,
          onEngineResolved: (engine, model) => {
            _currentRunEngine = engine;
            _currentRunModel = model;
          },
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

      // currentDevMode + persistence were hoisted to the top of this function
      // so every closure built below can close over the live flag.

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
            try {
              await putSetting(AGENT_MODE_SETTING_KEY, {
                devMode: currentDevMode,
              });
            } catch {
              // Persistence is best-effort — in-memory flag still applies for
              // the lifetime of this process even if the settings write fails.
            }
            return { devMode: currentDevMode, canToggle };
          }
          return { devMode: currentDevMode, canToggle };
        }),
      );

      // Mount save-key BEFORE the prefix handler so it isn't shadowed.
      // Persists the user's key per-owner in the SQL settings table so it
      // survives across serverless invocations (where mutating process.env
      // and writing .env are both no-ops). Also updates process.env and
      // .env when running locally for fast pickup by other handlers.
      getH3App(nitroApp).use(
        `${routePath}/save-key`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const body = await readBody(event);
          const { key, provider: rawProvider } = body as {
            key?: string;
            provider?: string;
          };
          const provider = rawProvider || "anthropic";

          if (!key || typeof key !== "string" || !key.trim()) {
            setResponseStatus(event, 400);
            return { error: "API key is required" };
          }

          const trimmedKey = key.trim();

          // Persist per-owner so the key survives cold starts in serverless
          // and so the user's key isn't shared across users on multi-tenant
          // hosted deployments. We require a real authenticated owner here —
          // `local@localhost` is the unauthenticated fallback and must never
          // become the shared key bucket on hosted deployments.
          const ownerEmail = await getOwnerFromEvent(event);
          if (
            isHostedProd &&
            (!ownerEmail || ownerEmail === "local@localhost")
          ) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          if (ownerEmail && ownerEmail !== "local@localhost") {
            try {
              await putSetting(`user-api-key:${provider}:${ownerEmail}`, {
                key: trimmedKey,
              });
              // Verify the write actually landed — some managed DB drivers
              // swallow errors on degraded connections. Without this the
              // client sees "saved", reloads, and the usage-limit card
              // re-appears on the next message because the key isn't
              // really persisted.
              const check = await getSetting(
                `user-api-key:${provider}:${ownerEmail}`,
              );
              if (
                !check ||
                typeof check.key !== "string" ||
                check.key !== trimmedKey
              ) {
                throw new Error("settings write did not persist");
              }
            } catch (err) {
              if (isHostedProd) {
                console.error(
                  "[agent-chat] save-key persistence failed:",
                  err instanceof Error ? err.message : err,
                );
                setResponseStatus(event, 500);
                return {
                  error:
                    "Failed to persist API key. Please try again or contact support.",
                };
              }
              // Local dev falls through to the env-file path below.
            }
          }

          // In hosted/multi-tenant mode we deliberately do NOT touch
          // process.env or .env: the per-owner SQL lookup above is the
          // single source of truth, and overwriting the shared env key
          // would leak one tenant's credentials into every subsequent
          // request that hit the same warm instance without its own key.
          if (!isHostedProd) {
            const providerToEnv: Record<string, string> = {
              anthropic: "ANTHROPIC_API_KEY",
              openai: "OPENAI_API_KEY",
              google: "GOOGLE_GENERATIVE_AI_API_KEY",
              groq: "GROQ_API_KEY",
              mistral: "MISTRAL_API_KEY",
              cohere: "COHERE_API_KEY",
            };
            const envVar =
              providerToEnv[provider] ?? `${provider.toUpperCase()}_API_KEY`;
            try {
              const path = await import("path");
              const { upsertEnvFile } = await import("./create-server.js");
              const envPath = path.join(process.cwd(), ".env");
              await upsertEnvFile(envPath, [
                { key: envVar, value: trimmedKey },
              ]);
            } catch {
              // Edge runtime — can't write .env, but can still update process.env
            }
            // Update process.env so the agent works immediately in the
            // current local-dev invocation; the SQL persist above covers
            // future invocations.
            process.env[envVar] = trimmedKey;
          }

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
              const skillsDir = nodePath.join(
                process.cwd(),
                ".agents",
                "skills",
              );
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

              // 4. Custom workspace agents
              sources.push(
                (async () => {
                  try {
                    const owner = await getOwnerFromEvent(event);
                    const { listAccessibleCustomAgents } =
                      await import("../resources/agents.js");
                    const agents = await listAccessibleCustomAgents(owner);
                    flush(
                      agents.map((agent) => ({
                        id: `custom-agent:${agent.id}`,
                        label: agent.name,
                        description: agent.description || agent.path,
                        icon: "agent",
                        source: "agent:custom",
                        refType: "custom-agent",
                        refPath: agent.path,
                        refId: agent.id,
                        section: "Agents",
                      })),
                    );
                  } catch (e) {
                    console.error(
                      "[agent-native] Custom agent discovery failed:",
                      e,
                    );
                  }
                })(),
              );

              // 5. Peer agent discovery (network call — often slowest)
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
                        section: "Connected Agents",
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
          const ownerEmail = await getOwnerFromEvent(event);
          const body = await readBody(event);
          const message = body?.message;
          if (!message || typeof message !== "string") {
            setResponseStatus(event, 400);
            return { error: "message is required" };
          }
          // Strip mention markup: @[Name|type] → @Name
          const cleanMessage = message.replace(
            /@\[([^\]|]+)\|[^\]]*\]/g,
            "@$1",
          );
          // Mirror the chat-run resolution so BYO-key users have title
          // generation billed to their own key instead of the platform key.
          const { getOwnerActiveApiKey } =
            await import("../agent/production-agent.js");
          const userApiKey = await getOwnerActiveApiKey(ownerEmail);
          const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
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
              heartbeatAt: run.heartbeatAt,
            };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // ─── Checkpoint endpoints ──────────────────────────────────────────────
      getH3App(nitroApp).use(
        `${routePath}/checkpoints`,
        defineEventHandler(async (event) => {
          const method = getMethod(event);

          // GET /checkpoints?threadId=... — list checkpoints for a thread
          if (method === "GET") {
            if (!canToggle) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available in dev mode" };
            }
            if (!isLocalhost(event)) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available on localhost" };
            }
            const query = getQuery(event);
            const threadId = String(query.threadId || "");
            if (!threadId) {
              setResponseStatus(event, 400);
              return { error: "threadId query parameter is required" };
            }
            const owner = await getOwnerFromEvent(event);
            const thread = await getThread(threadId);
            if (!thread || thread.ownerEmail !== owner) {
              setResponseStatus(event, 404);
              return { error: "Thread not found" };
            }
            try {
              const { getCheckpointsByThread } =
                await import("../checkpoints/store.js");
              return await getCheckpointsByThread(threadId);
            } catch {
              return [];
            }
          }

          // POST /checkpoints — restore to a checkpoint
          // h3 prefix-matches, so /checkpoints/restore hits this handler with
          // event.path containing "/restore".
          const remainder = (event.path || "").replace(/^\/+/, "");
          if (method === "POST" && remainder.startsWith("restore")) {
            if (!canToggle) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available in dev mode" };
            }
            if (!isLocalhost(event)) {
              setResponseStatus(event, 403);
              return { error: "Restore only available on localhost" };
            }
            const body = await readBody(event);
            const checkpointId = body?.checkpointId;
            if (!checkpointId) {
              setResponseStatus(event, 400);
              return { error: "checkpointId is required" };
            }
            try {
              const { getCheckpointById } =
                await import("../checkpoints/store.js");
              const checkpoint = await getCheckpointById(checkpointId);
              if (!checkpoint) {
                setResponseStatus(event, 404);
                return { error: "Checkpoint not found" };
              }
              const owner = await getOwnerFromEvent(event);
              const thread = await getThread(checkpoint.threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Checkpoint not found" };
              }
              const {
                createCheckpoint: gitCheckpoint,
                restoreToCheckpoint,
                hasUncommittedChanges,
                isGitRepo,
              } = await import("../checkpoints/service.js");
              const cwd = process.cwd();
              if (!isGitRepo(cwd)) {
                setResponseStatus(event, 400);
                return { error: "Not a git repository" };
              }
              // Save current state before restoring so user can undo the undo
              if (hasUncommittedChanges(cwd)) {
                gitCheckpoint(cwd, "[agent-native] Pre-restore checkpoint");
              }
              const restored = restoreToCheckpoint(cwd, checkpoint.commitSha);
              if (!restored) {
                setResponseStatus(event, 500);
                return { error: "Failed to restore checkpoint" };
              }
              // Trigger UI refresh
              try {
                const { recordChange } = await import("./poll.js");
                recordChange({
                  source: "checkpoint",
                  type: "change",
                  key: "*",
                });
              } catch {}
              return { success: true, commitSha: checkpoint.commitSha };
            } catch (err: any) {
              setResponseStatus(event, 500);
              return { error: err?.message ?? "Restore failed" };
            }
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
              // Hold the thread_data lock for the full read-modify-write so
              // periodic saves from the frontend don't race with
              // onRunComplete / setThreadQueuedMessages / setThreadEngineMeta.
              // Without the lock, a client save that lands during an agent
              // run could clobber the assistant message the server just
              // appended (and vice versa).
              return await withThreadDataLock(threadId, async () => {
                const thread = await getThread(threadId);
                if (!thread || thread.ownerEmail !== owner) {
                  setResponseStatus(event, 404);
                  return { error: "Thread not found" };
                }
                const body = await readBody(event);
                let newThreadData = body.threadData || thread.threadData;
                // Preserve queuedMessages from the existing thread_data when the
                // incoming blob doesn't include it. Periodic full-thread saves
                // (exported via threadRuntime.export) don't carry the queue, and
                // we don't want them to clobber queued-message state persisted
                // via POST /threads/:id/queued.
                if (body.threadData) {
                  try {
                    const existing = JSON.parse(thread.threadData);
                    if (existing.queuedMessages !== undefined) {
                      const incoming = JSON.parse(newThreadData);
                      if (incoming.queuedMessages === undefined) {
                        incoming.queuedMessages = existing.queuedMessages;
                        newThreadData = JSON.stringify(incoming);
                      }
                    }
                  } catch {
                    // Invalid JSON in either side — fall back to raw body blob.
                  }
                }
                await updateThreadData(
                  threadId,
                  newThreadData,
                  body.title ?? thread.title,
                  body.preview ?? thread.preview,
                  body.messageCount || thread.messageCount,
                );
                return { ok: true };
              });
            }

            // POST /threads/:id/queued — debounced writes from the client
            // when the user adds/removes/dequeues a queued message. Keeps
            // queued messages durable across reloads without piggybacking
            // on full-thread saves.
            if (
              method === "POST" &&
              /\/threads\/[^/?]+\/queued/.test(
                event.node?.req?.url || event.path || "",
              )
            ) {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              const body = await readBody(event);
              const queued = Array.isArray(body?.queuedMessages)
                ? body.queuedMessages
                : [];
              await setThreadQueuedMessages(threadId, queued);
              return { ok: true };
            }

            // POST /threads/:id/fork — duplicate a thread with all its messages
            if (
              method === "POST" &&
              /\/threads\/[^/?]+\/fork/.test(
                event.node?.req?.url || event.path || "",
              )
            ) {
              const body = await readBody(event);
              const forked = await forkThread(threadId, owner, {
                id: body?.id,
              });
              if (!forked) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return forked;
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
          const afterBase = url.slice(
            url.indexOf(routePath) + routePath.length,
          );
          if (afterBase && afterBase !== "/" && !afterBase.startsWith("?")) {
            // Not for us — return 404 so h3 doesn't swallow the request
            setResponseStatus(event, 404);
            return { error: "Not found" };
          }

          // Resolve per-request auth context
          const owner = await getOwnerFromEvent(event);

          // Resolve org ID: explicit callback > session.orgId from Better Auth
          let resolvedOrgId: string | undefined;
          if (options?.resolveOrgId) {
            resolvedOrgId = (await options.resolveOrgId(event)) ?? undefined;
          } else {
            try {
              const session = await getSession(event);
              resolvedOrgId = session?.orgId ?? undefined;
            } catch {
              // Session not available
            }
          }

          // Also set process.env for backwards compat (CLI scripts, legacy readers)
          process.env.AGENT_USER_EMAIL = owner;
          if (resolvedOrgId) {
            process.env.AGENT_ORG_ID = resolvedOrgId;
          } else {
            delete process.env.AGENT_ORG_ID;
          }

          // Propagate the caller's IANA timezone from `x-user-timezone` so that
          // tool calls made by the agent (e.g. log-meal with no explicit date)
          // resolve "today" in the user's local timezone instead of server UTC.
          const tzRaw = getHeader(event, "x-user-timezone");
          const timezone =
            typeof tzRaw === "string" &&
            tzRaw.trim().length > 0 &&
            tzRaw.trim().length < 64
              ? tzRaw.trim()
              : undefined;
          if (timezone) process.env.AGENT_USER_TIMEZONE = timezone;

          return runWithRequestContext(
            { userEmail: owner, orgId: resolvedOrgId, timezone },
            () => {
              const handler =
                currentDevMode && devHandler ? devHandler : prodHandler;
              return handler(event);
            },
          );
        }),
      );

      // ─── Recurring Jobs Scheduler ──────────────────────────────────────
      // Poll every 60 seconds for due recurring jobs and execute them.
      // Uses setInterval so it works in all deployment environments without
      // requiring Nitro experimental tasks configuration.
      try {
        const { processRecurringJobs } = await import("../jobs/scheduler.js");

        const schedulerDeps = {
          getActions: () => ({
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...(lazyContext ? frameworkContextTool : {}),
            ...chatScripts,
            ...jobTools,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
          }),
          getSystemPrompt: async (owner: string) => {
            const resources = await loadResourcesForPrompt(owner, lazyContext);
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, false);
            return basePrompt + resources + schemaBlock;
          },
          apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
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

      // ─── Trigger Dispatcher (event-based automations) ─────────────────
      try {
        const { initTriggerDispatcher } =
          await import("../triggers/dispatcher.js");
        await initTriggerDispatcher({
          getActions: () => ({
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...(lazyContext ? frameworkContextTool : {}),
            ...chatScripts,
            ...jobTools,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
          }),
          getSystemPrompt: async (owner: string) => {
            const resources = await loadResourcesForPrompt(owner, lazyContext);
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, false);
            return basePrompt + resources + schemaBlock;
          },
          apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
          model: resolvedModel,
        });
        if (process.env.DEBUG)
          console.log("[triggers] Trigger dispatcher initialized");
      } catch (err) {
        // Triggers module not available — skip silently
      }
    })().catch((err) => {
      // If the init fails, the routes never get registered and requests
      // to /_agent-native/agent-chat silently 404. Register a fallback
      // route so the user sees a meaningful error instead.
      const routePath = options?.path ?? "/_agent-native/agent-chat";
      const msg = (err as Error)?.message || String(err);
      console.error(
        `[agent-chat] Plugin init failed — registering error fallback: ${msg}`,
      );
      getH3App(nitroApp).use(
        routePath,
        defineEventHandler((event) => {
          setResponseStatus(event, 503);
          return {
            error: `Agent chat failed to initialize: ${msg}`,
          };
        }),
      );
    });
    trackPluginInit(nitroApp, initPromise);
  };
}

/**
 * Default agent chat plugin with no template-specific actions.
 * In dev mode, provides file system, shell, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();

// ---------------------------------------------------------------------------
// MCP client glue — a shared manager reference + a /_agent-native/mcp/status
// route so onboarding / settings UIs can see which MCP servers are live.
// ---------------------------------------------------------------------------

let _globalMcpManager: McpClientManager | null = null;

function setGlobalMcpManager(manager: McpClientManager): void {
  _globalMcpManager = manager;
}

/** Internal: access the current process's MCP client manager, if any. */
export function getGlobalMcpManager(): McpClientManager | null {
  return _globalMcpManager;
}

function mountMcpHubStatusRoute(nitroApp: any): void {
  if ((globalThis as any).__agentNativeMcpHubStatusMounted) return;
  (globalThis as any).__agentNativeMcpHubStatusMounted = true;
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/hub/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        return getHubStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/hub/status: ${err?.message ?? err}`,
    );
  }
}

function mountMcpStatusRoute(nitroApp: any, manager: McpClientManager): void {
  // Idempotent — agent-chat-plugin can be invoked once per process; guard anyway.
  if ((globalThis as any).__agentNativeMcpStatusMounted) return;
  (globalThis as any).__agentNativeMcpStatusMounted = true;
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        return manager.getStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/status: ${err?.message ?? err}`,
    );
  }
}
