import { ACTION_CHAT_UI_DATA_WIDGET_RENDERER } from "../../action-ui.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import { dataWidgetResultSchema } from "../../data-widgets/index.js";
import { getRequestRunContext } from "../request-context.js";

// ---------------------------------------------------------------------------
// Framework-owned "context" action entries: get-framework-context,
// refresh-screen, the URL/ask-question tools, and the native data-widget
// renderer. These are generic, template-agnostic tools registered into every
// app's tool surface.
// ---------------------------------------------------------------------------

/**
 * Verbose framework sections returned by the `get-framework-context` tool.
 * Keyed by topic so the agent can request specific sections.
 * Not template-specific — lives outside buildFrameworkPrompts().
 */
export const FRAMEWORK_CONTEXT_SECTIONS: Record<string, string> = {
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
- \`chat-history\` (action: "search") — Search or list past chat threads by keyword. Archived threads are excluded by default; pass \`includeArchived: true\` to also see them.
- \`chat-history\` (action: "open") — Open a chat thread in the UI as a new tab and focus it
- \`chat-history\` (actions: "rename", "pin", "unpin", "archive") — Organize a known chat thread by ID. Archiving a thread hides it from the default chat list and search.

When the user asks to find a previous conversation, use \`chat-history\` with action "search" first to find matching threads, then action "open" to restore the one they want.`,

  "agent-teams": `### Agent Teams — Orchestration

You can delegate to background sub-agents with the \`agent-teams\` tool:
- \`agent-teams\` (action: "spawn") — Launch a sub-agent on a task. It runs in its own thread with a clean context while you stay available; a live preview card appears in the chat. The spawn result confirms launch only, not completion. Optionally pass a custom agent profile from \`agents/*.md\` via the \`agent\` parameter.
- \`agent-teams\` (action: "status") — Check a running sub-agent's progress.
- \`agent-teams\` (action: "read-result") — Read a finished sub-agent's output.
- \`agent-teams\` (action: "send") — Message a running sub-agent.
- \`agent-teams\` (action: "list") — List sub-agent tasks.

Sub-agents inherit all of your template tools but **cannot spawn sub-agents themselves** — only you orchestrate.

**User intent phrases.** If the user asks you to use a "sub-agent" or "background agent", that is explicit delegation intent. Also treat phrases like "run these in the background", "kick off the rest", "run the queued items", "batch run these jobs", "parallelize this", or "start the next batch" as delegation intent when the context is a set of independent work items.

**Spawn is not completion.** A successful \`spawn\` call means the sub-agent started and is running. Tell the user it started, show the task id if useful, and then use \`status\`/\`list\`/\`read-result\` to monitor it. Never say the delegated task "completed", "ran successfully", or "finished" until \`status\` or \`read-result\` reports \`completed\` or \`errored\`. If a task is still running, say that plainly.

**Default to doing the work yourself in this thread.** A sub-agent costs real tokens and adds a merge step, so reach for one only when delegation clearly pays for that overhead.

**Delegate ONE sub-agent** when a task is self-contained and heavy: deep research, long multi-step content generation, or a noisy scan whose intermediate steps would clutter this thread. The sub-agent gets its own clean context and hands you back a distilled result.

**Fan out to MULTIPLE sub-agents ONLY** for units of work that are genuinely independent and don't depend on each other's decisions — e.g. research three unrelated competitors, summarize five separate threads, draft sections that don't reference one another. Each gets a distinct slice.

**Do NOT parallelize tightly-coupled work** — one cohesive artifact, edits that must agree with each other, or anything needing a single consistent voice or style. Parallel sub-agents can't see each other's choices and their outputs will clash. For coupled work, do it yourself, or chain sub-agents one at a time, feeding each result into the next.

**Cap fan-out:** aim for 1, use up to ~3, and go beyond that only for clearly independent bulk work. More sub-agents means more tokens and a harder merge.

**Briefing contract.** A sub-agent starts in a fresh thread and can only see the brief you give it — it cannot see this conversation or ask you to clarify before it runs. Make every brief self-contained:
1. **Objective** — what "done" looks like, in a sentence or two.
2. **Context** — the specific facts it needs from this conversation: IDs, names, the user's actual goal, constraints, prior decisions. Paste the specifics; don't assume it knows them.
3. **Output format** — what to return and how (e.g. "a 3-bullet summary with source links", "the drafted email body only") so the result drops cleanly into your synthesis.
4. **Boundaries** — what NOT to do, and for parallel sub-agents, which slice is theirs so they don't overlap.

Put the objective and output format in \`task\`; put longer context in \`instructions\`.

**Synthesis discipline.** After the sub-agents you depend on finish, poll \`status\`/\`list\` until they're complete, then pull each one's output with \`read-result\`. Do NOT paste their outputs back to back. Read all results, reconcile any disagreements, de-duplicate, and write ONE integrated answer in your own voice. If two sub-agents conflict, resolve it or flag the discrepancy explicitly rather than presenting both. When findings came from distinct investigations, briefly note which finding came from where so the user can trust the merge.`,

  "recurring-jobs": `### Recurring Jobs

You can create recurring jobs that run on a cron schedule. Jobs are resource files under \`jobs/\`.

- \`manage-jobs\` (action: "create") — Create a new recurring job with a cron schedule and instructions
- \`manage-jobs\` (action: "list") — List all recurring jobs and their status
- \`manage-jobs\` (action: "update") — Update a job's schedule, instructions, or toggle enabled/disabled
- Delete a job with the \`resources\` tool: \`action: "delete"\`, \`path: "jobs/<name>.md"\`

Convert natural language to 5-field cron format:
- "every morning" / "daily at 9am" → \`0 9 * * *\`
- "every weekday at 9am" → \`0 9 * * 1-5\`
- "every hour" → \`0 * * * *\`
- "every monday at 9am" → \`0 9 * * 1\`

#### Suggesting "Save as automation"

When you finish a task that has obvious recurring value — daily inbox triage, weekly metrics summaries, archive sweeps, status digests, anything the user would plausibly want re-run on a fresh cadence — close the response with ONE short line offering to save it. Examples:

- After "Summarize my unread emails": _"Want me to run this every morning?"_
- After "What's our top traffic source this week": _"Want a weekly digest on Mondays?"_
- After "Archive emails older than 30 days": _"Should I run this every Sunday?"_

If the user says yes, call \`manage-jobs\` (action: "create") with the original prompt as the job's instructions and the cadence they confirmed.

Do NOT add this offer for one-shot work: lookups (find Alice, what's the schema, who reported X), single drafts/replies, navigation requests, or any task whose value is in the moment. Skip it when the prompt is already explicitly recurring (the user said "every morning…" — you'd be asking what they already told you). One short sentence at most; do not turn it into a list of cadence options.`,

  builder: `### Connecting Builder.io

When the user asks to connect Builder.io or you hit a "Builder not configured" error, call the \`connect-builder\` tool. It renders a Connect/code-change card inline — do NOT write out multi-step setup instructions yourself. Inspect the returned \`builderEnabled\` flag: \`true\` means Builder Cloud Agents can take the code-change handoff, while \`false\` means this requires a code change and the user should edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way they like. If Builder Cloud Agents are not available for this workspace, never send the user to Builder org settings or beta settings.`,

  browser: `### Browser Automation

You can activate a real Chrome browser via Builder.io for tasks that need full page rendering:
- Extracting design tokens from JS-heavy or SPA websites (computed styles, rendered colors/fonts)
- Taking screenshots of live pages
- Testing interactive flows on deployed URLs
- Reading content from pages that require JavaScript execution

**How to use:**
1. In local development, call \`set-browser-control\` with \`{"enabled":true,"backend":"chrome-devtools"}\` after confirming once with the user. In production, use \`activate-browser\` for Builder-provisioned Chrome.
2. On your next action, use \`mcp__chrome-devtools__navigate_page\`, \`mcp__chrome-devtools__evaluate_script\`, \`mcp__chrome-devtools__take_screenshot\`, etc.
3. If Builder is not connected, call \`connect-builder\` first

**When to recommend browser automation:**
- User wants to import a design system from a URL (JS-rendered sites give almost no useful data from plain HTML fetch)
- User asks you to check how a deployed site looks or behaves
- Any task involving reading computed/rendered page state
- When \`web-request\` returns minimal/skeleton HTML from a modern SPA

Prefer \`web-request\` for simple API calls and static pages. Use browser automation when you need the real rendered page.`,

  "call-agent": `### call-agent — External Apps Only

The \`call-agent\` tool sends a message to a DIFFERENT, separately-deployed app's agent (A2A protocol). It is **not** for calling actions within the current app.

**NEVER use \`call-agent\` to:**
- Call your own app by name
- Perform tasks you can accomplish with your own registered tools

**ONLY use \`call-agent\` when:**
- The user explicitly asks you to communicate with a different app
- You need data that only another deployed app can provide
- You need brand-consistent generated media and this app does not have a native generation action; call agent "assets" and keep returned asset IDs and URLs verbatim

If \`call-agent\` says a downstream agent accepted the subtask and will post its result separately, do not call that same agent again for the same subtask. Continue any remaining work and answer with the completed results you have.`,

  memory: `### Structured Memory

Your memory index (\`memory/MEMORY.md\`) is loaded at the start of every conversation.

**Tools:**
- \`save-memory\` — Create or update a memory (name, type, description, content)
- \`delete-memory\` — Remove a memory and its index entry
- \`resources\` with \`action: "read"\` and \`path: "memory/<name>.md"\` — Read the full content of a specific memory

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

When database tools are enabled, \`db-schema\` refreshes the schema and \`db-query\` runs read-only SELECT queries with current user/org scoping. Raw SQL write tools are only available when the app explicitly opts into database write tools; by default, writes go through typed app actions. Some apps configure database tools as read-only or off; only use tools that are actually present in your tool list.

- \`db-schema\` — refresh the full schema with indexes and foreign keys
- \`db-query\` — run a SELECT (read-only; results already filtered to the current user/org)
- \`db-exec\` — only when present: run INSERT / UPDATE / DELETE / REPLACE for scoped maintenance. For normal product data writes, use a typed app action instead.
- \`db-patch\` — only when present: surgical search-and-replace on a large text column. If a typed app action exists for the resource, use that action.

### When to pick which SQL tool
- A template-specific action exists for the table → use that action (it encodes business rules and pushes live Yjs updates)
- Read data → \`db-query\`. Never re-add \`WHERE owner_email = ...\` — scoping already applies it.
- Raw write tools are present and no app action exists → use \`db-exec\` or \`db-patch\` only for deliberate maintenance, not normal product workflows.

### External data sources vs the app database
The \`db-*\` tools ONLY query the app's own SQL database. They do NOT reach external data warehouses. If the user asks about tables NOT in the schema, use the appropriate template action instead.`,
};

