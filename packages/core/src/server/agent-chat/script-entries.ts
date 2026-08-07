import type { ActionEntry } from "../../agent/production-agent.js";
import type { ActionTool } from "../../agent/types.js";
import {
  renameThread,
  resolveThreadAccess,
  setThreadArchived,
  setThreadPinned,
} from "../../chat-threads/store.js";
import type { DatabaseToolsMode } from "../../scripts/db/tool-mode.js";
import { dbExecToolParameters } from "../../scripts/db/tool-schemas.js";
import { captureCliOutput } from "../cli-capture.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
} from "../request-context.js";

// ---------------------------------------------------------------------------
// CLI-script-backed action entries: db-*, framework-search/docs-search/source-search,
// resources/save-memory/delete-memory, chat-history, manage-agent-engine,
// manage-agent-loop-settings, and call-agent. Each wraps a core CLI script
// (that writes to console.log) as an ActionEntry via `wrapCliScript`.
// ---------------------------------------------------------------------------

/**
 * Wraps a core CLI script (that writes to console.log) as a ActionEntry
 * by capturing stdout. Uses an AsyncLocalStorage-backed capture so
 * concurrent tool calls do not corrupt the global console/stdout pointers
 * (see `cli-capture.ts`).
 */
function wrapCliScript(
  tool: ActionTool,
  cliDefault: (args: string[]) => Promise<void>,
  opts?: {
    allowedArgs?: readonly string[];
    readOnly?: boolean;
  },
): ActionEntry {
  return {
    tool,
    ...(opts?.readOnly ? { readOnly: true as const } : {}),
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        // MCP input schemas are descriptive and some hosts can still send
        // undeclared keys. The externally exposed DB readers must never accept
        // the CLI-only `--db` escape hatch, which could point at another local
        // SQLite file. Keep their runtime surface identical to the advertised
        // schema instead of trusting the client to validate it.
        if (opts?.allowedArgs && !opts.allowedArgs.includes(k)) {
          throw new Error(`Unknown argument: ${k}`);
        }
        const raw = v as unknown;
        const value =
          raw != null && typeof raw === "object"
            ? JSON.stringify(raw)
            : String(raw);
        cliArgs.push(`--${k}`, value);
      }
      return captureCliOutput(() => cliDefault(cliArgs));
    },
  };
}

/**
 * Creates db-* tools (db-query, db-exec, db-patch, db-schema) as native tools.
 * By default these let the agent inspect the app's own SQL database; raw SQL
 * writes are only exposed when the app explicitly opts into write mode.
 * Scoping to the current user/org is enforced automatically in production via
 * temp views.
 *
 * In dev mode template actions are invoked via bash and the agent can call
 * `pnpm action db-query ...` — but in production there is no bash, so these
 * must be registered as native tools for the agent to reach the app DB at all.
 */
export async function createDbScriptEntries(
  mode: DatabaseToolsMode = "read",
  options: { extensionTools?: boolean } = {},
): Promise<Record<string, ActionEntry>> {
  try {
    if (mode === "off") return {};
    const extensionQueryGuidance =
      options.extensionTools !== true
        ? "Extension management tools are disabled for this app; do not query or mutate the legacy tools table as a workaround."
        : "For extension management, use list-extensions, update-extension, hide-extension, or delete-extension instead of querying the legacy tools table.";
    const [schemaMod, queryMod] = await Promise.all([
      import("../../scripts/db/schema.js"),
      import("../../scripts/db/query.js"),
    ]);
    const [execMod, patchMod] =
      mode === "write"
        ? await Promise.all([
            import("../../scripts/db/exec.js"),
            import("../../scripts/db/patch.js"),
          ])
        : [null, null];

    const entries: Record<string, ActionEntry> = {
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
        {
          allowedArgs: ["format"],
          readOnly: true,
        },
      ),
      "db-query": wrapCliScript(
        {
          description: `Read from the app's own SQL database ONLY. Runs a SELECT against the app's internal tables (settings, application_state, template tables). Results are auto-scoped to the current user/org. IMPORTANT: This tool CANNOT access external data sources like data warehouses, CRMs, issue trackers, analytics platforms, calendars, mail, docs, or other third-party services. For those, use the relevant template/provider action, MCP connector, or provider-api-catalog/provider-api-docs/provider-api-request when available. If the user names a provider, that named provider wins; do not substitute a warehouse or app database copy unless they explicitly ask for it. If a table isn't in the app schema, don't try db-query — use the data-source-specific action. ${extensionQueryGuidance}`,
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "SELECT query to run, e.g. \"SELECT key, value FROM settings WHERE key LIKE 'sql-dashboard-%'\"",
              },
              args: {
                type: "string",
                description:
                  'Optional JSON array of positional bind args for parameterized placeholders. Example: \'["draft","form-123"]\'',
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
        {
          allowedArgs: ["sql", "args", "format", "limit"],
          readOnly: true,
        },
      ),
    };

    if (execMod && patchMod) {
      entries["db-exec"] = wrapCliScript(
        {
          description:
            "Write to the app's own SQL database ONLY. Runs INSERT / UPDATE / DELETE / REPLACE against the app's internal tables. For multiple related writes, pass `statements` so they run sequentially in one transaction instead of issuing several db-exec calls. Writes are auto-scoped to the current user/org, and `owner_email` / `org_id` are auto-injected on INSERT. Schema changes (CREATE/ALTER/DROP) are blocked. Never use this to backfill missing data for a read/analysis request or to create/modify users, members, roles, permissions, admin flags, or ownership; use a dedicated app action or reviewed code. IMPORTANT: This tool CANNOT write to external data sources like BigQuery, HubSpot, etc. For external services, use the appropriate template action.",
          parameters: dbExecToolParameters(),
        },
        execMod.default,
      );
      entries["db-patch"] = wrapCliScript(
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
      );
    }

    return entries;
  } catch {
    return {};
  }
}

/**
 * Creates read-only package lookup tools so agents can inspect version-matched
 * framework docs and source bundled in @agent-native/core at runtime.
 */
export async function createDocsScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  const entries: Record<string, ActionEntry> = {};

  try {
    const mod = await import("../../scripts/docs/framework-search.js");
    entries["framework-search"] = wrapCliScript(
      {
        description:
          "Search the version-matched Agent Native docs and readable Core, Toolkit, and first-party template source in one bounded read-only call. Use this first when a docs answer may require implementation evidence.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                "Text pattern to search across docs and source. Use normal text by default, or use glob (* and ?) / SQL-like (% and _) / regex mode for broader or more precise matching.",
            },
            scope: {
              type: "string",
              description:
                "Search corpus: all, docs, or source (default: all).",
              enum: ["all", "docs", "source"],
            },
            mode: {
              type: "string",
              description:
                "Match mode: substring, glob, sql-like, or safe regex (default: substring).",
              enum: ["substring", "glob", "sql-like", "regex"],
            },
            path: {
              type: "string",
              description:
                "Optional glob path filter such as templates/*/actions/*.ts or core/src/server/*.",
            },
            limit: {
              type: "string",
              description: "Maximum matching files to return, from 1 to 50.",
            },
            list: {
              type: "string",
              description:
                'Set to "true" to list searchable docs and source roots.',
              enum: ["true"],
            },
          },
        },
      },
      mod.default,
      { readOnly: true },
    );
  } catch (error) {
    console.warn(
      "[agent-chat] framework-search unavailable; keeping the older lookup tools:",
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const mod = await import("../../scripts/docs/search.js");
    entries["docs-search"] = wrapCliScript(
      {
        description:
          "Search and read agent-native framework documentation, bundled AGENTS.md, and codebase skills. Use --list to see all pages, --query to search, --slug to read a specific page. Codebase skill pages use slugs like skill-<name>.",
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
    );
  } catch {
    // Keep source-search available if docs-search fails during a partial build.
  }

  try {
    const mod = await import("../../scripts/docs/source-search.js");
    if (!mod.hasSourceCorpus()) {
      return entries;
    }
    entries["source-search"] = wrapCliScript(
      {
        description:
          "Search and read readable version-matched Core, Toolkit, and first-party template source. Use framework-search for one combined docs/source search with glob, SQL-like, or regex matching; use --list, --query, or --path for focused source lookup.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search term to find relevant template source (e.g. 'defineAction', 'useActionQuery', 'view-screen').",
            },
            path: {
              type: "string",
              description:
                "Read a specific corpus file or list a directory (e.g. 'templates/plan/AGENTS.md' or 'templates/chat/actions/hello.ts').",
            },
            list: {
              type: "string",
              description: 'Set to "true" to list corpus sections',
              enum: ["true"],
            },
          },
        },
      },
      mod.default,
      { readOnly: true },
    );
  } catch {
    // Older package installs may not have the corpus/search script yet.
  }

  return entries;
}