export function createFrameworkContextEntry(): Record<string, ActionEntry> {
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
export function createRefreshScreenEntry(): Record<string, ActionEntry> {
  return {
    "refresh-screen": {
      // Writes __screen_refresh__ to application_state, which emits its own
      // distinct `screen-refresh` poll event. Don't double-emit a generic
      // `action` event on top of that.
      readOnly: true,
      tool: {
        description:
          "Manually refresh the user's current screen. The framework ALREADY auto-refreshes after any successful mutating action tool call (template actions and any enabled raw DB write tools) — you do NOT need to call this after a normal action. Use it only when (a) you mutated data via a path the framework can't detect (e.g. a direct write to an external system the app mirrors), or (b) you want to pass a `scope` hint so the UI narrows which queries to refetch. The UI re-fetches its queries without a full page reload.",
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
          await import("../../application-state/script-helpers.js");
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
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export function appStateKeyForBrowserTab(
  key: string,
  browserTabId: unknown,
): string {
  if (typeof browserTabId !== "string") return key;
  const trimmed = browserTabId.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? `${key}:${trimmed}` : key;
}

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
export function createUrlTools(): Record<string, ActionEntry> {
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
          await import("../../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "__set_url__",
            getRequestRunContext()?.browserTabId,
          ),
          {
            searchParams: params,
            mergeSearchParams: merge,
            // Unique-per-write token. The client's URLSync hook dedups by this
            // so a fire-and-forget DELETE that loses its race against the next
            // polling refetch can't cause the same URL command to be applied
            // repeatedly (which caused the editor to bounce between slides
            // when an agent turn errored partway through).
            _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
        );
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
          await import("../../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "__set_url__",
            getRequestRunContext()?.browserTabId,
          ),
          {
            pathname,
            searchParams: params,
            mergeSearchParams: merge,
            // See note in set-search-params: unique-per-write dedup token so a
            // race between GET and consume-DELETE in URLSync can't re-apply
            // this command.
            _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
        );
        return `set-url-path: ${pathname}`;
      },
    },
    "ask-question": {
      tool: {
        description:
          "Ask the user a multiple-choice clarifying question and render it inline in the chat. Use this ONLY when you are genuinely blocked on a decision you cannot resolve from context and a wrong guess would be costly — an ambiguous metric, date range, or grain; a real fork in approach. Present 2-5 concrete options and mark the most likely one recommended. Do NOT use it for confirmations, for things the user already specified, or to dodge easy work you could just do. Ask at most once per turn. Calling this yields the turn: stop and wait for the user's answer.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "The complete question to ask the user. Clear, specific, ends with a question mark.",
            },
            header: {
              type: "string",
              description:
                'Optional very short label (max ~12 chars) shown as a chip/heading above the question, e.g. "Date range", "Approach", "Library".',
            },
            options: {
              type: "string",
              description:
                'A JSON array of 2-4 distinct, mutually-exclusive options (unless `allowMultiple` is true), each `{ "label": string, "value"?: string, "description"?: string, "preview"?: string, "recommended"?: boolean }`. `label` is 1-5 words; `description` explains the trade-off; `preview` is optional content (mockup, code snippet, short comparison) rendered under the option. `value` defaults to `label` when omitted. Mark the most likely option `"recommended": true`. Do NOT add an "Other" option — free text is provided automatically when `allowFreeText` is on.',
            },
            allowFreeText: {
              type: "string",
              description:
                'Whether the user may also type a free-text "Other" answer. "true" (default) or "false".',
              enum: ["true", "false"],
            },
            allowMultiple: {
              type: "string",
              description:
                'Whether the user may select more than one option (multi-select). "true" or "false" (default).',
              enum: ["true", "false"],
            },
          },
          required: ["question", "options"],
        },
      },
      run: async (args) => {
        const question = String(args?.question ?? "").trim();
        if (!question) return "Error: 'question' is required.";
        const header = String(args?.header ?? "").trim();
        const allowMultiple = String(args?.allowMultiple ?? "") === "true";
        const allowFreeText = String(args?.allowFreeText ?? "true") !== "false";

        let parsedOptions: unknown;
        try {
          parsedOptions = JSON.parse(String(args?.options ?? "[]"));
        } catch {
          return "Error: 'options' must be a JSON array of { label, value?, description?, recommended? }.";
        }
        if (!Array.isArray(parsedOptions) || parsedOptions.length === 0) {
          return "Error: 'options' must be a non-empty JSON array of { label, value?, description?, recommended? }.";
        }

        type AskOption = {
          label: string;
          value: string;
          description?: string;
          preview?: string;
          recommended?: boolean;
        };
        const options = parsedOptions
          .map((raw): AskOption | null => {
            const opt = (raw ?? {}) as Record<string, unknown>;
            const label =
              typeof opt.label === "string" && opt.label.trim()
                ? opt.label.trim()
                : typeof opt.value === "string"
                  ? String(opt.value).trim()
                  : "";
            if (!label) return null;
            const value =
              typeof opt.value === "string" && opt.value.trim()
                ? opt.value.trim()
                : label;
            const option: AskOption = { label, value };
            if (typeof opt.description === "string" && opt.description.trim()) {
              option.description = opt.description.trim();
            }
            if (typeof opt.preview === "string" && opt.preview.trim()) {
              option.preview = opt.preview;
            }
            if (opt.recommended === true) option.recommended = true;
            return option;
          })
          .filter((opt): opt is AskOption => opt !== null);
        if (options.length === 0) {
          return "Error: 'options' must contain at least one option with a label.";
        }

        // Shape must match the GuidedQuestionFlow renderer in
        // client/guided-questions.tsx: a `text-options` question whose options
        // carry `value`, with `multiSelect` for multi-pick and `allowOther` for
        // free text. The renderer otherwise injects "Explore"/"Decide" options,
        // which would be noise for a focused clarifying question, so disable them.
        const payload = {
          questions: [
            {
              id: "q1",
              type: "text-options" as const,
              question,
              ...(header ? { header } : {}),
              required: !allowFreeText,
              multiSelect: allowMultiple,
              allowOther: allowFreeText,
              includeExplore: false,
              includeDecide: false,
              options,
            },
          ],
        };

        const { writeAppState } =
          await import("../../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "guided-questions",
            getRequestRunContext()?.browserTabId,
          ),
          payload,
        );
        return "Asked the user a clarifying question and rendered it in the chat. Stop here and wait for their answer — do not proceed or assume an answer.";
      },
    },
  };
}

export function createDataWidgetActionEntries(): Record<string, ActionEntry> {
  return {
    "render-data-widget": {
      readOnly: true,
      parallelSafe: true,
      chatUI: {
        renderer: ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
        title: "Data widget",
        description: "Render a validated native data table or chart in chat.",
      },
      tool: {
        description:
          "Render a native Agent-Native chat data widget from compact, real data you already retrieved or the user provided. Use this for in-chat tables, charts, graphs, trends, and compact reports when no domain-specific action already returns a native widget. Never fabricate rows or metrics just to make a chart.",
        parameters: {
          type: "object",
          properties: {
            widget: {
              type: "string",
              enum: ["data-table", "data-chart", "data-insights"],
              description:
                "Widget kind. Use data-chart for a chart, data-table for a table, or data-insights for a combined summary/chart/table card.",
            },
            widgetId: {
              type: "string",
              description: "Optional stable widget identifier.",
            },
            title: {
              type: "string",
              description: "Optional widget title.",
            },
            summary: {
              type: "object",
              description:
                "Optional scalar summary values for data-insights cards.",
            },
            display: {
              type: "object",
              description:
                "Optional display metadata: title, description, primaryAction.",
            },
            table: {
              type: "object",
              description:
                "For data-table/data-insights: { title?, columns: [{ key, label, align? }], rows, totalRows?, sampledRows?, truncated? }.",
            },
            chartSeries: {
              type: "object",
              description:
                "For data-chart/data-insights: { type: 'bar'|'line'|'area', title?, xKey, series: [{ key, label, color? }], data, sampled? }.",
            },
          },
          required: ["widget"],
        },
      },
      run: async (args) => dataWidgetResultSchema.parse(args),
    },
  };
}