/**
 * Creates resource ScriptEntries available in both prod and dev modes.
 */
export function shouldDefaultResourceWriteToWorkspace(path: string): boolean {
  const normalized = path.replace(/^\/+/, "");
  return (
    normalized === "AGENTS.md" ||
    normalized === "LEARNINGS.md" ||
    normalized.startsWith("memory/") ||
    normalized.startsWith("skills/") ||
    normalized.startsWith("jobs/") ||
    normalized.startsWith("agents/") ||
    normalized.startsWith("remote-agents/")
  );
}

export async function createResourceScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const [list, read, effective, write, del, saveMem, delMem, store] =
      await Promise.all([
        import("../../scripts/resources/list.js"),
        import("../../scripts/resources/read.js"),
        import("../../scripts/resources/effective.js"),
        import("../../scripts/resources/write.js"),
        import("../../scripts/resources/delete.js"),
        import("../../scripts/resources/save-memory.js"),
        import("../../scripts/resources/delete-memory.js"),
        import("../../resources/store.js"),
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
    const effectiveEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      effective.default,
      { readOnly: true },
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
            'Manage workspace resources. Actions: "list" (browse visible files), "read" (get contents), "effective" (show workspace -> organization/app -> personal inheritance for a path), "write" (create/update personal or shared; workspace only for local file mode control files), "promote" (make agent scratch visible), "delete" (remove personal or shared; workspace only for local file mode control files). Agent scratch writes are hidden from the Workspace view by default; use visibility="workspace" only for files the user explicitly wants to keep/manage.',
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: [
                  "list",
                  "read",
                  "effective",
                  "write",
                  "promote",
                  "delete",
                ],
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
                  "personal, shared, workspace, or all (default varies by action). Workspace is read-only when inherited from Dispatch; in local file mode AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, and skills/ are writable.",
                enum: ["personal", "shared", "workspace", "all"],
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
              visibility: {
                type: "string",
                description:
                  'Visibility for write: "agent_scratch" for internal working files, "workspace" for user-requested files. Defaults to agent_scratch except durable instruction/skill/job/memory paths.',
                enum: ["workspace", "agent_scratch"],
              },
              includeAgentScratch: {
                type: "boolean",
                description: "Include hidden agent scratch files when listing.",
              },
            },
            required: ["action"],
          },
        },
        planMode: {
          effect: (args) =>
            args.action === "list" ||
            args.action === "read" ||
            args.action === "effective"
              ? "read"
              : "write",
          allowedValues: { action: ["list", "read", "effective"] },
          description:
            "Plan mode allows listing and reading workspace resources.",
        },
        run: async (args: Record<string, string>) => {
          const { action: a, ...rest } = args;
          if (a === "list") return listEntry.run(rest);
          if (a === "read") {
            if (!rest.path) return "Error: path is required for read";
            return readEntry.run(rest);
          }
          if (a === "effective") {
            if (!rest.path) return "Error: path is required for effective";
            return effectiveEntry.run(rest);
          }
          if (a === "write") {
            if (
              !rest.path ||
              rest.content === undefined ||
              rest.content === null
            )
              return "Error: path and content are required for write";
            rest.createdBy = "agent";
            rest.visibility =
              rest.visibility ??
              (shouldDefaultResourceWriteToWorkspace(String(rest.path))
                ? "workspace"
                : "agent_scratch");
            const runCtx = getRequestRunContext();
            if (runCtx?.threadId) rest.threadId = runCtx.threadId;
            return writeEntry.run(rest);
          }
          if (a === "promote") {
            if (!rest.path) return "Error: path is required for promote";
            const scope = rest.scope ?? "personal";
            if (scope === "workspace" || scope === "all") {
              return "Error: promote supports personal or shared scope only";
            }
            const owner =
              scope === "shared"
                ? store.sharedResourceOwner(getRequestOrgId())
                : (getRequestRunContext()?.owner ??
                  getRequestUserEmail() ??
                  getAmbientUserEmail());
            if (!owner) {
              return "Error: promote requires an authenticated user";
            }
            const resource = await store.resourceGetByPath(
              owner,
              String(rest.path),
            );
            if (!resource) {
              return `Resource not found: ${rest.path}`;
            }
            const promoted = await store.resourcePut(
              owner,
              resource.path,
              resource.content,
              resource.mimeType,
              {
                createdBy: resource.createdBy,
                visibility: "workspace",
                threadId: resource.threadId,
                runId: resource.runId,
                expiresAt: null,
                metadata: resource.metadata,
              },
            );
            return `Promoted resource: ${promoted.path}`;
          }
          if (a === "delete") {
            if (!rest.path) return "Error: path is required for delete";
            return deleteEntry.run(rest);
          }
          return `Error: unknown action "${a}". Use: list, read, write, promote, delete`;
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
 * Creates a unified chat-history ActionEntry that dispatches to search, open,
 * rename, or lightweight organization actions.
 */
export async function createChatScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const [searchMod, openMod] = await Promise.all([
      import("../../scripts/chat/search-chats.js"),
      import("../../scripts/chat/open-chat.js"),
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
            includeArchived: {
              type: "boolean",
              description:
                "Also include archived chats in the results. Archived chats are excluded by default.",
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
            "Manage past agent chat threads. Use action 'search' to find previous conversations by keyword, 'open' to open a thread in the UI, or 'rename'/'pin'/'unpin'/'archive' to organize history.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: ["search", "open", "rename", "pin", "unpin", "archive"],
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
              includeArchived: {
                type: "boolean",
                description:
                  "(search) Also include archived chats in the results. Archived chats are excluded by default, matching the 'archive' action's effect on the chat list.",
              },
              id: {
                type: "string",
                description:
                  "(open, rename, pin, unpin, archive) The chat thread ID to manage",
              },
              title: {
                type: "string",
                description: "(rename) New chat title",
              },
            },
            required: ["action"],
          },
        },
        planMode: {
          effect: (args) => (args.action === "search" ? "read" : "write"),
          allowedValues: { action: ["search"] },
          description: "Plan mode allows searching chat history.",
        },
        run: async (args) => {
          if (args?.action === "open") {
            return openEntry.run(args);
          }
          if (
            args?.action === "rename" ||
            args?.action === "pin" ||
            args?.action === "unpin" ||
            args?.action === "archive"
          ) {
            const id = typeof args?.id === "string" ? args.id : "";
            if (!id) return "Missing required id.";
            const owner =
              getRequestRunContext()?.owner ?? getRequestUserEmail() ?? "";
            if (!owner) return "No authenticated user is available.";
            const thread = await resolveThreadAccess(owner, id, "editor", {
              orgId: getRequestOrgId(),
            });
            if (!thread) {
              return `Chat thread "${id}" not found.`;
            }
            const title = thread.title || thread.preview || "(untitled)";
            if (args.action === "rename") {
              const nextTitle =
                typeof args?.title === "string"
                  ? args.title.replace(/\s+/g, " ").trim().slice(0, 160)
                  : "";
              if (!nextTitle) return "Missing required title.";
              const renamed = await renameThread(id, nextTitle);
              if (!renamed) return `Chat thread "${id}" could not be renamed.`;
              return `Renamed chat "${title}" to "${nextTitle}".`;
            }
            if (args.action === "archive") {
              const archived = await setThreadArchived(id, true);
              if (!archived)
                return `Chat thread "${id}" could not be archived.`;
              return `Archived chat: ${title}`;
            }
            const pinned = await setThreadPinned(id, args.action === "pin");
            if (!pinned) return `Chat thread "${id}" could not be updated.`;
            return `${args.action === "pin" ? "Pinned" : "Unpinned"} chat: ${title}`;
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
export async function createAgentEngineScriptEntries(
  appId?: string,
): Promise<Record<string, ActionEntry>> {
  try {
    const mod =
      await import("../../scripts/agent-engines/manage-agent-engine.js");

    return {
      "manage-agent-engine": {
        tool: mod.tool,
        planMode: {
          // Reads, per the tool's own enum: only set/set-app-default/
          // reset-app-default mutate. Misclassifying a read here makes every
          // call announce a change and bump the global `action` change
          // version, which is how the model-picker's catalog read ended up
          // recorded as a write for 1,127 identities.
          // `allowedValues` stays narrower on purpose — it governs what plan
          // mode may run, and `test` spends a live model call.
          effect: (args) =>
            args.action === "list" ||
            args.action === "test" ||
            args.action === "get-app-default"
              ? "read"
              : "write",
          allowedValues: { action: ["list"] },
          description: "Plan mode allows listing available agent engines.",
        },
        run: (args) =>
          mod.run({
            ...args,
            appId:
              typeof args.appId === "string" && args.appId.trim()
                ? args.appId
                : (appId ?? ""),
          }),
      },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the manage-agent-loop-settings tool. Lets the agent inspect and
 * configure the loop step limit it may hit on long-running work.
 */
export async function createAgentLoopSettingsScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const mod = await import("../../scripts/manage-agent-loop-settings.js");

    return {
      "manage-agent-loop-settings": { tool: mod.tool, run: mod.run },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the call-agent ActionEntry for cross-agent A2A communication.
 * Binds selfAppId so the agent cannot call itself via call-agent.
 */
export async function createCallAgentScriptEntry(
  selfAppId?: string,
): Promise<Record<string, ActionEntry>> {
  const entries: Record<string, ActionEntry> = {};

  try {
    const mod = await import("../../scripts/call-agent.js");
    entries["call-agent"] = {
      tool: mod.tool,
      planMode: {
        effect: (args) => {
          const keys = Object.keys(args);
          if (
            keys.some(
              (key) => key !== "agent" && key !== "action" && key !== "input",
            )
          ) {
            return "write";
          }
          if (
            typeof args.agent !== "string" ||
            !args.agent.trim() ||
            typeof args.action !== "string" ||
            !args.action.trim() ||
            !Object.hasOwn(args, "input") ||
            args.input === null ||
            typeof args.input !== "object" ||
            Array.isArray(args.input)
          ) {
            return "unknown";
          }
          return "read";
        },
        allowedProperties: ["agent", "action", "input"],
        requiredProperties: ["agent", "action"],
        description:
          "Plan mode allows only exact read-only cross-app action calls with agent, action, and input.",
      },
      run: (args, context) => mod.run(args, context, selfAppId),
    };
  } catch {
    // A missing built-in leaves the rest of the toolset usable.
  }

  try {
    const mod = await import("../../scripts/describe-workspace-apps.js");
    entries["describe-workspace-apps"] = {
      tool: mod.tool,
      run: (args, context) => mod.run(args, context, selfAppId),
      readOnly: true,
    };
  } catch {
    // A missing built-in leaves the rest of the toolset usable.
  }

  return entries;
}
